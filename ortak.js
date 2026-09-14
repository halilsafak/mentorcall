/* MENTORCALL — ortak çekirdek (auth, kabuk, tema, bileşenler, PDF parser) */
/* MENTORCALL — Yayınevi sonuç PDF'i parser'ı (FORMULA / TCPDF şablonu)
 * Girdi: pdf.js ile açılmış belge. Çıktı: deneme_ice_aktar RPC'sine verilecek JSON.
 * Tarayıcıda: window.DenemeParser.parse(pdfDoc)   Node testinde: import {parse}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DenemeParser = factory();
}(typeof self !== 'undefined' ? self : this, function () {

const SPLIT_X = 300;                                   // sol özet / sağ kazanım sütunu sınırı
const NUM_COLS = { S: 542.3, D: 549.4, Y: 556.4, B: 563.1 }; // S D Y B% sütun x0'ları
const DERS_KOD = { 'Türkçe':'TUR','Tarih':'TAR','Din K.ve A.B.':'DIN','İngilizce':'ING','Matematik':'MAT',
  'Fen':'FEN','Fen Bilimleri':'FEN','Sosyal':'SOS','Fizik':'FIZ','Kimya':'KIM','Biyoloji':'BIY',
  'Edebiyat':'EDB','Coğrafya':'COG','Felsefe':'FEL' };
const BLOK_KOD = { 'TÜR':'TUR','TAR':'TAR','DİN':'DIN','İNG':'ING','MAT':'MAT','FEN':'FEN','SOS':'SOS' };
const num = s => parseFloat(String(s).replace(',', '.'));

async function pageItems(page) {
  const H = page.view[3];
  const tc = await page.getTextContent();
  return tc.items.filter(i => i.str !== '').map(i => ({
    s: i.str, x: i.transform[4], x1: i.transform[4] + i.width, y: H - i.transform[5]
  }));
}
// aynı y'deki öğeleri satır yap
function toLines(items, tol = 3) {
  const srt = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = []; let cur = null;
  for (const it of srt) {
    if (!cur || it.y - cur.y > tol) { cur = { y: it.y, items: [] }; lines.push(cur); }
    cur.items.push(it);
  }
  for (const l of lines) { l.items.sort((a, b) => a.x - b.x); l.text = l.items.map(i => i.s.trim()).filter(Boolean).join(' '); }
  return lines;
}

function parseHeader(lines) {
  const text = lines.map(l => l.text).join('\n');
  const hdr = lines.map(l => l.text).find(t => /\s\d+\s+\d+\s+\d+\s+\d+$/.test(t));
  const parts = hdr.split(/\s+/);
  const kat = parts.slice(-4).map(Number);
  const tur = /\bLGS\b/.test(text) ? 'LGS' : /\bTYT\b/.test(text) ? 'TYT' : /\bAYT\b/.test(text) ? 'AYT' : 'DIGER';
  const i = parts.indexOf(tur);
  const ad = (i > 0 ? parts.slice(i - 1, parts.length - 4) : parts.slice(-7, -4)).join(' ');
  return { ad, yayinevi: ad.split(' ')[0], tur, il: parts[0], ilce: parts[1],
           katilim: { kurum: kat[0], ilce: kat[1], il: kat[2], genel: kat[3] } };
}

function parseResultPage(items) {
  const L = toLines(items.filter(i => i.x1 <= SPLIT_X + 2));
  const R = toLines(items.filter(i => i.x >= SPLIT_X));
  const st = { dersler: [], cevaplar: [], kazanimlar: [] };
  let m;
  for (let i = 0; i < L.length; i++) {
    const t = L[i].text;
    if (t.startsWith('Öğrenci Numara')) {
      const its = L[i + 1].items;                       // ad (x≈25) | no (x≈210) | sınıf (x≈266)
      st.ad = its.filter(o => o.x < 200).map(o => o.s).join(' ').trim();
      st.no = (its.find(o => o.x >= 200 && o.x < 260) || {}).s || '';
      st.sinif = (its.find(o => o.x >= 260) || {}).s || '';
    } else if ((m = t.match(/^(LGS|TYT|AYT)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/))) {
      st.puan = num(m[2]); st.puan_ort = num(m[3]);
      st.sira = { sinif: +m[4], kurum: +m[5], ilce: +m[6], il: +m[7], genel: +m[8] };
    } else if (t.startsWith('Katılımlar:')) {
      st.katilim_sinif = +t.split(/\s+/)[1];
    } else if ((m = t.match(/^Toplam:\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?[\d,]+)\s+(-?\d+)/))) {
      st.toplam = { soru: +m[1], dogru: +m[2], yanlis: +m[3], net: num(m[4]), basari: num(m[5]) };
    } else if ((m = t.match(/^Cevap Anh\. ([A-D]) (\S+)$/))) {
      st.kitapcik = m[1];
      const cv = st.cevaplar[st.cevaplar.length - 1];
      if (cv) {
        cv.anahtar = m[2];
        // Öğrenci cevabı boşluklarda parçalanmış öğeler hâlinde gelir; anahtarın x0 ve
        // karakter genişliğinden her parçayı soru sütununa yerleştiriyoruz.
        const key = L[i].items[L[i].items.length - 1];
        const cw = (key.x1 - key.x) / m[2].length;
        const arr = new Array(m[2].length).fill(' ');
        for (const it of cv._items) {
          const start = Math.round((it.x - key.x) / cw);
          [...it.s].forEach((ch, j) => { if (ch !== ' ' && start + j >= 0 && start + j < arr.length) arr[start + j] = ch; });
        }
        cv.verilen = arr.join(''); delete cv._items;
      }
    } else if ((m = t.match(/^(Sözel|Sayısal) \((\S+)\)/)) && st.toplam) {
      st.cevaplar.push({ kod: BLOK_KOD[m[2]] || m[2], verilen: '', _items: L[i].items.filter(o => o.x > 78) });
    } else if ((m = t.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?[\d,]+)\s+(-?\d+)\s+([\d,]+)\s+([\d,]+)/)) && DERS_KOD[m[1]]) {
      st.dersler.push({ kod: DERS_KOD[m[1]], ad: m[1], soru: +m[2], dogru: +m[3], yanlis: +m[4],
        net: num(m[5]), basari: num(m[6]), ort_sinif: num(m[7]), ort_kurum: num(m[8]) });
    }
  }
  // sağ sütun: kazanımlar (uzun metinler sayı sütunlarının altına taşar → ayrım x konumuyla)
  let ders = null, pending = '';
  for (const ln of R) {
    if ((m = ln.text.match(/^(Sözel|Sayısal) \((\S+)\)$/))) { ders = BLOK_KOD[m[2]] || m[2]; pending = ''; continue; }
    if (!ders || /S D Y B%$/.test(ln.text) || ln.text.startsWith('DERSLERE')) continue;
    const cols = { S: '', D: '', Y: '', B: '' }; const txt = [];
    for (const it of ln.items) {
      const s = it.s.trim(); let hit = null;
      if (/^\d+$/.test(s)) {
        for (const k of ['S', 'D', 'Y']) if (Math.abs(it.x - NUM_COLS[k]) <= 0.7) hit = k;
        if (!hit && it.x >= NUM_COLS.B - 0.7 && it.x <= NUM_COLS.B + 5.5) hit = 'B';
      }
      if (hit) cols[hit] += s; else if (s) txt.push(s);
    }
    const text = txt.join(' ').replace(/\s+/g, ' ').trim();
    if (!(cols.S && cols.D && cols.Y && cols.B)) { pending = (pending + ' ' + text).trim(); continue; }
    const metin = (pending + ' ' + text).trim(); pending = '';
    const s = +cols.S, d = +cols.D, y = +cols.Y;
    st.kazanimlar.push({ kod: ders, metin, soru: s, dogru: d, yanlis: y, bos: s - d - y, basari: +cols.B });
  }
  // soru bazlı durum: küçük harf = yanlış, boşluk = boş
  for (const cv of st.cevaplar) {
    const a = cv.anahtar || ''; const v = cv.verilen.padEnd(a.length, ' ');
    cv.sorular = [...a].map((k, i) => ({ no: i + 1, verilen: v[i] === ' ' ? null : v[i].toUpperCase(), dogru: k,
      durum: v[i] === ' ' ? 'B' : (v[i] === v[i].toUpperCase() ? 'D' : 'Y') }));
    cv.dogru = cv.sorular.filter(q => q.durum === 'D').length;
    cv.yanlis = cv.sorular.filter(q => q.durum === 'Y').length;
    cv.bos = cv.sorular.filter(q => q.durum === 'B').length;
  }
  return st;
}

// Tutarlılık kontrolü: cevap dizisinden hesaplanan D/Y, ders tablosuyla eşleşmeli
function dogrula(st) {
  const hatalar = [];
  for (const cv of st.cevaplar) {
    const d = st.dersler.find(x => x.kod === cv.kod);
    if (!d) { hatalar.push(cv.kod + ': ders satırı yok'); continue; }
    if (d.dogru !== cv.dogru || d.yanlis !== cv.yanlis) hatalar.push(`${cv.kod}: cevap ${cv.dogru}/${cv.yanlis} ≠ tablo ${d.dogru}/${d.yanlis}`);
  }
  return hatalar;
}

async function parse(pdfDoc) {
  const first = toLines(await pageItems(await pdfDoc.getPage(1)));
  const out = parseHeader(first); out.ogrenciler = [];
  for (let p = 2; p <= pdfDoc.numPages; p++) {
    const items = await pageItems(await pdfDoc.getPage(p));
    if (!items.some(i => i.s.includes('SONUÇ BELGESİ'))) continue;
    const st = parseResultPage(items); st.hatalar = dogrula(st);
    out.ogrenciler.push(st);
  }
  return out;
}

/* ---- Kurum optik okuyucu ham .txt (yayınevi PDF'i gelmeden hızlı net) ----
 * cfg = { ad, yayinevi, tur, dersler:[{kod,ad,soru}], anahtar:{A:'...',B:'...'}, katsayi:3|4 }
 * Satır: [kurumKodu] AD SOYAD  [no]  sınıf+kitapçık  <uzun boşluk>  cevap blokları (bloklar arası ≥5 boşluk, boş soru = boşluk)
 */
