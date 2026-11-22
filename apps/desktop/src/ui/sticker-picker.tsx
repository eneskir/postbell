import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { KeyboardEvent } from "react";
import { stickers, type StickerName } from "./assets.gen.ts";
import { STICKERS, STICKERS_PER_ROW } from "./stickers.ts";
import { text } from "./text.ts";

const STEP: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -STICKERS_PER_ROW, ArrowDown: STICKERS_PER_ROW };

// Radix menus only move up and down, so the grid handles arrow keys itself.
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const step = STEP[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const cells = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
  const at = cells.indexOf(e.currentTarget);
  const to = at + step;
  const sameRow = Math.floor(to / STICKERS_PER_ROW) === Math.floor(at / STICKERS_PER_ROW);
  if (to >= 0 && to < cells.length && (Math.abs(step) !== 1 || sameRow)) cells[to]?.focus();
}

export function StickerPicker({ value, onChange }: { value: StickerName; onChange: (s: StickerName) => void }) {
  return (
    <>
      <span className="tile tile-selected" role="img" aria-label={text.brandForm.stickerCurrent(text.stickerNames[value])}>
        <img className="tile-sticker" src={stickers[value]} alt="" />
      </span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="button button-tertiary">{text.brandForm.stickerPick}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu sticker-menu" side="bottom" align="end" sideOffset={4} aria-label={text.brandForm.stickerMenu}>
            <DropdownMenu.RadioGroup className="sticker-grid" value={value} onValueChange={(v) => onChange(v as StickerName)}>
              {STICKERS.map((s) => (
                <DropdownMenu.RadioItem key={s} className="sticker-cell" value={s} aria-label={text.stickerNames[s]} title={text.stickerNames[s]} onKeyDown={moveFocus}>
                  <img className="tile-sticker" src={stickers[s]} alt="" />
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
