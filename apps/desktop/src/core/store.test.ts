import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountId, BrandId, ShareId } from "./shares.ts";
import { canWrite, emptyStore, parseStoreText, serializeStore, withoutRecord, withRecord, type StoreFile } from "./store.ts";
import { at, parseDate, parseTime, type LocalDate, type TimeOfDay } from "./time.ts";

const NOW = at(parseDate("2026-11-11") as LocalDate, parseTime("14:20") as TimeOfDay);
const full: StoreFile = withRecord(
  {
    ...emptyStore(),
    brands: [{ id: "initech" as BrandId, name: "Initech", sticker: "camera", folder: "D:/content/initech" }],
    groups: [{ id: "musteriler", name: "Müşteriler", open: true, brands: ["initech" as BrandId] }],
    accounts: [
      {
        id: "initech-instagram-tr" as AccountId,
        brand: "initech" as BrandId,
        network: "instagram",
        handle: "@initech.tr",
        language: "tr",
        times: { "instagram-post": parseTime("12:00") as TimeOfDay, "instagram-reels": parseTime("09:00") as TimeOfDay },
      },
    ],
    sidebar: { collapsed: false, width: 240, openBrands: ["initech" as BrandId] },
  },
  { share: "initech/hidden-dog/x" as ShareId, status: "done", at: NOW },
);

const FILE = `{
  "version": 1,
  "brands": [
    {
      "id": "initech",
      "name": "Initech",
      "sticker": "camera",
      "folder": "D:/content/initech"
    }
  ],
  "groups": [
    {
      "id": "musteriler",
      "name": "Müşteriler",
      "open": true,
      "brands": [
        "initech"
      ]
    }
  ],
  "accounts": [
    {
      "id": "initech-instagram-tr",
      "brand": "initech",
      "network": "instagram",
      "handle": "@initech.tr",
      "language": "tr",
      "times": {
        "instagram-reels": "09:00",
        "instagram-post": "12:00"
      }
    }
  ],
  "records": [
    {
      "share": "initech/hidden-dog/x",
      "status": "done",
      "at": "2026-11-11T14:20"
    }
  ],
  "settings": {},
  "sidebar": {
    "collapsed": false,
    "width": 240,
    "openBrands": [
      "initech"
    ]
  }
}
`;

test("store file: the written text matches the hand-written format and parses back to the same store", () => {
  assert.equal(serializeStore(full), FILE);
  assert.deepEqual(parseStoreText(FILE), { kind: "ready", store: full });
});

test("no file means first launch; the empty store is writable", () => {
  const s = parseStoreText(null);
  assert.deepEqual(s, { kind: "empty" });
  assert.equal(canWrite(s), true);
  assert.equal(parseStoreText(serializeStore(emptyStore())).kind, "ready");
});

