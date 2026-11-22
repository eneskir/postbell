import { folderStateOf, loadPackages, type FolderState, type LoadedPackages, type PackageDir } from "../core/packages.ts";
import type { Port } from "../core/port.ts";
import { deriveShares, type BrandId, type Share } from "../core/shares.ts";
import { sidebarOrder } from "../core/sidebar.ts";
import type { StoreFile } from "../core/store.ts";
import type { LocalMs } from "../core/time.ts";
import type { BrandState } from "../core/today.ts";

export type BrandPackages = { readonly packages: LoadedPackages; readonly folders: ReadonlyMap<BrandId, FolderState> };

export async function loadBrandPackages(port: Port, store: StoreFile): Promise<BrandPackages> {
  const scans: { brand: BrandId; packages: readonly PackageDir[] }[] = [];
  const folders = new Map<BrandId, FolderState>();
  for (const b of store.brands) {
    const r = await port.packages.read(b.folder);
    folders.set(b.id, folderStateOf(r));
    if (r.ok) scans.push({ brand: b.id, packages: r.value });
  }
  return { packages: loadPackages(scans), folders };
}

export type BrandReading = { readonly folder: FolderState; readonly rejected: LoadedPackages["rejected"] };

export function readingOf(p: BrandPackages, brand: BrandId): BrandReading | null {
  const folder = p.folders.get(brand);
  if (!folder) return null;
  return {
    folder,
    rejected: p.packages.rejected.filter((r) => r.brand === brand),
  };
}

export const brandStatesOf = (store: StoreFile, p: BrandPackages): BrandState[] =>
  sidebarOrder(store).flatMap((b) => {
    const folder = p.folders.get(b.id);
    return folder ? [{ brand: b.id, folder, rejected: p.packages.rejected.filter((r) => r.brand === b.id).length }] : [];
  });

export const sharesOf = (store: StoreFile, p: LoadedPackages, now: LocalMs): Share[] =>
  deriveShares({
    contents: p.contents,
    accounts: store.accounts,
    records: store.records,
    missingFiles: p.missingFiles,
    now,
  });
