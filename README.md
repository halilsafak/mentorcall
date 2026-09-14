# MENTORCALL — Online Sınav ve Koçluk Sistemi

## Dosyalar
- `index.html` — Ana uygulama (yönetici / öğretmen / öğrenci / veli)
- `istasyon.html` — Soru İstasyonu (PDF/fotoğraf → sınav içeriği). KONU alanı kurum kazanım havuzuna bağlanır (`kazanim_bul_veya_ekle`), otomatik tamamlama `kazanim_ara`.
- `giris.html` — Giriş kapısı; role göre yönlendirir (yonetici / ogretmen / ogrenci).
- `ortak.css` + `ortak.js` — Ortak çekirdek: tema (kurum rengi/logo), auth, REST/RPC, kabuk (sol menü, üst çubuk, mobil alt sekme, hamburger), pano, öğrenci analizi + karne, kurum deneme analizi, deneme aktarma (PDF parser + optik .txt), profil formu, rapor üretici.
- `yonetici.html` — Pano, Öğrenciler, Öğrenci grupları, Öğretmenler, Deneme analizi, Deneme aktar, Öğrenci analizi, Karneler (onay kuyruğu), Ayarlar (kurum adı/logo/renkler/deneme hedefi).
- `ogretmen.html` — Pano, Sınavlarım*, Ödevler*, Öğrencilerim (profil / analiz+karne / rapor), Öğrenci analizi, Deneme analizi, Deneme aktar, Raporlar (yazdır/PDF + arşiv), Profilim.
- `ogrenci.html` — Pano, Sınavlarım*, Ödevlerim*, Analizim, Karnem (haftalık program, yazdır), Profilim. Mobil öncelikli (alt sekme çubuğu).
  (*) Sınav çözme / ödev ekranları şimdilik `index.html` içinde; bir sonraki adımda kabuğa taşınacak, sonra `index.html` giriş kapısına indirilecek.
- Responsive: ≥1100 üç sütun; 700–1100 sağ ray içeriğin altına iner, menü çekmece; <600 tablolar kart listesine döner (`table.kartlas`), alt sekme çubuğu.
- Yazdırma: `@media print` ile rapor sayfası temiz çıktı verir (menü/çubuklar gizlenir).
- `supabase/functions/karne_uret/index.ts` — Yapay zekâ karne + haftalık program üreten Edge Function (`ANTHROPIC_API_KEY` secret'ı gerekir). Deploy: `supabase functions deploy karne_uret`.

## Altyapı
- Veritabanı/Auth/Depolama: Supabase (proje: mmcvpttkoxjfwczpckxq, Frankfurt)
- Edge Functions: `yz` (soru istasyonu), `karne_uret` (karne)

## Veri modeli (deneme/analiz katmanı)
`denemeler → deneme_dersler → deneme_kazanimlar → kazanimlar` (kurum havuzu)
`deneme_sonuclar → deneme_ders_sonuclar / deneme_kazanim_sonuclar / deneme_cevaplar`
`sorular.kazanim_id` ile kurum içi testler aynı havuza bağlanır.
View'lar: `ogrenci_kazanim_ozet`, `kurum_ici_kazanim_sonuclar`, `ogrenci_kazanim_birlesik`, `ogrenci_deneme_gecmisi`, `deneme_eslesme_kuyrugu`.
RPC'ler: `deneme_ice_aktar`, `deneme_sonuc_eslestir`, `ogrenci_ad_adaylari`, `ogrenci_analiz`, `deneme_analiz`, `karne_yayinla`, `kazanim_bul_veya_ekle`, `kazanim_ara`.
Tablolar: `karneler` (taslak → yayında → arşiv), `raporlar` (öğretmen rapor arşivi, `raporlar` kovası), `profiller.ayrintilar` (detaylı profil), `kurumlar.ayarlar.tema`.
RPC'ler (ek): `kurum_ayarlarim`, `kurum_ayar_guncelle`, `profil_guncelle`, `foto_ayarla_kisi`; view `ogrencilerim`.

## Yayınlama
GitHub Pages (halilsafak.github.io/mentorcall). Statik; kurulum gerekmez.
