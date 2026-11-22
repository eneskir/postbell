# Content package contract

`manifest.schema.json` is the only contract between the content pipeline and Postbell. Both sides read this file; neither keeps a copy. Postbell generates its types and validator from it: run `npm run contract` in `apps/desktop` to write `apps/desktop/src/core/manifest.gen.ts`; `npm run check` fails when the generated file is stale.

## Package
The archive holds brand, day and content folders: `<brand>/<YYYY-MM-DD>/<content>/manifest.json`. File paths are relative to the manifest's folder, use `/` and never leave it.

## Fields (version 1)
- `schemaVersion`: 1. A schema change bumps the version; Postbell rejects an unknown version with `unknown-version` and keeps reading older ones.
- `id`: content id (lowercase letters, digits, hyphens); the key of the share record in Postbell, never changes.
- `brand`: the brand key; matches the brand in Postbell.
- `date`: share day (local calendar day). The package has no time: it comes from the brand's schedule.
- `language`: `en` or `tr`.
- `title`: the content name, shown in Postbell's lists.
- `approval`: `approved`, `pending`, `revision`. Postbell shows only approved packages; the others give `not-approved`.
- `files`: `id`, `kind` (`video`, `image`), `role` (`main`, `detail`, `card`), `path`, `width`, `height` (pixels), and `durationSec` for video.
- `entries`: one entry per platform: `platform` (`x`, `instagram-reels`, `instagram-post`, `tiktok`, `youtube-shorts`, `pinterest`), `file` (a file `id`), `text` (share text), `aiLabel` (whether the platform needs an AI label).
- `sources`: `title`, `url` (https), `license`; at least one source.
- `aiUsage`: `voice`, `visuals`, `text`: whether that part was made with AI.

Rules the schema cannot express live in Postbell's parser (`apps/desktop/src/core/manifest.ts`): every string must be well-formed Unicode (a lone surrogate such as the `\ud83d` escape fails the `unicode` rule); the day must exist in the calendar; file ids and platforms do not repeat; an entry's file must be in `files`; video needs a duration. Whether a file is really in the folder is the loader's job (the share shows a missing-file blocker).

## Error codes
`invalid-json` (text is not JSON), `unknown-version` (version is not 1), `invalid-shape` (field path and rule, e.g. `title` `required`), `not-approved` (pending or in revision). Order: version first, then shape, approval last.

## Sample packages (`fixtures/`)
Made-up data, two brands (`initech`, `globex`), days 2026-11-12 to 2026-11-16. Images are small flat-color PNGs; videos are empty placeholder files.

| Package | Expected |
|---|---|
| `initech/2026-11-12/hidden-dog`, `…/2026-11-14/signature`, `globex/2026-11-12/gizli-kopek` | video package, parses |
| `initech/2026-11-13/green-sky`, `globex/2026-11-13/yesil-gok` | image package, parses |
| `globex/2026-11-14/missing-file` | parses; `images/detail-1x1.png` is not in the folder |
| `initech/2026-11-15/missing-title` | `invalid-shape` `title` `required` |
| `initech/2026-11-15/version-2` | `unknown-version` 2 |
| `initech/2026-11-16/not-approved` | `not-approved` `pending` |
| `initech/2026-11-16/invalid-json` | `invalid-json` |

Summary: `npm run packages` in `apps/desktop` prints a summary table.