test("a broken file is unreadable and not writable", () => {
  const cases: Array<[string, unknown]> = [
    ["{broken", { kind: "unreadable", reason: "invalid-json" }],
    [FILE.replace('"collapsed": false', '"collapsed": "no"'), { kind: "unreadable", reason: "invalid-shape", path: "sidebar.collapsed", rule: "type" }],
    [FILE.replace('"width": 240', '"width": 600'), { kind: "unreadable", reason: "invalid-shape", path: "sidebar.width", rule: "maximum" }],
    [FILE.replace('"width": 240', '"width": 200'), { kind: "unreadable", reason: "invalid-shape", path: "sidebar.width", rule: "minimum" }],
    [FILE.replace('      "initech"\n    ]\n  }\n}', '      "other"\n    ]\n  }\n}'), { kind: "unreadable", reason: "invalid-shape", path: "sidebar.openBrands[0]", rule: "brand-ref" }],
    [FILE.replace('"open": true', '"open": "yes"'), { kind: "unreadable", reason: "invalid-shape", path: "groups[0].open", rule: "type" }],
    [
      FILE.replace('"groups": [\n', '"groups": [\n    {\n      "id": "musteriler",\n      "name": "Second",\n      "open": false,\n      "brands": []\n    },\n'),
      { kind: "unreadable", reason: "invalid-shape", path: "groups[1].id", rule: "unique" },
    ],
    [
      FILE.replace('"groups": [\n', '"groups": [\n    {\n      "id": "other-group",\n      "name": "Other",\n      "open": false,\n      "brands": ["initech"]\n    },\n'),
      { kind: "unreadable", reason: "invalid-shape", path: "groups[1].brands[0]", rule: "unique" },
    ],
    [FILE.replace("2026-11-11T14:20", "2026-02-30T14:20"), { kind: "unreadable", reason: "invalid-shape", path: "records[0].at", rule: "calendar" }],
    [FILE.replace('"instagram-reels": "09:00"', '"instagram-reels": "24:00"'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].times.instagram-reels", rule: "pattern" }],
    [FILE.replace('"instagram-reels": "09:00"', '"tiktok": "09:00"'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].times.tiktok", rule: "network" }],
    [FILE.replace('"network": "instagram"', '"network": "instagram-reels"'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].network", rule: "enum" }],
    [FILE.replace('"network": "instagram"', '"network": "threads"'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].times.instagram-reels", rule: "network" }],
    [FILE.replace('"language": "tr"', '"language": "de"'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].language", rule: "enum" }],
    [FILE.replace('"brand": "initech"', '"brand": "other"'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].brand", rule: "brand-ref" }],
    [
      FILE.replace('"accounts": [\n', '"accounts": [\n    {"id": "initech-instagram-tr", "brand": "initech", "network": "x", "handle": "@p", "language": "en", "times": {}},\n'),
      { kind: "unreadable", reason: "invalid-shape", path: "accounts[1].id", rule: "unique" },
    ],
    [FILE.replace('        "initech"\n', '        "other"\n'), { kind: "unreadable", reason: "invalid-shape", path: "groups[0].brands[0]", rule: "brand-ref" }],
    [FILE.replace('"sticker": "camera"', '"sticker": "Camera"'), { kind: "unreadable", reason: "invalid-shape", path: "brands[0].sticker", rule: "pattern" }],
    [FILE.replace('      "sticker": "camera",\n', ""), { kind: "unreadable", reason: "invalid-shape", path: "brands[0].sticker", rule: "required" }],
    [FILE.replace('"settings": {}', '"settings": {"unknown": 1}'), { kind: "unreadable", reason: "invalid-shape", path: "settings.unknown", rule: "additionalProperties" }],
  ];
  for (const [text, expected] of cases) {
    const s = parseStoreText(text);
    assert.deepEqual(s, expected);
    assert.equal(canWrite(s), false);
  }
});

test("an unknown (newer) version is newer-version whatever its shape, and not writable", () => {
  for (const text of ['{"version": 2}', '{"version": 7, "brands": "new shape"}']) {
    const s = parseStoreText(text);
    assert.equal(s.kind, "newer-version");
    assert.equal(canWrite(s), false);
  }
  assert.deepEqual(parseStoreText(FILE.replace('"version": 1', '"version": 0')), { kind: "unreadable", reason: "invalid-shape", path: "version", rule: "const" });
});

test("one record per share: marking again replaces the old one", () => {
  const skipped = withRecord(full, { share: "initech/hidden-dog/x" as ShareId, status: "skipped", at: NOW });
  assert.equal(skipped.records.length, 1);
  assert.equal(skipped.records[0]?.status, "skipped");
});

test("Threads account: no formats or times, stored and read back the same", () => {
  const threads = { id: "initech-threads" as AccountId, brand: "initech" as BrandId, network: "threads", handle: "@initech", language: "en", times: {} } as const;
  const s: StoreFile = { ...full, accounts: [...full.accounts, threads] };
  assert.deepEqual(parseStoreText(serializeStore(s)), { kind: "ready", store: s });
});

test("undo removes the record; without a record the same object returns (no write)", () => {
  const id = "initech/hidden-dog/x" as ShareId;
  const marked = withRecord(full, { share: id, status: "done", at: NOW });
  const undone = withoutRecord(marked, id);
  assert.equal(undone.records.some((r) => r.share === id), false);
  assert.equal(undone.records.length, marked.records.length - 1);
  assert.equal(withoutRecord(undone, id), undone);
});
