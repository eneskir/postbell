import type { Brand } from "../core/store.ts";
import { stickers, type StickerName } from "./assets.gen.ts";

const ORDER: Readonly<Record<StickerName, number>> = {
  camera: 0, night: 1, crown: 2, guitar: 3, "movie-clapper": 4, "paint-brush": 5, balloon: 6, anchor: 7,
  tv: 8, flashlight: 9, frame: 10, rocket: 11, fire: 12, trophy: 13, bot: 14, plane: 15,
  "coffee-cup-1": 16, "hot-air-balloon": 17, pizza: 18, "ice-cream": 19, cake: 20, sunny: 21, snowflake: 22, thunderstorm: 23,
};
export const STICKERS: readonly StickerName[] = (Object.keys(ORDER) as StickerName[]).sort((a, b) => ORDER[a] - ORDER[b]);
export const STICKERS_PER_ROW = 8;

const isSticker = (s: string): s is StickerName => Object.hasOwn(stickers, s);

// A name this build does not know (a sticker removed later) falls back to one derived from the id.
export function stickerOf(brand: Pick<Brand, "id" | "sticker">): StickerName {
  if (isSticker(brand.sticker)) return brand.sticker;
  let h = 0;
  for (const ch of brand.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return STICKERS[h % STICKERS.length] ?? "camera";
}

export const freeSticker = (brands: readonly Pick<Brand, "id" | "sticker">[]): StickerName =>
  STICKERS.find((s) => !brands.some((b) => stickerOf(b) === s)) ?? "camera";
