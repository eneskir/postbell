import * as Tooltip from "@radix-ui/react-tooltip";
import { createContext, Fragment, useContext, useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { abbreviations, addGroup, moveBrand, removeGroup, renameGroup, toggleBrand, toggleGroup, ungrouped } from "../core/sidebar.ts";
import type { BrandId } from "../core/shares.ts";
import type { Brand, Group, StoreFile } from "../core/store.ts";
import { stickers, type IconName } from "./assets.gen.ts";
import { Icon } from "./components.tsx";
import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger, SubMenu } from "./menu.tsx";
import { BRAND_PAGES, HOME, pageIcon, type Route } from "./route.ts";
import { DragLayer, useSidebarDrag, type DragItem } from "./sidebar-drag.tsx";
import { stickerOf } from "./stickers.ts";
import { text } from "./text.ts";

type Props = {
  readonly store: StoreFile | null;
  readonly collapsed: boolean;
  readonly route: Route;
  readonly go: (r: Route) => void;
  readonly late: (brand: BrandId) => number;
  readonly update: (change: (s: StoreFile) => StoreFile) => void;
  readonly onToggleCollapsed: () => void;
  readonly onRemoveBrand: (brand: BrandId, back: HTMLElement | null) => void;
};

type FocusTargets = readonly string[];
const groupToggle = (id: string) => `[data-group="${CSS.escape(id)}"] .nav-group-toggle`;
const groupInput = (id: string) => `[data-group="${CSS.escape(id)}"] .nav-group-input`;
const brandToggle = (id: BrandId) => `.nav-brand[data-brand="${CSS.escape(id)}"]`;
const FIRST_ROW = ".nav-list .nav-row";

function focusFirst(targets: FocusTargets) {
  targets
    .map((sel) => document.querySelector<HTMLElement>(sel))
    .find((x) => x !== null)
    ?.focus();
}