function parseOptik(text, cfg) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  const toplam = cfg.dersler.reduce((a, d) => a + d.soru, 0);
  // cevap alanının başlangıç sütunu: en çok harf içeren satırda uzun boşluktan sonraki ilk harf
  let tailStart = null, best = -1;
  for (const l of lines) {
    const m = l.match(/\s{30,}([A-E])/); if (!m) continue;
    const idx = l.indexOf(m[1], m.index);
    const letters = (l.slice(idx).match(/[A-E]/g) || []).length;
    if (letters > best) { best = letters; tailStart = idx; }
  }
  if (tailStart == null) throw new Error('Cevap sütunları bulunamadı');
  // blok başlangıçları: referans satırdaki ≥5 boşluklu ayraçlar
  const ref = lines.find(l => (l.slice(tailStart).match(/[A-E]/g) || []).length === best).slice(tailStart);
  const blocks = []; const re = /[A-E*][A-E* ]*?(?=\s{5,}|$)/g; let m;
  while ((m = re.exec(ref))) { if (m[0].trim()) blocks.push({ start: m.index, len: m[0].length }); if (re.lastIndex === m.index) re.lastIndex++; }
  const ogrenciler = [];
  for (const l of lines) {
    const head = l.slice(0, tailStart).trimEnd();
    const kit = (head.match(/([A-D])\s*$/) || [])[1] || 'A';
    const h = head.replace(/[A-D]\s*$/, '').trim().replace(/^\d{2,4}\s+/, '');   // baştaki kurum kodu
    const mm = h.match(/^(.*?)\s*(\d{5,}|0)?\s*(\S*)$/);
    const ad = (mm ? mm[1] : h).trim(), no = mm && mm[2] && mm[2] !== '0' ? mm[2] : '', sinif = mm ? mm[3] : '';
    let cev = blocks.map(b => l.slice(tailStart + b.start, tailStart + b.start + b.len).padEnd(b.len, ' ')).join('');
    cev = cev.padEnd(toplam, ' ').slice(0, toplam);
    const key = (cfg.anahtar[kit] || cfg.anahtar.A || '').toUpperCase();
    const st = { ad, no, sinif, kitapcik: kit, dersler: [], cevaplar: [], kazanimlar: [], hatalar: [] };
    let off = 0, D = 0, Y = 0, B = 0;
    for (const d of cfg.dersler) {
      const v = cev.slice(off, off + d.soru), k = key.slice(off, off + d.soru); off += d.soru;
      const sorular = [...k].map((kk, i) => { const c = v[i] && /[A-E]/.test(v[i]) ? v[i] : null;
        return { no: i + 1, verilen: c, dogru: kk, durum: c == null ? 'B' : (c === kk ? 'D' : 'Y') }; });
      const dd = sorular.filter(q => q.durum === 'D').length, dy = sorular.filter(q => q.durum === 'Y').length, db = sorular.length - dd - dy;
      const net = +(dd - dy / cfg.katsayi).toFixed(2);
      st.dersler.push({ kod: d.kod, ad: d.ad, soru: d.soru, dogru: dd, yanlis: dy, net, basari: Math.round(100 * dd / d.soru) });
      st.cevaplar.push({ kod: d.kod, verilen: v, anahtar: k, sorular, dogru: dd, yanlis: dy, bos: db });
      D += dd; Y += dy; B += db;
    }
    st.toplam = { soru: toplam, dogru: D, yanlis: Y, net: +(D - Y / cfg.katsayi).toFixed(2), basari: Math.round(100 * D / toplam) };
    if (!ad) st.hatalar.push('ad boş');
    ogrenciler.push(st);
  }
  // kurum içi sıra (net'e göre)
  [...ogrenciler].sort((a, b) => b.toplam.net - a.toplam.net).forEach((s, i) => { s.sira = { kurum: i + 1 }; });
  return { ad: cfg.ad, yayinevi: cfg.yayinevi, tur: cfg.tur, katilim: { kurum: ogrenciler.length }, ogrenciler };
}
return { parse, parseHeader, parseResultPage, toLines, pageItems, parseOptik };
}));

const SUPA='https://mmcvpttkoxjfwczpckxq.supabase.co';
const KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tY3ZwdHRrb3hqZndjenBja3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODYzNDQsImV4cCI6MjEwMzE2MjM0NH0.ISqD-nOW5ef85W-sdedYrliCekOXilwDn7zyU-4Mt5o';
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const gid=i=>document.getElementById(i);
const _yok=new Map();const $=i=>gid(i)||(_yok.get(i)||(_yok.set(i,document.createElement('div')),_yok.get(i)));  // sayfada olmayan öğe için sessiz yedek
let token=null,uid=null,rol=null,BEN=null,KURUM=null,A=null,karne=null,grafikler={},ogrenciler=[],sonuc=null;

async function rest(m,yol,g,pref){const y=await fetch(SUPA+'/rest/v1/'+yol,{method:m,headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:pref||'return=representation'},body:g?JSON.stringify(g):undefined});
  if(y.status===204)return null;const d=await y.json();if(!y.ok)throw new Error(d.message||d.hint||JSON.stringify(d));return d;}
async function rpc(yol,g){const y=await fetch(SUPA+'/rest/v1/rpc/'+yol,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(g||{})});
  const t=await y.text();const d=t?JSON.parse(t):null;if(!y.ok)throw new Error((d&&d.message)||t);return d;}
async function depoYukle(kova,ad,blob,tip){const y=await fetch(SUPA+'/storage/v1/object/'+kova+'/'+ad,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':tip||'application/octet-stream','x-upsert':'true'},body:blob});
  if(!y.ok)throw new Error('Yükleme başarısız');return SUPA+'/storage/v1/object/public/'+kova+'/'+ad;}
const norm=s=>(s||'').toUpperCase().replace(/[ÇĞİÖŞÜ]/g,c=>({Ç:'C',Ğ:'G',İ:'I',Ö:'O',Ş:'S',Ü:'U'}[c])).replace(/[çğıöşü]/g,c=>({ç:'C',ğ:'G',ı:'I',ö:'O',ş:'S',ü:'U'}[c])).replace(/\s+/g,' ').trim();
const f2=x=>x==null?'—':(+x).toFixed(2);
const bugunStr=()=>new Date().toISOString().slice(0,10);
const basHarf=ad=>(ad||'?').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const fotoUrl=y=>y?SUPA+'/storage/v1/object/public/profil-foto/'+y:'';
function grafik(id,cfg){if(!window.Chart||!gid(id))return;if(grafikler[id])grafikler[id].destroy();grafikler[id]=new Chart($(id),cfg);}
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2600);}
const kacis=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---- tema ---- */
function temaUygula(k){
  KURUM=k||KURUM;if(!KURUM)return;const t=(KURUM.ayarlar&&KURUM.ayarlar.tema)||{};
  if(t.menu)document.documentElement.style.setProperty('--lacivert',t.menu);
  if(t.vurgu)document.documentElement.style.setProperty('--mavi-koyu',t.vurgu);
  document.querySelectorAll('img.logo-img').forEach(i=>{if(KURUM.logo_yolu)i.src=KURUM.logo_yolu;});
  if(KURUM.ad)document.title=KURUM.ad+' — '+(document.body.dataset.baslik||'Panel');
}

