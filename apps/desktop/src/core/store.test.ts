import { test } from "node:test";
import assert from "node:assert/strict";
import type { Account, AccountId, BrandId, ShareId, ShareRecord } from "./shares.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { canWrite, dataFileName, emptyStore, importedStore, parseStoreText, serializeStore, withoutRecord, withRecord, type StoreFile } from "./store.ts";
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
  "version": 4,
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
  "settings": {
    "notifyOnTime": true,
    "reminderInterval": 30,
    "startScreen": "home",
    "launchAtLogin": false,
    "closeToTray": true
  },
  "sidebar": {
    "collapsed": false,
    "width": 240,
    "openBrands": [
      "initech"
    ]
  },
  "backup": {},
  "lastPage": {
    "kind": "home"
  }
}
`;
const SETTINGS_TEXT = /"settings": \{\n[^}]*\}/;
const LAST_PAGE_TEXT = /,\n {2}"lastPage": \{\n[^}]*\}/;
// The same store as an older version wrote it: no settings or last page, and before version 3 no backup state.
const older = (v: 1 | 2 | 3, text = FILE) => {
  const t = text.replace('"version": 4', `"version": ${v}`).replace(SETTINGS_TEXT, '"settings": {}').replace(LAST_PAGE_TEXT, "");
  return v === 3 ? t : t.replace(',\n  "backup": {}', "");
};

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
    [FILE.replace('      "initech"\n    ]\n  },', '      "other"\n    ]\n  },'), { kind: "unreadable", reason: "invalid-shape", path: "sidebar.openBrands[0]", rule: "brand-ref" }],
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
    [FILE.replace('"closeToTray": true', '"closeToTray": true, "unknown": 1'), { kind: "unreadable", reason: "invalid-shape", path: "settings.unknown", rule: "additionalProperties" }],
  ];
  for (const [text, expected] of cases) {
    const s = parseStoreText(text);
    assert.deepEqual(s, expected);
    assert.equal(canWrite(s), false);
  }
});

test("an unknown (newer) version is newer-version whatever its shape, and not writable", () => {
  for (const text of ['{"version": 5}', '{"version": 7, "brands": "new shape"}']) {
    const s = parseStoreText(text);
    assert.equal(s.kind, "newer-version");
    assert.equal(canWrite(s), false);
  }
  assert.deepEqual(parseStoreText(FILE.replace('"version": 4', '"version": 0')), { kind: "unreadable", reason: "invalid-shape", path: "version", rule: "const" });
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

test("version 1 to 3 files read as version 4 with the default settings, and are written back as version 4", () => {
  for (const v of [1, 2, 3] as const) assert.deepEqual(parseStoreText(older(v)), { kind: "ready", store: full });
  assert.deepEqual(full.settings, DEFAULT_SETTINGS);
  assert.equal(serializeStore(full), FILE);
});

test("version 3: the backup state is stored and read back the same, and checked", () => {
  const s: StoreFile = { ...full, backup: { last: NOW, pending: "changed-password", later: true } };
  const text = serializeStore(s);
  assert.match(text, /"backup": \{\n    "last": "2026-11-11T14:20",\n    "pending": "changed-password",\n    "later": true\n  \}/);
  assert.deepEqual(parseStoreText(text), { kind: "ready", store: s });
  const cases: Array<[string, unknown]> = [
    [text.replace('"pending": "changed-password"', '"pending": "lost"'), { kind: "unreadable", reason: "invalid-shape", path: "backup.pending", rule: "enum" }],
    [text.replace('"later": true', '"later": false'), { kind: "unreadable", reason: "invalid-shape", path: "backup.later", rule: "const" }],
    [text.replace('"last": "2026-11-11T14:20"', '"last": "2026-02-30T14:20"'), { kind: "unreadable", reason: "invalid-shape", path: "backup.last", rule: "calendar" }],
    [older(3, text).replace('"version": 3', '"version": 2'), { kind: "unreadable", reason: "invalid-shape", path: "backup", rule: "additionalProperties" }],
    [older(2).replace('"version": 2', '"version": 3'), { kind: "unreadable", reason: "invalid-shape", path: "backup", rule: "required" }],
  ];
  for (const [t, expected] of cases) assert.deepEqual(parseStoreText(t), expected);
});

const detailed: Account = {
  ...full.accounts[0]!,
  email: "name@example.com",
  twoStep: "app",
  recoveryEmail: "recovery@example.com",
  note: "Creator account; Threads uses it",
};
const titled: ShareRecord = { share: "initech/hidden-dog/x" as ShareId, status: "done", at: NOW, title: "Hidden dog", planned: { kind: "at", at: NOW } };
const unscheduled: ShareRecord = { share: "initech/hidden-dog/tiktok" as ShareId, status: "skipped", at: NOW, title: "Hidden dog", planned: { kind: "unscheduled", date: parseDate("2026-11-10") as LocalDate } };

test("version 2: account details and the record's title and planned time are stored and read back the same", () => {
  const s: StoreFile = { ...full, accounts: [detailed], records: [titled, unscheduled] };
  const text = serializeStore(s);
  assert.match(text, /"twoStep": "app"/);
  assert.match(text, /"planned": "2026-11-11T14:20"/);
  assert.match(text, /"planned": "2026-11-10"/);
  assert.deepEqual(parseStoreText(text), { kind: "ready", store: s });
});

test("version 2 fields are refused in a version 1 file, and checked in a version 2 file", () => {
  const text = serializeStore({ ...full, accounts: [detailed], records: [titled] });
  const cases: Array<[string, unknown]> = [
    [older(1, text), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].email", rule: "additionalProperties" }],
    [text.replace('"twoStep": "app"', '"twoStep": "pigeon"'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].twoStep", rule: "enum" }],
    [text.replace('"note": "Creator account; Threads uses it"', '"note": ""'), { kind: "unreadable", reason: "invalid-shape", path: "accounts[0].note", rule: "minLength" }],
    [text.replace('"planned": "2026-11-11T14:20"', '"planned": "2026-02-30T14:20"'), { kind: "unreadable", reason: "invalid-shape", path: "records[0].planned", rule: "calendar" }],
    [text.replace('"planned": "2026-11-11T14:20"', '"planned": "tomorrow"'), { kind: "unreadable", reason: "invalid-shape", path: "records[0].planned", rule: "pattern" }],
  ];
  for (const [t, expected] of cases) assert.deepEqual(parseStoreText(t), expected);
});

test("version 4: changed settings are stored and read back the same; an absent one takes its default", () => {
  const s: StoreFile = { ...full, settings: { notifyOnTime: false, reminderInterval: 120, startScreen: "last", launchAtLogin: true, closeToTray: false } };
  assert.deepEqual(parseStoreText(serializeStore(s)), { kind: "ready", store: s });
  const partial = FILE.replace(SETTINGS_TEXT, '"settings": {"reminderInterval": 60}');
  assert.deepEqual(parseStoreText(partial), { kind: "ready", store: { ...full, settings: { ...DEFAULT_SETTINGS, reminderInterval: 60 } } });
  const cases: Array<[string, unknown]> = [
    [FILE.replace('"reminderInterval": 30', '"reminderInterval": 45'), { kind: "unreadable", reason: "invalid-shape", path: "settings.reminderInterval", rule: "enum" }],
    [FILE.replace('"startScreen": "home"', '"startScreen": "calendar"'), { kind: "unreadable", reason: "invalid-shape", path: "settings.startScreen", rule: "enum" }],
    [FILE.replace('"closeToTray": true', '"closeToTray": "yes"'), { kind: "unreadable", reason: "invalid-shape", path: "settings.closeToTray", rule: "type" }],
    [FILE.replace('"version": 4', '"version": 3').replace(LAST_PAGE_TEXT, ""), { kind: "unreadable", reason: "invalid-shape", path: "settings.notifyOnTime", rule: "additionalProperties" }],
  ];
  for (const [t, expected] of cases) assert.deepEqual(parseStoreText(t), expected);
});

test("version 4: the last page is stored and read back the same, and checked", () => {
  const initech = "initech" as BrandId;
  for (const lastPage of [{ kind: "brand", brand: initech, page: "calendar" }, { kind: "brand-settings", brand: initech }, { kind: "history" }] as const) {
    const s: StoreFile = { ...full, lastPage };
    assert.deepEqual(parseStoreText(serializeStore(s)), { kind: "ready", store: s });
  }
  assert.deepEqual(parseStoreText(FILE.replace(LAST_PAGE_TEXT, "")), { kind: "ready", store: full }, "no last page is Ana sayfa");
  const page = (json: string) => FILE.replace(LAST_PAGE_TEXT, `,\n  "lastPage": ${json}`);
  const cases: Array<[string, unknown]> = [
    [page('{"kind": "brand", "brand": "initech"}'), { kind: "unreadable", reason: "invalid-shape", path: "lastPage", rule: "kind" }],
    [page('{"kind": "home", "brand": "initech"}'), { kind: "unreadable", reason: "invalid-shape", path: "lastPage", rule: "kind" }],
    [page('{"kind": "brand-settings", "brand": "initech", "page": "today"}'), { kind: "unreadable", reason: "invalid-shape", path: "lastPage", rule: "kind" }],
    [page('{"kind": "brand", "brand": "other", "page": "today"}'), { kind: "unreadable", reason: "invalid-shape", path: "lastPage.brand", rule: "brand-ref" }],
    [page('{"kind": "brand-new"}'), { kind: "unreadable", reason: "invalid-shape", path: "lastPage.kind", rule: "enum" }],
    [page('{"kind": "brand", "brand": "initech", "page": "settings"}'), { kind: "unreadable", reason: "invalid-shape", path: "lastPage.page", rule: "enum" }],
    [older(3).replace('"backup": {}', '"backup": {},\n  "lastPage": {"kind": "home"}'), { kind: "unreadable", reason: "invalid-shape", path: "lastPage", rule: "additionalProperties" }],
  ];
  for (const [t, expected] of cases) assert.deepEqual(parseStoreText(t), expected);
});

test("Veriler: the file is named by the day, and an import keeps this computer's vault backup state and Run value", () => {
  assert.equal(dataFileName(parseDate("2026-11-23") as LocalDate), "postbell-veriler-2026-11-23.json");
  const here: StoreFile = { ...full, backup: { last: at(parseDate("2026-11-03") as LocalDate, parseTime("10:00") as TimeOfDay) }, settings: { ...DEFAULT_SETTINGS, launchAtLogin: true } };
  const file: StoreFile = { ...emptyStore(), settings: { ...DEFAULT_SETTINGS, reminderInterval: 60, launchAtLogin: false }, backup: { pending: "new-account" } };
  assert.deepEqual(importedStore(here, file), { ...file, backup: here.backup, settings: { ...file.settings, launchAtLogin: true } });
  assert.deepEqual(parseStoreText(serializeStore(full)), { kind: "ready", store: full }, "an exported file reads back as the same store");
});