export function Sidebar({ store, collapsed, route, go, late, update, onToggleCollapsed, onRemoveBrand }: Props) {
  const top = store ? ungrouped(store) : [];
  const groups = store?.groups ?? [];
  const short = abbreviations(groups.map((g) => g.name));
  const byId = new Map(store?.brands.map((b) => [b.id, b]));
  const groupOf = new Map(groups.flatMap((g) => g.brands.map((b) => [b, g.id] as const)));
  const isOpen = (id: BrandId) => store?.sidebar.openBrands.includes(id) ?? false;
  const drag = useSidebarDrag(store, store !== null && !collapsed, update);
  const moving = drag.active?.item;
  const dropGroup = drag.active?.drop?.kind === "brand" ? drag.active.drop.group : null;
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => {
    if (collapsed) setRenaming(null);
  }, [collapsed]);
  const focusAfter = useFocusAfter();

  const newGroup = (brand: BrandId | null): FocusTargets => {
    const made: { id?: string } = {};
    update((s) => {
      const r = addGroup(s, text.nav.newGroup);
      made.id = r.id;
      return brand === null ? r.store : moveBrand(r.store, brand, { group: r.id, index: 0 });
    });
    if (made.id === undefined) return [];
    setRenaming(made.id);
    return [groupInput(made.id)];
  };
  const groupActions = (g: Group, i: number): GroupActions => ({
    add: () => go({ kind: "brand-new", group: g.id }),
    rename: () => {
      setRenaming(g.id);
      return [groupInput(g.id)];
    },
    newGroup: () => newGroup(null),
    remove: () => {
      const near = groups[i - 1] ?? groups[i + 1];
      update((s) => removeGroup(s, g.id));
      return near ? [groupToggle(near.id)] : [FIRST_ROW];
    },
    renameEnd: (name, keyboard) => {
      setRenaming(null);
      if (name !== null) update((s) => renameGroup(s, g.id, name));
      if (keyboard) focusAfter([groupToggle(g.id)]);
    },
  });
  const brandActions = (b: Brand): BrandActions => ({
    groups,
    current: groupOf.get(b.id) ?? null,
    settings: () => go({ kind: "brand-settings", brand: b.id }),
    move: (group) => {
      update((s) => moveBrand(s, b.id, { group, index: group === null ? ungrouped(s).length : (s.groups.find((x) => x.id === group)?.brands.length ?? 0) }));
      return group === null ? [brandToggle(b.id)] : [brandToggle(b.id), groupToggle(group)];
    },
    newGroup: () => newGroup(b.id),
    remove: () => {
      onRemoveBrand(b.id, document.querySelector<HTMLElement>(brandToggle(b.id)));
      return [];
    },
  });

  const brandRows = (brands: readonly Brand[], groupMoving = false) =>
    brands.map((b) => (
      <BrandRow
        key={b.id}
        brand={b}
        open={isOpen(b.id)}
        route={route}
        go={go}
        late={late(b.id)}
        dragging={groupMoving || (moving?.kind === "brand" && moving.id === b.id)}
        onToggle={() => update((s) => toggleBrand(s, b.id))}
        onPointerDown={drag.start({ kind: "brand", id: b.id })}
        actions={brandActions(b)}
      />
    ));
  const ghost = (item: DragItem) => {
    if (item.kind === "group") {
      const g = groups.find((x) => x.id === item.id);
      return g && <GroupTitle name={g.name} open={g.open} />;
    }
    const b = byId.get(item.id);
    return b && <BrandTitle brand={b} open={isOpen(b.id)} late={late(b.id)} />;
  };
  return (
    <Narrow.Provider value={collapsed}>
      <Tooltip.Provider delayDuration={TIP_DELAY}>
        <div className="bar bar-nav" data-tauri-drag-region="deep">
          <NavItem icon="home" label={text.page.home} current={route.kind === "home"} onClick={() => go(HOME)} />
        </div>
        <div className="nav-list" data-moving={moving ? true : undefined}>
          {brandRows(top)}
          {groups.map((g, i) => {
            const members = g.brands.flatMap((id) => byId.get(id) ?? []);
            const groupMoving = moving?.kind === "group" && moving.id === g.id;
            return (
              <Fragment key={g.id}>
                <div className="nav-gap" data-gap-for={g.id} />
                <GroupRow
                  group={g}
                  short={short[i] ?? ""}
                  late={members.reduce((n, b) => n + late(b.id), 0)}
                  dragging={groupMoving}
                  dropTarget={dropGroup === g.id}
                  renaming={renaming === g.id && !collapsed}
                  onToggle={() => update((s) => toggleGroup(s, g.id))}
                  onPointerDown={drag.start({ kind: "group", id: g.id })}
                  actions={groupActions(g, i)}
                />
                {g.open && brandRows(members, groupMoving)}
              </Fragment>
            );
          })}
          <NavItem icon="brand-add" label={text.page.brandNew} current={route.kind === "brand-new"} onClick={() => go({ kind: "brand-new" })} />
        </div>
        <div className="nav-footer">
          <NavItem icon="history" label={text.page.history} current={route.kind === "history"} onClick={() => go({ kind: "history" })} />
          <NavItem icon="settings" label={text.page.settings} current={route.kind === "settings"} onClick={() => go({ kind: "settings" })} />
          {store && <NavItem icon={collapsed ? "expand" : "collapse"} label={collapsed ? text.nav.expand : text.nav.collapse} onClick={onToggleCollapsed} />}
        </div>
        <DragLayer active={drag.active} ghost={ghost} />
      </Tooltip.Provider>
    </Narrow.Provider>
  );
}

function useFocusAfter() {
  const next = useRef<FocusTargets>([]);
  useEffect(() => {
    const targets = next.current;
    if (targets.length === 0) return;
    next.current = [];
    focusFirst(targets);
  });
  return (targets: FocusTargets) => {
    next.current = targets;
  };
}

// Focus moves once the menu has fully closed; Radix's focus trap pulls back focus given while it is open.
function useMenuFocus() {
  const target = useRef<FocusTargets | null>(null);
  return {
    leave: (act: () => FocusTargets) => () => {
      target.current = act();
    },
    onCloseAutoFocus: (e: Event) => {
      const t = target.current;
      target.current = null;
      if (t === null) return;
      e.preventDefault();
      focusFirst(t);
    },
  };
}

const Narrow = createContext(false);
const TIP_DELAY = 500;
const TIP_OFFSET = 12;