/* ---- oturum ---- */
const SAYFA={yonetici:'yonetici.html',ogretmen:'ogretmen.html',ogrenci:'ogrenci.html',veli:'ogrenci.html'};
async function girisYap(tel,sifre){
  const y=await fetch(SUPA+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({email:tel.trim()+'@mentorcall.local',password:sifre})});
  const d=await y.json();if(!d.access_token)throw new Error(d.error_description||d.msg||'Telefon veya şifre hatalı');
  localStorage.setItem('mc_oturum',JSON.stringify({a:d.access_token,r:d.refresh_token}));token=d.access_token;uid=d.user.id;
}
async function oturumYukle(){
  let k=null;try{k=JSON.parse(localStorage.getItem('mc_oturum')||'null')}catch(e){}
  if(!k||!k.a)return false;token=k.a;uid=JSON.parse(atob(k.a.split('.')[1])).sub;
  try{return !!(await profilYukle());}
  catch(e){
    if(!k.r)return false;
    const y=await fetch(SUPA+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:k.r})});
    const d=await y.json();if(!d.access_token){localStorage.removeItem('mc_oturum');return false;}
    localStorage.setItem('mc_oturum',JSON.stringify({a:d.access_token,r:d.refresh_token}));token=d.access_token;
    return !!(await profilYukle());
  }
}
async function profilYukle(){BEN=(await rest('GET','profiller?select=*&id=eq.'+uid))[0];rol=BEN&&BEN.rol;return BEN;}
function cikisYap(){localStorage.removeItem('mc_oturum');location.href='giris.html';}

/* ---- kabuk ---- */
const IK={pano:'<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/></svg>',
  analiz:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 13l4-5 3 3 5-7"/></svg>',
  cubuk:'<svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="8" width="3" height="6" rx="1"/><rect x="6.5" y="4" width="3" height="10" rx="1"/><rect x="11" y="1" width="3" height="13" rx="1"/></svg>',
  aktar:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2 13h12"/></svg>',
  sinav:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h6M5 9h4"/></svg>',
  odev:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4h10M3 8h10M3 12h6"/><path d="M10 11l1.5 1.5L14 10"/></svg>',
  kisi:'<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 3-5 6-5s6 2 6 5z"/></svg>',
  kisiler:'<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="5.5" cy="5" r="2.5"/><circle cx="11" cy="6" r="2"/><path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4z"/><path d="M9.5 13c0-1.6.8-2.8 2-3.4 2 0 3.5 1.4 3.5 3.4z"/></svg>',
  karne:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2h6l3 3v9H4z"/><path d="M6 8h5M6 11h5"/></svg>',
  rapor:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 14h10M4 11l3-4 3 2 3-5"/></svg>',
  ayar:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>',
  ev:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 8l6-5 6 5v6H2z"/></svg>',
  cikis:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2H3v12h3M10 5l3 3-3 3M13 8H6"/></svg>',
  grup:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 7h12M6 3v10"/></svg>'};
const ik={kisi:IK.kisi,gun:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5 1v3M11 1v3"/></svg>',
  saat:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/></svg>',
  yer:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 15s5-5 5-8.5a5 5 0 0 0-10 0C3 10 8 15 8 15z"/><circle cx="8" cy="6.5" r="1.8"/></svg>'};
const PASTEL=['mor','sari','mavi','yesil','pembe'];

let MENU=[],AKTIF=null;
/* MENU: [{id:'bPano',ad:'Pano',ik:'pano',grup:'Genel',mobil:true} | {href:'istasyon.html',ad:'Soru istasyonu',ik:'sinav'}] */
function kabukKur(menu,baslik){
  MENU=menu;document.body.dataset.baslik=baslik||'';
  const gruplar=[];menu.forEach(m=>{const g=m.grup||'';let x=gruplar.find(y=>y.ad===g);if(!x){x={ad:g,l:[]};gruplar.push(x);}x.l.push(m);});
  const link=m=>m.href?`<a href="${m.href}">${IK[m.ik]||''}${m.ad}</a>`:`<a data-bolum="${m.id}">${IK[m.ik]||''}${m.ad}</a>`;
  $('menu').innerHTML=`<div class="logo"><img class="logo-img" src="https://www.mentorcall.com.tr/wp-content/uploads/2025/05/mentorcall-logo.png" alt=""></div>
    <nav class="menu">${gruplar.map(g=>(g.ad?`<p>${g.ad}</p>`:'')+g.l.map(link).join('')).join('')}
    <div class="alt"><a id="cikis">${IK.cikis}Çıkış</a></div></nav>`;
  const mobil=menu.filter(m=>m.mobil);
  if(mobil.length)document.body.insertAdjacentHTML('beforeend',`<nav class="alt-sekme">${mobil.map(link).join('')}</nav>`);
  document.body.insertAdjacentHTML('beforeend','<div class="perde" id="perde"></div>');
  document.querySelectorAll('a[data-bolum]').forEach(a=>a.onclick=()=>bolumAc(a.dataset.bolum));
  $('cikis').onclick=cikisYap;
  $('hamburger').onclick=()=>{$('menu').classList.toggle('acik');$('perde').classList.toggle('acik');};
  $('perde').onclick=()=>{$('menu').classList.remove('acik');$('perde').classList.remove('acik');};
  $('kimlik').textContent=BEN.ad_soyad;$('avatar').innerHTML=BEN.foto_yolu?`<img src="${fotoUrl(BEN.foto_yolu)}" alt="">`:basHarf(BEN.ad_soyad);
  const b=$('bugun');if(b)b.textContent=new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric',weekday:'long'});
  const s=$('selam');if(s)s.textContent='👋 Hoş geldin, '+BEN.ad_soyad.split(' ')[0]+'!';
  window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id&&gid(id))bolumAc(id,true);});
}
const BOLUM_YUKLE={};   // id → async fn (her açılışta çalışır)
function bolumAc(id,hashten){
  if(!gid(id))return;AKTIF=id;
  document.querySelectorAll('a[data-bolum]').forEach(x=>x.classList.toggle('aktif',x.dataset.bolum===id));
  document.querySelectorAll('main > section').forEach(s=>s.classList.toggle('gizli',s.id!==id));
  $('menu').classList.remove('acik');if($('perde'))$('perde').classList.remove('acik');
  if(!hashten)history.replaceState(null,'','#'+id);
  window.scrollTo({top:0});
  if(BOLUM_YUKLE[id])BOLUM_YUKLE[id]().catch(e=>toast('Hata: '+e.message));
}
async function uygulamaBaslat(opts){
  const ok=await oturumYukle();
  if(!ok){location.href='giris.html';return;}
  if(opts.roller&&!opts.roller.includes(rol)){location.href=SAYFA[rol]||'index.html';return;}
  try{temaUygula(await rpc('kurum_ayarlarim'));}catch(e){}
  document.querySelectorAll('main > section').forEach(s=>{if(s.dataset.sablon&&SABLON[s.dataset.sablon])s.innerHTML=SABLON[s.dataset.sablon];});
  kabukKur(opts.menu,opts.baslik);
  if(opts.hazirla)await opts.hazirla();
  const ilk=location.hash.slice(1);bolumAc(ilk&&gid(ilk)?ilk:opts.ilk||opts.menu.find(m=>m.id).id);
}

