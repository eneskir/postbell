import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BrandId } from "../core/shares.ts";
import { dropIndex, moveBrand, moveGroup, ungrouped } from "../core/sidebar.ts";
import type { StoreFile } from "../core/store.ts";

export type DragItem = { readonly kind: "brand"; readonly id: BrandId } | { readonly kind: "group"; readonly id: string };

type Line = { readonly x: number; readonly y: number; readonly width: number };
export type Drop =
  | { readonly kind: "brand"; readonly group: string | null; readonly index: number | null; readonly line: Line | null }
  | { readonly kind: "group"; readonly index: number | null; readonly line: Line | null };

export type ActiveDrag = {
  readonly item: DragItem;
  readonly ghost: { readonly x: number; readonly y: number; readonly width: number };
  readonly drop: Drop | null;
};

const THRESHOLD = 4;
const LINE_INSET = 8;

export function useSidebarDrag(store: StoreFile | null, enabled: boolean, update: (change: (s: StoreFile) => StoreFile) => void) {
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const storeRef = useRef(store);
  storeRef.current = store;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const start = useCallback(
    (item: DragItem) => (e: ReactPointerEvent<HTMLElement>) => {
      stop.current?.();
      const list = e.currentTarget.closest<HTMLElement>(".nav-list");
      const source = item.kind === "group" ? e.currentTarget.closest<HTMLElement>(".nav-group") : e.currentTarget;
      if (!enabled || e.button !== 0 || !storeRef.current || !list || !source) return;
      const r = source.getBoundingClientRect();
      const origin = { x: e.clientX, y: e.clientY };
      const grab = { x: e.clientX - r.left, y: e.clientY - r.top };
      let current: ActiveDrag | null = null;
      let cancelled = false;
      const move = (ev: PointerEvent) => {
        const s = storeRef.current;
        if (cancelled || !s || (!current && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < THRESHOLD)) return;
        current = { item, ghost: { x: ev.clientX - grab.x, y: ev.clientY - grab.y, width: r.width }, drop: dropAt(list, s, item, ev.clientX, ev.clientY) };
        setActive(current);
      };
      const end = (commit: boolean) => {
        const drop = current?.drop;
        current = null;
        setActive(null);
        if (!commit || !drop || drop.index === null) return;
        const index = drop.index;
        if (drop.kind === "brand" && item.kind === "brand") update((s) => moveBrand(s, item.id, { group: drop.group, index }));
        else if (drop.kind === "group" && item.kind === "group") update((s) => moveGroup(s, item.id, index));
      };
      const up = () => {
        const dragged = current !== null || cancelled;
        stop.current?.();
        if (!dragged) return;
        swallowNextClick();
        end(!cancelled);
      };
      const cancel = () => {
        stop.current?.();
        end(false);
      };
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !current) return;
        ev.preventDefault();
        ev.stopPropagation();
        cancelled = true;
        end(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      stop.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        stop.current = null;
      };
    },
    [enabled, update],
  );

  return { active, start };
}

// The browser dispatches the click in the same task as pointerup; swallow only that task so a later real click survives.
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}

// Fixed at the end of body so the menu's overflow clipping does not cut it.
export function DragLayer({ active, ghost }: { active: ActiveDrag | null; ghost: (item: DragItem) => ReactNode }) {
  if (!active) return null;
  const line = active.drop?.line;
  return createPortal(
    <>
      {line && <div className="nav-drop-line" style={{ left: line.x, top: line.y, width: line.width }} />}
      <div className="nav-ghost" data-kind={active.item.kind} style={{ left: active.ghost.x, top: active.ghost.y, width: active.item.kind === "brand" ? active.ghost.width : undefined }} aria-hidden="true">
        {ghost(active.item)}
      </div>
    </>,
    document.body,
  );
}

type Boundary = { readonly group: string | null; readonly at: number; readonly y: number; readonly line: boolean };

function dropAt(list: HTMLElement, s: StoreFile, item: DragItem, x: number, y: number): Drop | null {
  const box = list.getBoundingClientRect();
  if (x < box.left || x > box.right) return null;
  const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
  const lineAt = (at: number): Line => ({ x: box.left + pad + LINE_INSET, y: at - 1, width: box.width - 2 * (pad + LINE_INSET) });
  if (item.kind === "brand") {
    const b = nearest(brandBoundaries(list, s, box.top + (parseFloat(getComputedStyle(list).paddingTop) || 0)), y);
    if (!b) return null;
    const ids = b.group === null ? ungrouped(s).map((x) => x.id) : (s.groups.find((g) => g.id === b.group)?.brands ?? []);
    const from = ids.indexOf(item.id);
    const index = dropIndex(from < 0 ? null : from, b.at);
    return { kind: "brand", group: b.group, index, line: b.line && index !== null ? lineAt(b.y) : null };
  }
  const b = nearest(groupBoundaries(list, s), y);
  if (!b) return null;
  const index = dropIndex(s.groups.findIndex((g) => g.id === item.id), b.at);
  return { kind: "group", index, line: index !== null ? lineAt(b.y) : null };
}

function nearest(bounds: readonly Boundary[], y: number): Boundary | null {
  let best: Boundary | null = null;
  for (const b of bounds) if (!best || Math.abs(b.y - y) < Math.abs(best.y - y)) best = b;
  return best;
}

function brandBlock(list: HTMLElement, id: BrandId): { top: number; bottom: number } | null {
  const row = list.querySelector(`[data-brand="${id}"]`);
  if (!row) return null;
  const pages = list.querySelectorAll(`[data-brand-page="${id}"]`);
  const last = pages.length ? pages[pages.length - 1]! : row;
  return { top: row.getBoundingClientRect().top, bottom: last.getBoundingClientRect().bottom };
}

function brandBoundaries(list: HTMLElement, s: StoreFile, listTop: number): Boundary[] {
  const out: Boundary[] = [];
  const edges = (group: string | null, ids: readonly BrandId[], emptyY: number) => {
    const blocks = ids.flatMap((id) => brandBlock(list, id) ?? []);
    if (!blocks.length) return void out.push({ group, at: 0, y: emptyY, line: true });
    blocks.forEach((b, i) => out.push({ group, at: i, y: b.top, line: true }));
    out.push({ group, at: blocks.length, y: blocks[blocks.length - 1]!.bottom, line: true });
  };
  edges(null, ungrouped(s).map((b) => b.id), listTop);
  for (const g of s.groups) {
    const head = list.querySelector(`[data-group="${g.id}"]`)?.getBoundingClientRect();
    if (!head) continue;
    if (g.open) edges(g.id, g.brands, head.bottom);
    else out.push({ group: g.id, at: g.brands.length, y: head.bottom, line: false });
  }
  return out;
}

function groupBoundaries(list: HTMLElement, s: StoreFile): Boundary[] {
  const out: Boundary[] = [];
  let bottom: number | undefined;
  for (const [i, g] of s.groups.entries()) {
    const gap = list.querySelector(`[data-gap-for="${g.id}"]`)?.getBoundingClientRect();
    const head = list.querySelector(`[data-group="${g.id}"]`)?.getBoundingClientRect();
    if (!gap || !head) continue;
    out.push({ group: null, at: i, y: gap.top + gap.height / 2, line: true });
    const last = g.open ? g.brands.flatMap((id) => brandBlock(list, id) ?? []).at(-1) : undefined;
    bottom = last?.bottom ?? head.bottom;
  }
  if (bottom !== undefined) out.push({ group: null, at: s.groups.length, y: bottom, line: true });
  return out;
}
