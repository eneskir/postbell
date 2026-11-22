import type { AccountDraft } from "../core/accounts.ts";
import type { BrandPage, Place } from "../core/settings.ts";
import type { AccountId, BrandId, ContentKey, ShareId } from "../core/shares.ts";
import type { IconName, StickerName } from "./assets.gen.ts";
import { text } from "./text.ts";

export { BRAND_PAGES, HOME } from "../core/settings.ts";

export type Route = Place | { readonly kind: "brand-new"; readonly group?: string };

export type PanelState =
  | { readonly kind: "closed" }
  | { readonly kind: "share"; readonly share: ShareId }
  | { readonly kind: "content"; readonly content: ContentKey }
  | { readonly kind: "account"; readonly account: AccountId; readonly editing?: boolean }
  | { readonly kind: "account-new"; readonly draft: AccountDraft; readonly row: { readonly languageShown: boolean } | null };

export function rowPick(current: PanelState, next: PanelState): PanelState {
  const same =
    (current.kind === "share" && next.kind === "share" && current.share === next.share) ||
    (current.kind === "content" && next.kind === "content" && current.content === next.content) ||
    (current.kind === "account" && next.kind === "account" && current.account === next.account) ||
    (current.kind === "account-new" &&
      next.kind === "account-new" &&
      current.row !== null &&
      next.row !== null &&
      current.draft.network === next.draft.network &&
      current.draft.language === next.draft.language);
  return same ? { kind: "closed" } : next;
}

export function assertNever(x: never): never {
  throw new Error(`UNHANDLED_CASE ${JSON.stringify(x)}`);
}

export const pageIcon: Record<BrandPage, IconName> = { today: "today", contents: "contents", calendar: "calendar", accounts: "accounts" };

export function sameRoute(a: Route, b: Route): boolean {
  switch (a.kind) {
    case "home":
    case "history":
    case "settings":
      return a.kind === b.kind;
    case "brand-new":
      return b.kind === "brand-new" && a.group === b.group;
    case "brand":
      return b.kind === "brand" && a.brand === b.brand && a.page === b.page;
    case "brand-settings":
      return b.kind === "brand-settings" && a.brand === b.brand;
    default:
      return assertNever(a);
  }
}

export type Crumb = { readonly label: string; readonly icon: IconName } | { readonly label: string; readonly sticker: StickerName };

export type View = { readonly title: string; readonly crumbs: readonly Crumb[]; readonly brand: BrandId | null; readonly grid: boolean };

export function viewOf(route: Route, brandOf: (id: BrandId) => { readonly name: string; readonly sticker: StickerName }): View {
  const general = (title: string, icon: IconName): View => ({ title, crumbs: [{ label: title, icon }], brand: null, grid: false });
  const branded = (brand: BrandId, title: string, icon: IconName, grid: boolean): View => ({
    title,
    crumbs: [{ label: brandOf(brand).name, sticker: brandOf(brand).sticker }, { label: title, icon }],
    brand,
    grid,
  });
  switch (route.kind) {
    case "home":
      return general(text.page.home, "home");
    case "history":
      return general(text.page.history, "history");
    case "settings":
      return general(text.page.settings, "settings");
    case "brand-new":
      return general(text.page.brandNew, "brand-add");
    case "brand":
      return branded(route.brand, text.page[route.page], pageIcon[route.page], route.page === "calendar");
    case "brand-settings":
      return branded(route.brand, text.page.brandSettings, "settings", false);
    default:
      return assertNever(route);
  }
}