/* ---- şablonlar (bölüm içerikleri) ---- */
const SABLON={"bPano": "<div class=\"pano\">\n    <div class=\"pano-sol\">\n      <div class=\"baslik\"><h1 id=\"selam\">👋 Hoş geldin</h1><span class=\"tarih\" id=\"bugun\"></span></div>\n\n      <div class=\"kapak\">\n        <div class=\"kapak-metin\">\n          <h2 id=\"kapakBaslik\">Haftalık programın hazır</h2>\n          <p id=\"kapakAlt\">Deneme sonuçlarına göre hazırlanan çalışma programını incele, eksik kazanımlarını gör ve bu hafta neye odaklanacağını öğren.</p>\n          <button class=\"ana\" id=\"kapakBtn\">Programı aç <span>→</span></button>\n        </div>\n      </div>\n\n      <div class=\"bolum-bas\"><h2 id=\"kartBaslik\">Sınıflarım</h2><a data-bolum=\"bAnaliz\" class=\"link\">Tümünü gör ›</a></div>\n      <div class=\"kart-izgara\" id=\"panoKartlar\"></div>\n\n      <div class=\"bolum-bas\"><h2>Deneme panosu</h2><a data-bolum=\"bKurum\" class=\"link personel\">Tümünü gör ›</a></div>\n      <div class=\"kart tablo-kart\">\n        <table><thead><tr><th>Deneme adı</th><th>Yayınevi</th><th>Tarih</th><th>Öğrenci</th><th>Ort. net</th><th>Durum</th><th></th></tr></thead><tbody id=\"panoDenemeler\"></tbody></table>\n      </div>\n    </div>\n\n    <aside class=\"pano-sag\">\n      <div class=\"ilerleme\"><span>Deneme <b id=\"ilerlemeSay\">0</b> / <span id=\"ilerlemeToplam\">60</span></span><div class=\"cubuk\"><i id=\"ilerlemeCubuk\" style=\"width:0%\"></i></div></div>\n      <div class=\"takvim\">\n        <div class=\"takvim-bas\"><button id=\"takOnce\">‹</button><b id=\"takAd\"></b><button id=\"takSonra\">›</button></div>\n        <div class=\"takvim-gunler\"><span>Pt</span><span>Sa</span><span>Ça</span><span>Pe</span><span>Cu</span><span>Ct</span><span>Pz</span></div>\n        <div class=\"takvim-izgara\" id=\"takIzgara\"></div>\n        <div class=\"takvim-alt\"><i class=\"nokta mavi-n\"></i>deneme <i class=\"nokta sari-n\"></i>ödev</div>\n      </div>\n      <div class=\"bolum-bas\"><h2 id=\"odevBaslik\">Ödevler</h2><a href=\"index.html\" class=\"link\">Tümünü gör ›</a></div>\n      <div id=\"panoOdevler\"></div>\n    </aside>\n  </div>", "bAnaliz": "<div class=\"kart gizli\" id=\"sec\"><div class=\"satir\"><label>Öğrenci <select id=\"ogrenciSec\"></select></label><span class=\"kucuk\" id=\"ogrBilgi\"></span></div></div>\n\n<div class=\"gizli\" id=\"analiz\">\n  <div class=\"izgara\">\n    <div class=\"kart\"><h2>Deneme gelişimi (net)</h2><canvas id=\"gNet\" height=\"160\"></canvas>\n      <div class=\"kucuk\">Koyu: öğrenci · Açık: kurum ortalaması</div></div>\n    <div class=\"kart\"><h2>Puan ve sıralama</h2><canvas id=\"gPuan\" height=\"160\"></canvas><div id=\"siraTablo\"></div></div>\n  </div>\n  <div class=\"kart\"><h2>Ders bazında net (son deneme ve önceki)</h2><canvas id=\"gDers\" height=\"180\"></canvas></div>\n  <div class=\"izgara\">\n    <div class=\"kart\"><h2>Ders bazında kazanım başarısı (tüm denemeler)</h2><div id=\"dersOzet\"></div></div>\n    <div class=\"kart\"><h2>En zayıf kazanımlar</h2><table><thead><tr><th>Ders</th><th>Kazanım</th><th>S/D/Y/B</th><th>Deneme</th><th>%</th></tr></thead><tbody id=\"zayif\"></tbody></table></div>\n  </div>\n  <div class=\"kart\"><h2>Deneme listesi</h2><table><thead><tr><th>Tarih</th><th>Deneme</th><th>Kitapçık</th><th>D/Y/B</th><th>Net</th><th>Puan</th><th>Sınıf</th><th>Kurum</th><th>İlçe</th><th>İl</th><th>Genel</th></tr></thead><tbody id=\"denemeListe\"></tbody></table></div>\n\n  <div class=\"kart\" id=\"karneKart\">\n    <div class=\"satir\"><h2 style=\"margin:0\">Karne ve haftalık program</h2>\n      <span id=\"karneDurum\" class=\"etiket gri\">—</span>\n      <span style=\"margin-left:auto\" class=\"satir personel\">\n        <label>Hafta <input type=\"date\" id=\"hafta\"></label>\n        <button class=\"ana\" id=\"uretBtn\">Yeni karne üret</button></span></div>\n    <div id=\"karneIcerik\" class=\"kucuk\" style=\"margin-top:10px\">Henüz karne yok.</div>\n    <div class=\"personel gizli\" id=\"onayAlani\" style=\"margin-top:12px\">\n      <textarea id=\"ogrNot\" rows=\"2\" style=\"width:100%\" placeholder=\"Öğretmen notu (isteğe bağlı)\"></textarea>\n      <div class=\"satir\" style=\"margin-top:8px\"><button class=\"ana\" id=\"yayinlaBtn\">Onayla ve yayınla</button><button id=\"veliKopya\">Veli notunu kopyala</button><span id=\"onayDurum\" class=\"kucuk\"></span></div>\n    </div>\n  </div>\n</div>", "bKurum": "<div class=\"kart\"><div class=\"satir\"><label>Deneme <select id=\"kDenemeSec\"></select></label><span id=\"kOzet\" class=\"kucuk\"></span></div></div>\n  <div id=\"kIcerik\" class=\"gizli\">\n    <div class=\"izgara\">\n      <div class=\"kart\"><h2>Ders ortalamaları (net)</h2><canvas id=\"kgDers\" height=\"170\"></canvas></div>\n      <div class=\"kart\"><h2>Sınıf kıyası (ortalama net)</h2><canvas id=\"kgSinif\" height=\"170\"></canvas></div>\n    </div>\n    <div class=\"izgara\">\n      <div class=\"kart\"><h2>Net dağılımı</h2><canvas id=\"kgDagilim\" height=\"170\"></canvas></div>\n      <div class=\"kart\"><h2>Kurumun en çok kaçırdığı kazanımlar</h2><table><thead><tr><th>Ders</th><th>Kazanım</th><th>S/D/Y/B</th><th>%</th></tr></thead><tbody id=\"kZayif\"></tbody></table></div>\n    </div>\n    <div class=\"kart\"><h2>Öğrenciler</h2><table><thead><tr><th>#</th><th>Öğrenci</th><th>Sınıf</th><th>Net</th><th>Puan</th><th id=\"kDersBaslik\"></th><th>Kurum</th><th>İl</th><th>Genel</th></tr></thead><tbody id=\"kOgrenciler\"></tbody></table></div>\n  </div>", "bAktar": "<div class=\"kart gizli\" id=\"yukle\">\n  <h2>1. Yayınevi sonuç PDF'ini seç</h2>\n  <div class=\"satir\">\n    <input type=\"file\" id=\"dosya\" accept=\"application/pdf\">\n    <label>Sınav tarihi <input type=\"date\" id=\"tarih\"></label>\n    <label><input type=\"checkbox\" id=\"uzerine\"> Aynı deneme varsa üzerine yaz</label>\n  </div>\n  <div id=\"durum\">PDF seçince otomatik okunur; sonra öğrenci eşleştirmesini kontrol edip aktarırsın.</div>\n</div>\n\n<div class=\"kart gizli\" id=\"optik\">\n  <h2>1b. Alternatif: kurum optik okuyucu .txt (yayınevi PDF'i gelmeden hızlı net)</h2>\n  <div class=\"satir\">\n    <input type=\"file\" id=\"txtDosya\" accept=\".txt\">\n    <input id=\"oAd\" placeholder=\"Deneme adı (örn. FORMULA LGS TG)\" style=\"width:220px\">\n    <input id=\"oYayinevi\" placeholder=\"Yayınevi\" style=\"width:120px\">\n    <select id=\"oTur\"><option>LGS</option><option>TYT</option><option>AYT</option></select>\n  </div>\n  <div class=\"satir\" style=\"margin-top:8px\">\n    <input id=\"oDersler\" style=\"width:100%\" placeholder=\"Dersler ve soru sayıları — örn. TUR:Türkçe:20, TAR:Tarih:10, DIN:Din:10, ING:İngilizce:10, MAT:Matematik:20, FEN:Fen:20\">\n  </div>\n  <div class=\"satir\" style=\"margin-top:8px\">\n    <input id=\"oAnahtarA\" style=\"width:49%\" placeholder=\"Cevap anahtarı A kitapçığı (tüm dersler art arda)\">\n    <input id=\"oAnahtarB\" style=\"width:49%\" placeholder=\"Cevap anahtarı B kitapçığı (varsa)\">\n  </div>\n  <div class=\"satir\" style=\"margin-top:8px\"><button class=\"ana\" id=\"optikOku\">Oku</button><span id=\"optikDurum\" class=\"kucuk\">Kazanım analizi bu yoldan gelmez; sadece net ve kurum içi sıra hesaplanır.</span></div>\n</div>\n\n<div class=\"kart gizli\" id=\"onizle\">\n  <h2>2. Okunan sonuçlar — <span id=\"ozet\"></span></h2>\n  <table><thead><tr><th>#</th><th>PDF'deki ad</th><th>Sınıf</th><th>Kitapçık</th><th>Puan</th><th>Net</th><th>Sistemdeki öğrenci</th><th>Kontrol</th></tr></thead>\n  <tbody id=\"satirlar\"></tbody></table>\n  <div class=\"satir\" style=\"margin-top:12px\"><button class=\"ana\" id=\"aktarBtn\">Aktar</button><span id=\"aktarDurum\"></span></div>\n</div>\n\n<div class=\"kart gizli\" id=\"kuyrukKart\">\n  <h2>Eşleşmeyen sonuçlar</h2>\n  <table><thead><tr><th>Deneme</th><th>PDF'deki ad</th><th>Sınıf</th><th>Puan</th><th>Öğrenci</th><th></th></tr></thead><tbody id=\"kuyruk\"></tbody></table>\n</div>\n\n<div class=\"kart gizli\" id=\"listeKart\">\n  <h2>Aktarılmış denemeler</h2>\n  <table><thead><tr><th>Yayınevi</th><th>Ad</th><th>Tür</th><th>Tarih</th><th>Katılım (kurum/il/genel)</th><th>Öğrenci</th></tr></thead><tbody id=\"liste\"></tbody></table>\n</div>"};

