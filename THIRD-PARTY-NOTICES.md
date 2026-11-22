# Third-party notices

Postbell's code is MIT-licensed ([LICENSE](LICENSE)). The components it includes keep their own licenses.

- **Desktop app:** [apps/desktop/THIRD_PARTY_NOTICES.md](apps/desktop/THIRD_PARTY_NOTICES.md) lists every npm and Rust package in the app with its license text, the Microsoft WebView2 SDK loader linked into the exe, and the sources of the drawings. `npm run notices` in `apps/desktop` writes it from the lock files, and `npm run check` fails when it is out of date. The installed app carries the same file.
- **Site:** postbell.app uses the Inter typeface under the SIL Open Font License 1.1; the license sits next to the font in [apps/site/fonts/OFL.txt](apps/site/fonts/OFL.txt).
- **Drawings:** the stickers and empty-state pictures are adapted from the Doodle Icons pack and the Highlights library, both CC0 1.0. Their sources are in [apps/desktop/src/ui/assets/SOURCES.md](apps/desktop/src/ui/assets/SOURCES.md).
