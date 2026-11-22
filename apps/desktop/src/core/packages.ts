import { parseManifestText, type Content, type ManifestError } from "./manifest.ts";
import type { PortErrorCode, PortResult } from "./port.ts";
import { contentKeyOf, fileKeyOf, type BrandId, type ContentId } from "./shares.ts";

// Paths use "/" and are relative to the brand folder (`dir`) and the package folder (`files`); sizes are bytes.
export type PackageFile = { readonly path: string; readonly size: number };
export type PackageDir = { readonly dir: string; readonly manifest: string | null; readonly files: readonly PackageFile[] };

export type PackageRejection =
  | { readonly code: "manifest-unreadable" }
  | { readonly code: "manifest"; readonly error: ManifestError }
  | { readonly code: "brand-mismatch"; readonly brand: string }
  | { readonly code: "duplicate-id"; readonly id: string };

export type LoadedPackages = {
  readonly contents: readonly Content[];
  // Both keyed by `fileKeyOf`: listed files not found in the folder, and byte sizes of those found.
  readonly missingFiles: ReadonlySet<string>;
  readonly sizes: ReadonlyMap<string, number>;
  // Keyed by `contentKeyOf`: the package folder relative to the brand folder.
  readonly dirs: ReadonlyMap<string, string>;
  readonly rejected: readonly { readonly brand: BrandId; readonly dir: string; readonly why: PackageRejection }[];
};

export type FolderState =
  | { readonly kind: "read" }
  | { readonly kind: "empty" }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly code: PortErrorCode };

export function folderStateOf(r: PortResult<readonly PackageDir[]>): FolderState {
  if (!r.ok) return r.error.code === "folder-missing" ? { kind: "missing" } : { kind: "unreadable", code: r.error.code };
  return r.value.length === 0 ? { kind: "empty" } : { kind: "read" };
}

export function loadPackages(scans: readonly { readonly brand: BrandId; readonly packages: readonly PackageDir[] }[]): LoadedPackages {
  const contents: Content[] = [];
  const missingFiles = new Set<string>();
  const sizes = new Map<string, number>();
  const dirs = new Map<string, string>();
  const rejected: LoadedPackages["rejected"][number][] = [];
  for (const { brand, packages } of scans) {
    const seen = new Set<string>();
    for (const p of [...packages].sort((a, b) => a.dir.localeCompare(b.dir))) {
      const reject = (why: PackageRejection) => rejected.push({ brand, dir: p.dir, why });
      if (p.manifest === null) {
        reject({ code: "manifest-unreadable" });
        continue;
      }
      const r = parseManifestText(p.manifest);
      if (!r.ok) {
        reject({ code: "manifest", error: r.error });
        continue;
      }
      if (r.content.brand !== brand) {
        reject({ code: "brand-mismatch", brand: r.content.brand });
        continue;
      }
      if (seen.has(r.content.id)) {
        reject({ code: "duplicate-id", id: r.content.id });
        continue;
      }
      seen.add(r.content.id);
      dirs.set(contentKeyOf(brand, r.content.id as ContentId), p.dir);
      const present = new Map(p.files.map((f) => [f.path, f.size]));
      for (const f of r.content.files) {
        const key = fileKeyOf(brand, r.content.id as ContentId, f.path);
        const size = present.get(f.path);
        if (size === undefined) missingFiles.add(key);
        else sizes.set(key, size);
      }
      contents.push(r.content);
    }
  }
  return { contents, missingFiles, sizes, dirs, rejected };
}