/* ---- pano ---- */
let takAy=new Date(),takVeri={};
function takvimCiz(){
  const y=takAy.getFullYear(),m=takAy.getMonth();
  $('takAd').textContent=takAy.toLocaleDateString('tr-TR',{month:'long',year:'numeric'});
  const ilk=new Date(y,m,1),bas=(ilk.getDay()+6)%7,gunSay=new Date(y,m+1,0).getDate(),oncekiSay=new Date(y,m,0).getDate();
  const bugun=new Date().toISOString().slice(0,10);let html='';
  for(let i=0;i<42;i++){
    let g=i-bas+1,dis=false,dt;
    if(g<1){g=oncekiSay+g;dis=true;dt=new Date(y,m-1,g);}else if(g>gunSay){g-=gunSay;dis=true;dt=new Date(y,m+1,g);}else dt=new Date(y,m,g);
    const k=new Date(dt.getTime()-dt.getTimezoneOffset()*6e4).toISOString().slice(0,10);const v=takVeri[k]||{};
    html+=`<span class="${dis?'dis':''}${k===bugun?' bugun':''}${v.d?' d':''}${v.o?' o':''}" title="${(v.b||[]).join(', ')}">${g}</span>`;
    if(i>=34&&(i+1)%7===0&&g>=gunSay&&!dis)break;
  }
  $('takIzgara').innerHTML=html;
}
$('takOnce').onclick=()=>{takAy=new Date(takAy.getFullYear(),takAy.getMonth()-1,1);takvimCiz();};
$('takSonra').onclick=()=>{takAy=new Date(takAy.getFullYear(),takAy.getMonth()+1,1);takvimCiz();};

async function panoYukle(){
  const personel=['yonetici','ogretmen'].includes(rol);
  const d=await rest('GET','denemeler?select=id,ad,yayinevi,tarih,katilim_kurum,deneme_sonuclar(count)&order=tarih.desc.nullslast,created_at.desc&limit=8');
  takVeri={};d.forEach(x=>{if(x.tarih){(takVeri[x.tarih]=takVeri[x.tarih]||{b:[]}).d=1;takVeri[x.tarih].b.push(x.ad);}});
  const bugun=new Date().toISOString().slice(0,10);
  $('panoDenemeler').innerHTML=d.map(x=>{const n=x.deneme_sonuclar?.[0]?.count??0;const dur=!x.tarih?'gri':x.tarih>bugun?'uyari':n?'ok':'gri';
    return `<tr><td><b>${x.ad}</b></td><td>${x.yayinevi}</td><td>${x.tarih||'—'}</td><td>${n}</td><td id="on_${x.id}">—</td><td><span class="etiket ${dur}">${dur==='uyari'?'Yaklaşan':n?'Tamamlandı':'Bekliyor'}</span></td><td>⋮</td></tr>`;}).join('')
    ||'<tr><td colspan="7" class="kucuk">Henüz deneme yok — Deneme aktar bölümünden yükleyebilirsin.</td></tr>';
  $('ilerlemeSay').textContent=d.length;$('ilerlemeCubuk').style.width=Math.min(100,d.length/60*100)+'%';

  if(personel){
    $('kapakBaslik').textContent='Yeni deneme sonuçlarını aktar';$('kapakAlt').textContent='Yayınevi PDF\'ini yükle; öğrenci eşleştirmesini kontrol et, karneleri tek tıkla üret ve onayla.';
    $('kapakBtn').innerHTML='Deneme aktar <span>→</span>';$('kapakBtn').onclick=()=>bolumAc('bAktar');
    const sn=await rest('GET','siniflar?select=id,ad,aciklama,sinif_ogrenciler(count),sinif_ogretmenler(profiller(ad_soyad))&aktif=eq.true&order=ad&limit=8');
    $('kartBaslik').textContent='Sınıflar';
    $('panoKartlar').innerHTML=sn.map((s,i)=>`<div class="dkart ${PASTEL[i%5]}"><b>${s.ad}</b><div>${ik.kisi}${(s.sinif_ogretmenler||[]).map(t=>t.profiller?.ad_soyad).filter(Boolean).join(', ')||'Öğretmen atanmamış'}</div><div>${ik.gun}${s.sinif_ogrenciler?.[0]?.count??0} öğrenci</div>${s.aciklama?`<div>${ik.yer}${s.aciklama}</div>`:''}</div>`).join('')||'<div class="kucuk">Sınıf yok.</div>';
    const kuyruk=await rest('GET','deneme_eslesme_kuyrugu?select=sonuc_id,ham_ad,deneme_ad');
    const taslak=await rest('GET','karneler?select=id,hafta_baslangic,profiller!karneler_ogrenci_id_fkey(ad_soyad)&durum=eq.taslak&order=created_at.desc&limit=5');
    const odev=await rest('GET','gorevler?select=id,tarih,ders,konu,yapilan,onaylandi,profiller!gorevler_ogrenci_id_fkey(ad_soyad)&onaylandi=eq.false&yapilan=not.is.null&order=tarih.desc&limit=5');
    $('odevBaslik').textContent='Bekleyen işler';
    $('panoOdevler').innerHTML=[
      ...kuyruk.slice(0,3).map(k=>`<div class="okart gec"><b>${k.ham_ad||'(adsız)'}<span class="etiket hata">Eşleşmedi</span></b><p>${k.deneme_ad}</p></div>`),
      ...taslak.map(k=>`<div class="okart"><b>${k.profiller?.ad_soyad||''}<span class="etiket uyari">Karne onayı</span></b><p>Hafta: ${k.hafta_baslangic}</p></div>`),
      ...odev.map(g=>`<div class="okart"><b>${g.profiller?.ad_soyad||''}<span class="etiket uyari">Ödev onayı</span></b><p>${g.ders||''} · ${g.konu||''}</p></div>`)
    ].join('')||'<div class="kucuk">Bekleyen iş yok.</div>';
  }else{
    if(!A)await yukle(uid);const D=A?.denemeler||[];
    if(!A?.son_karne){$('kapakBaslik').textContent='Deneme sonuçlarını incele';$('kapakAlt').textContent='Denemelerdeki gelişimini, ders bazında netlerini ve eksik kazanımlarını gör.';$('kapakBtn').innerHTML='Analizi aç <span>→</span>';}
    $('kartBaslik').textContent='Son denemelerim';
    $('panoKartlar').innerHTML=D.slice().reverse().slice(0,4).map((x,i)=>`<div class="dkart ${PASTEL[i%5]}"><b>${x.ad}</b><div>${ik.gun}${x.tarih||'—'}</div><div>${ik.saat}Net ${f2(x.net)} · Puan ${x.puan??'—'}</div><div>${ik.yer}Kurum ${x.sira_kurum??'—'} · İl ${x.sira_il??'—'}</div></div>`).join('')||'<div class="kucuk">Henüz deneme sonucun yok.</div>';
    D.forEach(x=>{const e=$('on_'+x.id);if(e)e.textContent=f2(x.kurum_ort_net);});
    const g=await rest('GET','gorevler?select=id,tarih,ders,konu,tur,hedef,birim,yapilan,onaylandi&ogrenci_id=eq.'+uid+'&order=tarih.desc&limit=6');
    g.forEach(x=>{(takVeri[x.tarih]=takVeri[x.tarih]||{b:[]}).o=1;takVeri[x.tarih].b.push((x.ders||'')+' '+(x.konu||''));});
    $('panoOdevler').innerHTML=g.map(x=>{const dur=x.onaylandi?['tamam','ok','Tamamlandı']:x.yapilan!=null?['','uyari','Onay bekliyor']:x.tarih<bugun?['gec','hata','Gecikti']:['','gri','Başlanmadı'];
      return `<div class="okart ${dur[0]}"><b>${x.ders||'Ödev'}<span class="etiket ${dur[1]}">${dur[2]}</span></b><p>${x.konu||''}${x.hedef?` · ${x.hedef} ${x.birim||''}`:''}</p><p>Tarih: ${x.tarih}</p></div>`;}).join('')||'<div class="kucuk">Ödev yok.</div>';
  }
  takvimCiz();
}

