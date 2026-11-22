# Postbell

[English](README.md) | Türkçe

Aynı içeriği birkaç sosyal medya hesabında elle paylaşmak için Windows masaüstü uygulaması. Her markan için bir klasör eklersin. Postbell oradaki içerik paketlerini okur ve her hesabın bugün ne paylaşacağını dosyası, metni ve saatiyle listeler. Saati gelince Windows bildirimiyle haber verir. Platformun paylaşım sayfasını bir düğmeyle açarsın, gönderiyi kendin atarsın ve paylaşıldı diye işaretlersin.

X, Instagram, TikTok, YouTube Shorts ve Pinterest destekleniyor. Postbell'in bunların hiçbiriyle ilişkisi yok.

Uygulama geliştiriliyor, henüz herkese açık sürümü yok. [postbell.app](https://postbell.app) şimdilik bir bekleme sayfası. Arayüz Türkçe.

## Nasıl yapılıyor

Postbell'i Enes Kır tasarlıyor ve her değişikliği o onaylıyor. Kod Claude Code ile yazılıyor.

## Geliştirme

WebView2 Runtime kurulu Windows 10 ya da 11, Node.js 24, stable Rust (rustup ile) ve Microsoft C++ Build Tools gerekir. Sonra `apps/desktop` klasöründe:

```sh
npm ci
npm run dev                  # yalnız arayüz, tarayıcıda; senin dosyaların yerine örnek paketlerle
npx tauri dev                # gerçek uygulama; kurulu Postbell'le aynı veri klasörünü kullanır
npm run check                # tipler, testler, üretilen dosyalar, lisans bildirimleri ve Rust testleri
npx tauri build --no-bundle  # sürüm exe'si, src-tauri/target/release klasöründe
```

Depoda şunlar var:

- `apps/desktop`: uygulama. Rust kabuğu (Tauri 2) `src-tauri`'de, TypeScript mantığı `src/core`'da, React arayüzü `src/ui`'da.
- `apps/site`: postbell.app, `main`'den yayınlanır.
- `contracts`: içerik paketi biçimi (`manifest.schema.json`) ve örnek paketler.

## Lisans

- Kod ve çizimler: [MIT Lisansı](LICENSE).
- Üçüncü taraf bileşenlerin kendi lisansları var, listesi [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) dosyasında. Inter yazı tipi SIL Open Font License ile dağıtılır.
- Postbell adı ve logosu MIT Lisansı'nın kapsamında değil, bkz. [TRADEMARKS.md](TRADEMARKS.md).

## Katkı

Hataları ve fikirlerini issue formlarıyla iletebilirsin. Pull request şimdilik yalnız projeyi yürütenlere açık. Ayrıntılar [CONTRIBUTING.md](CONTRIBUTING.md)'de (İngilizce). Güvenlik sorunlarını nasıl bildireceğin [SECURITY.md](SECURITY.md)'de.
