# Postbell

English | [Türkçe](README.tr.md)

A Windows desktop app for posting the same content to several social accounts by hand. You add a folder for each of your brands. Postbell reads the content packages in it and lists what each account should post today, with the file, the caption and the time. When a post's time comes, a Windows notification reminds you. A button opens the platform's share page, you post it yourself and mark it as shared.

It supports X, Instagram, TikTok, YouTube Shorts and Pinterest. Postbell is not affiliated with any of them.

The app is in development and has no public release yet. For now [postbell.app](https://postbell.app) is a placeholder page. The interface is in Turkish.

## How it is made

Enes Kır designs Postbell and approves every change. The code is written with Claude Code.

## Development

You need Windows 10 or 11 with the WebView2 Runtime, Node.js 24, and Rust (stable, through rustup) with the Microsoft C++ Build Tools. Then, in `apps/desktop`:

```sh
npm ci
npm run dev                  # the interface alone in a browser, with sample packages instead of your files
npx tauri dev                # the real app; it uses the same data folder as an installed Postbell
npm run check                # types, tests, generated files, license notices and Rust tests
npx tauri build --no-bundle  # the release exe, in src-tauri/target/release
```

The repository holds:

- `apps/desktop`: the app. The Rust shell (Tauri 2) is in `src-tauri`, the logic is in `src/core` (TypeScript) and the React interface in `src/ui`.
- `apps/site`: postbell.app, deployed from `main`.
- `contracts`: the content package format (`manifest.schema.json`) and sample packages, which show what a package looks like.

## License

- Code and artwork: [MIT License](LICENSE).
- Third-party components keep their own licenses, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The Inter typeface is under the SIL Open Font License.
- The Postbell name and logo are not licensed under the MIT License. See [TRADEMARKS.md](TRADEMARKS.md).

## Contributing

Bug reports and ideas are welcome through the issue forms. Pull requests are limited to maintainers for now. See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).