/* ---- öğrenci analizi ---- */
/* ---- analiz ---- */
async function yukle(ogrenciId){
  A=await rpc('ogrenci_analiz',{p_ogrenci_id:ogrenciId});
  if(!A){alert('Yetki yok');return;}
  $('analiz').classList.remove('gizli');
  $('ogrBilgi').textContent=(A.ogrenci.siniflar||[]).join(', ');
  const D=A.denemeler||[];const et=D.map(d=>(d.tarih||'')+' '+d.ad);
  grafik('gNet',{type:'line',data:{labels:et,datasets:[{label:'Net',data:D.map(d=>d.net),borderColor:'#1c2333',tension:.3},{label:'Kurum ort.',data:D.map(d=>d.kurum_ort_net),borderColor:'#b8bec7',borderDash:[4,4],tension:.3}]},options:{plugins:{legend:{display:false}}}});
  grafik('gPuan',{type:'line',data:{labels:et,datasets:[{label:'Puan',data:D.map(d=>d.puan),borderColor:'#1c2333',tension:.3},{label:'Kurum ort.',data:D.map(d=>d.kurum_ort_puan),borderColor:'#b8bec7',borderDash:[4,4],tension:.3}]},options:{plugins:{legend:{display:false}}}});
  const son=D[D.length-1],onc=D[D.length-2];
  if(son){grafik('gDers',{type:'bar',data:{labels:(son.dersler||[]).map(x=>x.ad),datasets:[
      {label:son.ad,data:(son.dersler||[]).map(x=>x.net),backgroundColor:'#1c2333'},
      {label:'Kurum ort.',data:(son.dersler||[]).map(x=>x.kurum_ort_net),backgroundColor:'#b8bec7'},
      ...(onc?[{label:onc.ad,data:(son.dersler||[]).map(x=>{const y=(onc.dersler||[]).find(z=>z.kod===x.kod);return y?y.net:null;}),backgroundColor:'#7c8798'}]:[])]}});}
  $('siraTablo').innerHTML=son?`<div class="kucuk" style="margin-top:8px">Son deneme: kurum ${son.sira_kurum}/${son.katilim_kurum} · ilçe ${son.sira_ilce||'—'} · il ${son.sira_il||'—'}/${son.katilim_il||'—'} · genel ${son.sira_genel||'—'}/${son.katilim_genel||'—'}</div>`:'';
  $('dersOzet').innerHTML=(A.ders_ozet||[]).sort((a,b)=>a.basari-b.basari).map(d=>`<div style="margin:6px 0"><div class="satir" style="justify-content:space-between"><b>${d.ders_kod}</b><span class="kucuk">${d.dogru}/${d.soru} · %${d.basari}</span></div><div class="cubuk"><i style="width:${d.basari}%"></i></div></div>`).join('')||'<span class="kucuk">Veri yok</span>';
  $('zayif').innerHTML=(A.kazanimlar||[]).filter(k=>k.basari_yuzde<100).slice(0,25).map(k=>`<tr><td>${k.ders_kod}</td><td>${k.metin}</td><td>${k.soru}/${k.dogru}/${k.yanlis}/${k.bos}</td><td>${k.deneme_sayisi}</td><td><span class="etiket ${k.basari_yuzde<50?'hata':'uyari'}">${k.basari_yuzde}</span></td></tr>`).join('')||'<tr><td colspan="5" class="kucuk">Zayıf kazanım yok.</td></tr>';
  $('denemeListe').innerHTML=D.slice().reverse().map(d=>`<tr><td>${d.tarih||'—'}</td><td>${d.ad}</td><td>${d.kitapcik||''}</td><td>${d.dogru}/${d.yanlis}/${d.bos}</td><td>${f2(d.net)}</td><td>${d.puan||'—'}</td><td>${d.sira_sinif||'—'}</td><td>${d.sira_kurum||'—'}</td><td>${d.sira_ilce||'—'}</td><td>${d.sira_il||'—'}</td><td>${d.sira_genel||'—'}</td></tr>`).join('')||'<tr><td colspan="11" class="kucuk">Deneme yok.</td></tr>';
  await karneYukle(ogrenciId);
}

/* ---- karne ---- */
async function karneYukle(ogrenciId){
  const personel=['yonetici','ogretmen'].includes(rol);
  const ks=await rest('GET',`karneler?select=*&ogrenci_id=eq.${ogrenciId}&order=created_at.desc&limit=1`+(personel?'':'&durum=eq.yayinda'));
  karne=ks[0]||null;karneCiz();
}
function karneCiz(){
  const k=karne;$('onayAlani').classList.toggle('gizli',!(k&&k.durum==='taslak'&&['yonetici','ogretmen'].includes(rol)));
  if(!k){$('karneDurum').textContent='karne yok';$('karneDurum').className='etiket gri';$('karneIcerik').innerHTML='Henüz karne yok.';return;}
  $('karneDurum').textContent=k.durum+' · '+k.hafta_baslangic;$('karneDurum').className='etiket '+(k.durum==='yayinda'?'ok':'uyari');
  const c=k.icerik||{};
  $('karneIcerik').innerHTML=`
    <p style="font-size:14px;color:#1c2333">${c.ozet||''}</p>
    ${k.ogretmen_notu?`<p><b>Öğretmen notu:</b> ${k.ogretmen_notu}</p>`:''}
    <h3>Güçlü yanlar</h3><ul>${(c.guclu_yanlar||[]).map(x=>`<li>${x}</li>`).join('')}</ul>
    <h3>Öncelikli eksikler</h3><table><thead><tr><th>#</th><th>Ders</th><th>Kazanım</th><th>%</th><th>Neden</th></tr></thead><tbody>
      ${(c.eksikler||[]).map(e=>`<tr><td>${e.oncelik}</td><td>${e.ders}</td><td>${e.kazanim}</td><td>${e.basari??'—'}</td><td>${e.neden||''}</td></tr>`).join('')}</tbody></table>
    <h3>Haftalık program</h3><table><thead><tr><th>Gün</th><th>Bloklar</th></tr></thead><tbody>
      ${(c.haftalik_program||[]).map(g=>`<tr><td><b>${g.gun}</b></td><td>${(g.bloklar||[]).map(b=>`<div><b>${b.ders}</b> · ${b.konu} — ${b.etkinlik} <span class="kucuk">(${b.sure_dk} dk)</span></div>`).join('')}</td></tr>`).join('')}</tbody></table>
    <h3>Çözülecek soru</h3><div class="satir">${(c.cozulecek_sorular||[]).map(s=>`<span class="etiket gri" title="${s.aciklama||''}">${s.ders}: ${s.soru}</span>`).join('')}</div>
    ${c.hedef?`<h3>Hedef</h3><div>Sonraki deneme net hedefi: <b>${c.hedef.sonraki_deneme_net}</b> — ${c.hedef.aciklama||''}</div>`:''}
    ${c.veli_notu?`<h3>Veli notu</h3><div id="veliNot">${c.veli_notu}</div>`:''}`;
}
$('uretBtn').onclick=async()=>{
  const og=$('ogrenciSec').value;if(!og)return alert('Öğrenci seç.');
  $('uretBtn').disabled=true;$('karneIcerik').textContent='Karne üretiliyor (20-40 sn)…';
  try{
    const y=await fetch(SUPA+'/functions/v1/karne_uret',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({ogrenci_id:og,hafta_baslangic:$('hafta').value||null})});
    const d=await y.json();if(d.error)throw new Error(d.error);
    karne=d.karne;karneCiz();
  }catch(e){$('karneIcerik').textContent='Hata: '+e.message;}
  $('uretBtn').disabled=false;
};
$('yayinlaBtn').onclick=async()=>{
  try{await rpc('karne_yayinla',{p_karne_id:karne.id,p_not:$('ogrNot').value||null});$('onayDurum').textContent='Yayınlandı.';await karneYukle($('ogrenciSec').value);}
  catch(e){$('onayDurum').textContent='Hata: '+e.message;}};
$('veliKopya').onclick=()=>{const t=($('veliNot')||{}).textContent||'';if(t)navigator.clipboard.writeText(t).then(()=>$('onayDurum').textContent='Veli notu kopyalandı.');};

