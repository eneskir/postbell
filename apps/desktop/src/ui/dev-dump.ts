import { loadPackages } from "../core/packages.ts";
import type { Port, PortError } from "../core/port.ts";
import { contentKeyOf, fileKeyOf, type BrandId, type ContentId, type ShareId } from "../core/shares.ts";
import { canWrite, emptyStore, parseStoreText, withRecord, type StoreState } from "../core/store.ts";
import type { LocalMs } from "../core/time.ts";

export type Dump = {
  readonly storePath: string;
  readonly state: StoreState["kind"];
  readonly records: number;
  readonly contents: number;
  readonly rejected: number;
  readonly readMs: number;
  readonly backup: string | null;
  readonly outsideRead: string;
  readonly preview: string;
  readonly previewOutside: string;
  readonly errors: readonly PortError[];
};

export const SELF_TEST_SHARE = "deneme/oz-sinama/x" as ShareId;

export type ImageProbe = (url: string) => Promise<string | null>;

export async function loadDump(port: Port, now: LocalMs, addRecord: boolean, probe?: ImageProbe): Promise<Dump> {
  const errors: PortError[] = [];
  const loaded = await port.store.load();
  if (!loaded.ok)
    return { storePath: "", state: "unreadable", records: 0, contents: 0, rejected: 0, readMs: 0, backup: null, outsideRead: "", preview: "", previewOutside: "", errors: [loaded.error] };
  let state = parseStoreText(loaded.value.text);
  let backup: string | null = null;
  if (state.kind === "unreadable") {
    const b = await port.store.backup();
    if (b.ok) backup = b.value;
    else errors.push(b.error);
  }
  if (addRecord && canWrite(state)) {
    const next = withRecord(state.kind === "ready" ? state.store : emptyStore(), { share: SELF_TEST_SHARE, status: "done", at: now });
    const saved = await port.store.save(next);
    if (saved.ok) state = { kind: "ready", store: next };
    else errors.push(saved.error);
  }
  const brands = state.kind === "ready" ? state.store.brands : [];
  const scans = [];
  const started = performance.now();
  for (const b of brands) {
    const r = await port.packages.read(b.folder);
    if (r.ok) scans.push({ brand: b.id, packages: r.value });
    else errors.push(r.error);
  }
  const p = loadPackages(scans);
  const readMs = Math.round(performance.now() - started);
  const storeDir = loaded.value.path.slice(0, Math.max(loaded.value.path.lastIndexOf("/"), loaded.value.path.lastIndexOf("\\")));
  const outside = await port.packages.read(storeDir);
  let preview = "not tried";
  let previewOutside = "not tried";
  if (probe) {
    const image = p.contents.flatMap((c) =>
      c.files
        .filter((f) => f.kind === "image")
        .flatMap((f) => {
          const found = p.sizes.has(fileKeyOf(c.brand as BrandId, c.id as ContentId, f.path));
          const dir = p.dirs.get(contentKeyOf(c.brand as BrandId, c.id as ContentId));
          const folder = brands.find((b) => b.id === c.brand)?.folder;
          return found && dir !== undefined && folder ? [port.files.url(folder, `${dir}/${f.path}`)] : [];
        }),
    )[0];
    preview = image === undefined ? "no image" : ((await probe(image)) ?? "failed to load");
    const name = loaded.value.path.slice(storeDir.length + 1);
    previewOutside = (await probe(port.files.url(storeDir, name))) === null ? "not loaded" : "loaded";
  }
  return {
    storePath: loaded.value.path,
    state: state.kind,
    records: state.kind === "ready" ? state.store.records.length : 0,
    contents: p.contents.length,
    rejected: p.rejected.length,
    readMs,
    backup,
    outsideRead: outside.ok ? "okundu" : outside.error.code,
    preview,
    previewOutside,
    errors,
  };
}