// Open requests in the wide menu are not stored: Radix reports no close for a value already closed, so tooltips would pop open on collapse.
function Tip({ label, children }: { label: string; children: ReactElement }) {
  const narrow = useContext(Narrow);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!narrow) setOpen(false);
  }, [narrow]);
  return (
    <Tooltip.Root open={narrow && open} onOpenChange={(next) => setOpen(narrow && next)}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="nav-tip" side="right" sideOffset={TIP_OFFSET}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const MENU_SIDE = 8;
const MENU_ALIGN = -2;

function MoreButton({ label }: { label: string }) {
  return (
    <MenuTrigger asChild>
      <button type="button" className="nav-action" aria-label={label}>
        <span aria-hidden="true">⋯</span>
      </button>
    </MenuTrigger>
  );
}

type NavItemProps = {
  readonly icon: IconName;
  readonly label: string;
  readonly current?: boolean;
  readonly indent?: boolean;
  readonly brandPage?: BrandId;
  readonly dragging?: boolean;
  readonly onClick: () => void;
};

function NavItem({ icon, label, current = false, indent = false, brandPage, dragging = false, onClick }: NavItemProps) {
  return (
    <Tip label={label}>
      <button type="button" className="nav-row" data-indent={indent || undefined} data-brand-page={brandPage} data-dragging={dragging || undefined} aria-current={current ? "page" : undefined} onClick={onClick}>
        <Icon name={icon} />
        <span className="nav-label">{label}</span>
      </button>
    </Tip>
  );
}

type BrandActions = {
  readonly groups: readonly Group[];
  readonly current: string | null;
  readonly settings: () => void;
  readonly move: (group: string | null) => FocusTargets;
  readonly newGroup: () => FocusTargets;
  readonly remove: () => FocusTargets;
};

type BrandRowProps = {
  readonly brand: Brand;
  readonly open: boolean;
  readonly route: Route;
  readonly go: (r: Route) => void;
  readonly late: number;
  readonly dragging: boolean;
  readonly onToggle: () => void;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly actions: BrandActions;
};

function BrandRow({ brand, open, route, go, late, dragging, onToggle, onPointerDown, actions }: BrandRowProps) {
  return (
    <>
      <div className="nav-brand-row">
        <Tip label={brand.name}>
          <button type="button" className="nav-row nav-brand" data-brand={brand.id} data-open={open || undefined} data-dragging={dragging || undefined} aria-expanded={open} onClick={onToggle} onPointerDown={onPointerDown}>
            <span className="nav-chevron" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            <span className="sticker-wrap">
              <img className="sticker" src={stickers[stickerOf(brand)]} alt="" />
              {late > 0 && <span className="late-dot" aria-hidden="true" />}
            </span>
            <span className="nav-label">{brand.name}</span>
            {late > 0 && <span className="nav-badge">{text.lateBadge(late)}</span>}
          </button>
        </Tip>
        <BrandMenu brand={brand} actions={actions} />
      </div>
      {open &&
        BRAND_PAGES.map((p) => (
          <NavItem
            key={p}
            indent
            icon={pageIcon[p]}
            label={text.page[p]}
            brandPage={brand.id}
            dragging={dragging}
            current={route.kind === "brand" && route.brand === brand.id && route.page === p}
            onClick={() => go({ kind: "brand", brand: brand.id, page: p })}
          />
        ))}
    </>
  );
}

function BrandMenu({ brand, actions }: { brand: Brand; actions: BrandActions }) {
  const { leave, onCloseAutoFocus } = useMenuFocus();
  return (
    <span className="nav-actions">
      <Menu>
        <MoreButton label={text.nav.brandMenu(brand.name)} />
        <MenuContent sideOffset={MENU_SIDE} alignOffset={MENU_ALIGN} onCloseAutoFocus={onCloseAutoFocus}>
          <MenuItem onSelect={actions.settings}>{text.page.brandSettings}</MenuItem>
          <SubMenu label={text.nav.moveToGroup}>
            <MenuRadioGroup value={actions.current ?? ""}>
              {actions.groups.map((g) => (
                <MenuRadioItem key={g.id} value={g.id} onSelect={g.id === actions.current ? () => undefined : leave(() => actions.move(g.id))}>
                  {g.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            {actions.current !== null && <MenuItem onSelect={leave(() => actions.move(null))}>{text.nav.ungroup}</MenuItem>}
            <MenuItem onSelect={leave(actions.newGroup)}>{text.nav.newGroup}</MenuItem>
          </SubMenu>
          <MenuSeparator />
          <MenuItem danger onSelect={leave(actions.remove)}>
            {text.nav.removeBrand}
          </MenuItem>
        </MenuContent>
      </Menu>
    </span>
  );
}

type GroupActions = {
  readonly add: () => void;
  readonly rename: () => FocusTargets;
  readonly newGroup: () => FocusTargets;
  readonly remove: () => FocusTargets;
  readonly renameEnd: (name: string | null, keyboard: boolean) => void;
};

type GroupRowProps = {
  readonly group: Group;
  readonly short: string;
  readonly late: number;
  readonly dragging: boolean;
  readonly dropTarget: boolean;
  readonly renaming: boolean;
  readonly onToggle: () => void;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  readonly actions: GroupActions;
};

function GroupRow({ group, short, late, dragging, dropTarget, renaming, onToggle, onPointerDown, actions }: GroupRowProps) {
  const { leave, onCloseAutoFocus } = useMenuFocus();
  return (
    <div className="nav-group" data-group={group.id} data-dragging={dragging || undefined} data-drop-target={dropTarget || undefined} data-renaming={renaming || undefined}>
      {renaming ? (
        <NameInput initial={group.name} onDone={actions.renameEnd} />
      ) : (
        <Tip label={group.name}>
          <button type="button" className="nav-group-toggle" aria-expanded={group.open} aria-label={group.name} onClick={onToggle} onPointerDown={onPointerDown}>
            <span className="nav-group-name">{group.name}</span>
            <span className="nav-group-short" aria-hidden="true">
              {short}
            </span>
            <span className="nav-chevron" aria-hidden="true">
              {group.open ? "▾" : "▸"}
            </span>
          </button>
        </Tip>
      )}
      {!renaming && !group.open && late > 0 && <span className="nav-badge">{text.lateBadge(late)}</span>}
      <span className="nav-actions">
        <button type="button" className="nav-action" aria-label={text.nav.groupAdd(group.name)} onClick={actions.add}>
          <span aria-hidden="true">+</span>
        </button>
        <Menu>
          <MoreButton label={text.nav.groupMenu(group.name)} />
          <MenuContent sideOffset={MENU_SIDE} alignOffset={MENU_ALIGN} onCloseAutoFocus={onCloseAutoFocus}>
            <MenuItem onSelect={leave(actions.rename)}>{text.nav.rename}</MenuItem>
            <MenuItem onSelect={leave(actions.newGroup)}>{text.nav.newGroup}</MenuItem>
            <MenuItem danger onSelect={leave(actions.remove)}>
              {text.nav.removeGroup}
            </MenuItem>
          </MenuContent>
        </Menu>
      </span>
    </div>
  );
}

function NameInput({ initial, onDone }: { initial: string; onDone: GroupActions["renameEnd"] }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null, keyboard: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(name, keyboard);
  };
  return (
    <input
      className="nav-group-input"
      aria-label={text.nav.groupName}
      value={value}
      spellCheck={false}
      autoComplete="off"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || (e.key !== "Enter" && e.key !== "Escape")) return;
        e.preventDefault();
        finish(e.key === "Enter" ? value : null, true);
      }}
      onBlur={() => finish(value, false)}
    />
  );
}

function BrandTitle({ brand, open, late }: { brand: Brand; open: boolean; late: number }) {
  return (
    <>
      <span className="nav-chevron">{open ? "▾" : "▸"}</span>
      <img className="sticker" src={stickers[stickerOf(brand)]} alt="" />
      <span className="nav-ghost-name">{brand.name}</span>
      {late > 0 && <span className="nav-badge">{text.lateBadge(late)}</span>}
    </>
  );
}

function GroupTitle({ name, open }: { name: string; open: boolean }) {
  return (
    <>
      <span className="nav-ghost-name">{name}</span>
      <span className="nav-chevron">{open ? "▾" : "▸"}</span>
    </>
  );
}