/* ---- kurum deneme analizi ---- */
let K=null;
async function kurumDenemeleriYukle(){
  if($('kDenemeSec').options.length)return;
  const d=await rest('GET','denemeler?select=id,ad,tarih,yayinevi&order=tarih.desc.nullslast,created_at.desc');
  $('kDenemeSec').innerHTML='<option value="">— seç —</option>'+d.map(x=>`<option value="${x.id}">${x.tarih||''} ${x.ad}</option>`).join('');
  $('kDenemeSec').onchange=()=>$('kDenemeSec').value&&kurumAnaliz($('kDenemeSec').value);
}
async function kurumAnaliz(id){
  K=await rpc('deneme_analiz',{p_deneme_id:id});if(!K)return alert('Yetki yok');
  $('kIcerik').classList.remove('gizli');
  const o=K.ozet||{};$('kOzet').textContent=`${o.ogrenci} öğrenci · ort. net ${f2(o.ort_net)} · ort. puan ${o.ort_puan??'—'} · en yüksek ${f2(o.max_net)} · en düşük ${f2(o.min_net)}`;
  grafik('kgDers',{type:'bar',data:{labels:K.dersler.map(d=>d.ad),datasets:[{label:'Ortalama net',data:K.dersler.map(d=>d.ort_net),backgroundColor:'#1c2333'},{label:'En yüksek',data:K.dersler.map(d=>d.max_net),backgroundColor:'#b8bec7'}]}});
  grafik('kgSinif',{type:'bar',data:{labels:K.siniflar.map(s=>s.sinif),datasets:[{label:'Ort. net',data:K.siniflar.map(s=>s.ort_net),backgroundColor:'#1c2333'}]},options:{plugins:{legend:{display:false}}}});
  grafik('kgDagilim',{type:'bar',data:{labels:K.net_dagilimi.map(d=>'kova '+d.kova),datasets:[{label:'Öğrenci',data:K.net_dagilimi.map(d=>d.n),backgroundColor:'#7c8798'}]},options:{plugins:{legend:{display:false}}}});
  $('kZayif').innerHTML=K.zayif_kazanimlar.map(k=>`<tr><td>${k.ders_kod}</td><td>${k.metin}</td><td>${k.soru}/${k.dogru}/${k.yanlis}/${k.bos}</td><td><span class="etiket ${k.basari<50?'hata':'uyari'}">${k.basari}</span></td></tr>`).join('')||'<tr><td colspan="4" class="kucuk">Kazanım verisi yok (optik aktarım).</td></tr>';
  const kodlar=K.dersler.map(d=>d.kod);$('kDersBaslik').textContent=kodlar.join(' / ');
  $('kOgrenciler').innerHTML=K.ogrenciler.map((s,i)=>`<tr><td>${i+1}</td><td>${s.ad||'<i>(boş)</i>'}${s.ogrenci_id?'':' <span class="etiket uyari">eşleşmedi</span>'}</td><td>${(s.siniflar||[]).join(', ')||s.ham_sinif||''}</td><td>${f2(s.net)}</td><td>${s.puan??'—'}</td><td class="kucuk">${kodlar.map(k=>f2((s.ders_net||{})[k])).join(' / ')}</td><td>${s.sira_kurum||'—'}</td><td>${s.sira_il||'—'}</td><td>${s.sira_genel||'—'}</td></tr>`).join('');
}

/* ---- deneme aktar ---- */
/* ---- PDF oku ---- */
$('dosya').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;$('durum').textContent='Okunuyor…';
  try{
    const doc=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;
    sonuc=await DenemeParser.parse(doc);sonuc.kaynak_dosya=f.name;
    $('durum').textContent=`${sonuc.ad} · ${sonuc.tur} · ${sonuc.ogrenciler.length} öğrenci · katılım kurum ${sonuc.katilim.kurum} / il ${sonuc.katilim.il} / genel ${sonuc.katilim.genel}`;
    onizleCiz();
  }catch(err){$('durum').textContent='Okunamadı: '+err.message;}
};
function secenekler(secili){return '<option value="">— eşleşme yok —</option>'+ogrenciler.map(o=>`<option value="${o.id}" ${o.id===secili?'selected':''}>${o.ad_soyad}</option>`).join('');}
function onizleCiz(){
  $('onizle').classList.remove('gizli');
  $('ozet').textContent=sonuc.ad+' ('+sonuc.ogrenciler.length+' öğrenci)';
  $('satirlar').innerHTML=sonuc.ogrenciler.map((s,i)=>{
    const n=norm(s.ad);const tam=n?ogrenciler.find(o=>norm(o.ad_soyad)===n):null;
    s.ogrenci_id=tam?tam.id:'';
    const kontrol=s.hatalar.length?`<span class="etiket hata" title="${s.hatalar.join('\n')}">tutarsız</span>`:'<span class="etiket ok">tutarlı</span>';
    return `<tr><td>${i+1}</td><td>${s.ad||'<i>(boş)</i>'}</td><td>${s.sinif}</td><td>${s.kitapcik||''}</td><td>${s.puan??"—"}</td><td>${s.toplam.net}</td>
      <td><select data-i="${i}">${secenekler(s.ogrenci_id)}</select> ${tam?'<span class="etiket ok">otomatik</span>':'<span class="etiket uyari">seç</span>'}</td><td>${kontrol}</td></tr>`;}).join('');
  $('satirlar').querySelectorAll('select').forEach(sel=>sel.onchange=()=>{sonuc.ogrenciler[+sel.dataset.i].ogrenci_id=sel.value;});
}
$('aktarBtn').onclick=async()=>{
  if(!sonuc)return;$('aktarBtn').disabled=true;$('aktarDurum').textContent='Aktarılıyor…';
  try{
    const govde={...sonuc,tarih:$('tarih').value||null,ogrenciler:sonuc.ogrenciler.map(s=>({...s,ogrenci_id:s.ogrenci_id||null}))};
    const r=await rpc('deneme_ice_aktar',{p:govde,p_uzerine_yaz:$('uzerine').checked});
    $('aktarDurum').textContent=`Tamam: ${r.ogrenci} öğrenci, ${r.otomatik} otomatik, ${r.eslesmeyen} eşleşmeyen.`;
    await kuyrukYukle();await listeYukle();
  }catch(e){$('aktarDurum').textContent='Hata: '+e.message;}
  $('aktarBtn').disabled=false;
};

/* ---- optik txt ---- */
const OTUR_VARSAYILAN={LGS:'TUR:Türkçe:20, TAR:Tarih:10, DIN:Din K.ve A.B.:10, ING:İngilizce:10, MAT:Matematik:20, FEN:Fen:20',
  TYT:'TUR:Türkçe:40, SOS:Sosyal:20, MAT:Matematik:40, FEN:Fen:20', AYT:''};
$('oTur').onchange=()=>{if(!$('oDersler').value)$('oDersler').value=OTUR_VARSAYILAN[$('oTur').value]||'';};$('oTur').onchange();
$('optikOku').onclick=async()=>{
  const f=$('txtDosya').files[0];if(!f)return alert('.txt seç');
  try{
    const buf=await f.arrayBuffer();let text;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch(e){text=new TextDecoder('windows-1254').decode(buf);}
    const dersler=$('oDersler').value.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const p=x.split(':');return {kod:p[0].trim().toUpperCase(),ad:(p[1]||p[0]).trim(),soru:+p[2]||+p[1]};});
    if(!dersler.length||dersler.some(d=>!d.soru))throw new Error('Ders listesi hatalı');
    const toplam=dersler.reduce((a,d)=>a+d.soru,0);
    const A=$('oAnahtarA').value.replace(/\s/g,'').toUpperCase(),B=$('oAnahtarB').value.replace(/\s/g,'').toUpperCase();
    if(A.length!==toplam)throw new Error(`A anahtarı ${A.length} karakter, beklenen ${toplam}`);
    if(B&&B.length!==toplam)throw new Error(`B anahtarı ${B.length} karakter, beklenen ${toplam}`);
    const tur=$('oTur').value;
    sonuc=DenemeParser.parseOptik(text,{ad:$('oAd').value.trim()||f.name.replace(/\.txt$/i,''),yayinevi:$('oYayinevi').value.trim()||'KURUM',tur,dersler,anahtar:{A,B:B||A},katsayi:tur==='LGS'?3:4});
    sonuc.kaynak_dosya=f.name;
    $('optikDurum').textContent=`${sonuc.ogrenciler.length} öğrenci okundu.`;onizleCiz();
  }catch(e){$('optikDurum').textContent='Hata: '+e.message;}
};

/* ---- kuyruk ve liste ---- */
async function kuyrukYukle(){
  const k=await rest('GET','deneme_eslesme_kuyrugu?select=*&order=tarih.desc,ham_ad');
  $('kuyruk').innerHTML=k.length?k.map(r=>`<tr><td>${r.deneme_ad}</td><td>${r.ham_ad||'<i>(boş)</i>'}</td><td>${r.ham_sinif||''}</td><td>${r.puan}</td>
    <td><select id="k_${r.sonuc_id}">${secenekler('')}</select></td><td><button data-s="${r.sonuc_id}">Bağla</button></td></tr>`).join('')
    :'<tr><td colspan="6">Eşleşmeyen sonuç yok.</td></tr>';
  $('kuyruk').querySelectorAll('button').forEach(b=>b.onclick=async()=>{
    const og=$('k_'+b.dataset.s).value;if(!og)return alert('Öğrenci seç.');
    await rpc('deneme_sonuc_eslestir',{p_sonuc_id:b.dataset.s,p_ogrenci_id:og});await kuyrukYukle();await listeYukle();});
}
async function listeYukle(){
  const d=await rest('GET','denemeler?select=id,yayinevi,ad,tur,tarih,katilim_kurum,katilim_il,katilim_genel,deneme_sonuclar(count)&order=tarih.desc.nullslast,created_at.desc');
  $('liste').innerHTML=d.length?d.map(r=>`<tr><td>${r.yayinevi}</td><td>${r.ad}</td><td>${r.tur}</td><td>${r.tarih||'—'}</td>
    <td>${r.katilim_kurum||'—'} / ${r.katilim_il||'—'} / ${r.katilim_genel||'—'}</td><td>${(r.deneme_sonuclar&&r.deneme_sonuclar[0]&&r.deneme_sonuclar[0].count)||0}</td></tr>`).join('')
    :'<tr><td colspan="6">Henüz deneme aktarılmadı.</td></tr>';
}

