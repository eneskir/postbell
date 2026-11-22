# Postbell

[English](README.md) | Türkçe

Aynı içeriği birkaç sosyal medya hesabında elle paylaşmak için bir Windows masaüstü uygulaması. Her markan için bir klasör eklersin. Postbell oradaki içerik paketlerini okur ve her hesabın bugün ne paylaşacağını dosyası, metni ve saatiyle listeler. Paylaşımın saati gelince bir Windows bildirimi hatırlatır. Bir düğme platformun paylaşım sayfasını açar, paylaşımı sen yaparsın ve paylaşıldı diye işaretlersin.

X, Instagram, TikTok, YouTube Shorts ve Pinterest destekleniyor. Postbell'in bunların hiçbiriyle ilişkisi yoktur.

Uygulama geliştirme aşamasında ve henüz herkese açık bir sürümü yok. [postbell.app](https://postbell.app) şimdilik bir bekleme sayfası. Arayüz Türkçe.

## Nasıl geliştiriliyor

Postbell'i Enes Kır tasarlıyor ve her değişikliği o onaylıyor. Kodu Claude Code yazıyor.

## Geliştirme

WebView2 Runtime kurulu Windows 10 ya da 11, Node.js 24, Microsoft C++ Build Tools ile Rust'ın stable sürümü (rustup ile) gerekir. Sonra `apps/desktop` klasöründe:

```sh
npm ci
npm run dev                  # yalnız arayüz, tarayıcıda; senin dosyaların yerine örnek paketlerle
npx tauri dev                # gerçek uygulama; kurulu Postbell'le aynı veri klasörünü kullanır
npm run check                # tipler, testler, üretilen dosyalar, lisans bildirimleri ve Rust testleri
npx tauri build --no-bundle  # sürüm exe'si, src-tauri/target/release klasörüne
```

Depoda şunlar var:

- `apps/desktop`: uygulama. Rust kabuğu (Tauri 2) `src-tauri`'de, TypeScript mantığı `src/core`'da, React arayüzü `src/ui`'da.
- `apps/site`: postbell.app, `main`'den yayınlanır.
- `contracts`: içerik paketi biçimi (`manifest.schema.json`) ve bir paketin neye benzediğini gösteren örnek paketler.

## Lisans

- Kod ve çizimler: [MIT Lisansı](LICENSE).
- Üçüncü taraf bileşenler kendi lisanslarını korur, liste [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) dosyasında. Inter yazı tipi SIL Open Font License ile dağıtılır.
- Postbell adı ve logosu MIT Lisansı'nın kapsamında değildir, bkz. [TRADEMARKS.md](TRADEMARKS.md).

## Katkı

Hata bildirimlerini ve fikirlerini issue formlarıyla iletebilirsin. Pull request şimdilik yalnız projeyi yürütenlere açık. Ayrıntılar [CONTRIBUTING.md](CONTRIBUTING.md)'de (İngilizce). Güvenlik sorunlarını [SECURITY.md](SECURITY.md)'deki yoldan bildir.