/* ---- ortak yükleyiciler ---- */
async function ogrenciListesiYukle(){
  ogrenciler=rol==='yonetici'?await rest('GET','profiller?select=id,ad_soyad,foto_yolu,sinif_seviyesi,telefon&rol=eq.ogrenci&aktif=eq.true&order=ad_soyad')
    :await rest('GET','ogrencilerim?select=id,ad_soyad,foto_yolu,sinif_seviyesi,telefon&ogretmen_id=eq.'+uid+'&aktif=eq.true&order=ad_soyad');
  if(gid('ogrenciSec')){$('ogrenciSec').innerHTML='<option value="">— seç —</option>'+ogrenciler.map(o=>`<option value="${o.id}">${kacis(o.ad_soyad)}</option>`).join('');
    $('ogrenciSec').onchange=()=>$('ogrenciSec').value&&yukle($('ogrenciSec').value);}
  if(gid('ustAra'))$('ustAra').oninput=()=>{const q=norm($('ustAra').value);if(q.length<2)return;const o=ogrenciler.find(x=>norm(x.ad_soyad).includes(q));if(o)ogrenciAc(o.id);};
}
function ogrenciAc(id){if(gid('ogrenciSec'))$('ogrenciSec').value=id;bolumAc('bAnaliz');yukle(id);}

/* ---- profil formu ---- */
function profilFormu(p){
  const a=p.ayrintilar||{};const ogr=p.rol==='ogrenci';
  return `<div class="alan" id="profilForm">
    <label>Ad soyad<input name="ad_soyad" value="${kacis(p.ad_soyad)}"></label>
    <label>Telefon<input name="telefon" value="${kacis(p.telefon)}" ${p.id===uid?'disabled':''}></label>
    <label>E-posta<input name="eposta" value="${kacis(p.eposta)}"></label>
    <label>Doğum tarihi<input type="date" name="dogum_tarihi" value="${p.dogum_tarihi||''}"></label>
    ${ogr?`<label>Sınıf seviyesi<select name="sinif_seviyesi">${['','5','6','7','8','9','10','11','12','mezun'].map(s=>`<option ${s===(p.sinif_seviyesi||'')?'selected':''}>${s}</option>`).join('')}</select></label>
    <label>Okul<input name="a.okul" value="${kacis(a.okul)}"></label>
    <label>Hedef okul / bölüm<input name="a.hedef_okul" value="${kacis(a.hedef_okul)}"></label>
    <label>Hedef puan<input name="a.hedef_puan" value="${kacis(a.hedef_puan)}"></label>
    <label>Veli adı<input name="a.veli_ad" value="${kacis(a.veli_ad)}"></label>
    <label>Veli telefonu<input name="a.veli_tel" value="${kacis(a.veli_tel)}"></label>
    <label>Veli e-postası<input name="a.veli_eposta" value="${kacis(a.veli_eposta)}"></label>`
    :`<label>Branş<input name="brans" value="${kacis(p.brans)}"></label>
    <label>Unvan<input name="a.unvan" value="${kacis(a.unvan)}"></label>`}
    <label style="grid-column:1/-1">Adres<input name="a.adres" value="${kacis(a.adres)}"></label>
    <label style="grid-column:1/-1">Notlar<textarea name="a.notlar" rows="3">${kacis(a.notlar)}</textarea></label>
  </div>
  <div class="satir" style="margin-top:12px"><button class="ana" id="profilKaydet">Kaydet</button><label>Fotoğraf <input type="file" id="profilFoto" accept="image/*"></label><span id="profilDurum" class="kucuk"></span></div>`;
}
async function profilKaydet(id){
  const g={ayrintilar:{}};$('profilForm').querySelectorAll('[name]').forEach(e=>{if(e.disabled)return;if(e.name.startsWith('a.'))g.ayrintilar[e.name.slice(2)]=e.value;else g[e.name]=e.value;});
  await rpc('profil_guncelle',{p_id:id,p_alanlar:g});
  const f=$('profilFoto').files[0];
  if(f){const blob=await fotoKucult(f);await depoYukle('profil-foto',id+'.jpg',blob,'image/jpeg');await rpc('foto_ayarla_kisi',{p_id:id,p_yol:id+'.jpg'});}
  toast('Profil kaydedildi');
}
async function fotoKucult(f){const img=await createImageBitmap(f);const s=Math.min(1,400/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=img.width*s;c.height=img.height*s;c.getContext('2d').drawImage(img,0,0,c.width,c.height);return new Promise(r=>c.toBlob(r,'image/jpeg',.85));}

/* ---- rapor (yazdır / PDF) ---- */
async function raporUret(ogrenciId,tur){
  const d=await rpc('ogrenci_analiz',{p_ogrenci_id:ogrenciId});if(!d)throw new Error('Veri yok');
  const D=d.denemeler||[],son=D[D.length-1],k=d.son_karne&&d.son_karne.icerik;
  const logo=(KURUM&&KURUM.logo_yolu)||'https://www.mentorcall.com.tr/wp-content/uploads/2025/05/mentorcall-logo.png';
  let html=`<div class="rapor"><div class="rapor-bas"><img src="${logo}" alt=""><div class="kucuk"><b style="color:var(--metin);font-size:14px">${kacis(d.ogrenci.ad_soyad)}</b><br>${(d.ogrenci.siniflar||[]).join(', ')}<br>${new Date().toLocaleDateString('tr-TR')}</div></div>`;
  if(tur!=='karne'){
    html+=`<h2>Deneme gelişimi</h2><table><thead><tr><th>Tarih</th><th>Deneme</th><th>Net</th><th>Kurum ort.</th><th>Puan</th><th>Kurum</th><th>İl</th><th>Genel</th></tr></thead><tbody>${D.map(x=>`<tr><td>${x.tarih||'—'}</td><td>${kacis(x.ad)}</td><td>${f2(x.net)}</td><td>${f2(x.kurum_ort_net)}</td><td>${x.puan??'—'}</td><td>${x.sira_kurum??'—'}</td><td>${x.sira_il??'—'}</td><td>${x.sira_genel??'—'}</td></tr>`).join('')||'<tr><td colspan="8">Deneme yok</td></tr>'}</tbody></table>`;
    if(son)html+=`<h2>Son deneme — ders kırılımı (${kacis(son.ad)})</h2><table><thead><tr><th>Ders</th><th>Soru</th><th>D</th><th>Y</th><th>B</th><th>Net</th><th>Kurum ort.</th></tr></thead><tbody>${(son.dersler||[]).map(x=>`<tr><td>${x.ad}</td><td>${x.soru}</td><td>${x.dogru}</td><td>${x.yanlis}</td><td>${x.bos}</td><td>${f2(x.net)}</td><td>${f2(x.kurum_ort_net)}</td></tr>`).join('')}</tbody></table>`;
    const z=(d.kazanimlar||[]).filter(x=>x.basari_yuzde<100).slice(0,15);
    if(z.length)html+=`<h2>Öncelikli eksik kazanımlar</h2><table><thead><tr><th>Ders</th><th>Kazanım</th><th>S/D/Y/B</th><th>%</th></tr></thead><tbody>${z.map(x=>`<tr><td>${x.ders_kod}</td><td>${kacis(x.metin)}</td><td>${x.soru}/${x.dogru}/${x.yanlis}/${x.bos}</td><td>${x.basari_yuzde}</td></tr>`).join('')}</tbody></table>`;
  }
  if(k&&tur!=='gelisim'){
    html+=`<h2>Karne</h2><p>${kacis(k.ozet)}</p>${d.son_karne.ogretmen_notu?`<p><b>Öğretmen notu:</b> ${kacis(d.son_karne.ogretmen_notu)}</p>`:''}
      <h2>Haftalık program (${d.son_karne.hafta_baslangic})</h2><table><thead><tr><th>Gün</th><th>Çalışma</th></tr></thead><tbody>${(k.haftalik_program||[]).map(g=>`<tr><td><b>${g.gun}</b></td><td>${(g.bloklar||[]).map(b=>`${b.ders} · ${kacis(b.konu)} — ${kacis(b.etkinlik)} (${b.sure_dk} dk)`).join('<br>')}</td></tr>`).join('')}</tbody></table>
      ${k.veli_notu?`<h2>Veliye not</h2><p>${kacis(k.veli_notu)}</p>`:''}`;
  }
  html+=`<p class="kucuk" style="margin-top:20px">${kacis((KURUM&&KURUM.ad)||'MENTORCALL')} · Bu rapor sistem tarafından üretilmiş, öğretmen tarafından kontrol edilmiştir.</p></div>`;
  return {html,d};
}
