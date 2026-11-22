import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Port } from "../core/port.ts";
import { resetWidth, resize, SIDEBAR_STRIP, toggleCollapsed } from "../core/sidebar.ts";
import { SIDEBAR_MAX, SIDEBAR_MIN, type Sidebar } from "../core/store.ts";
import { stickers } from "./assets.gen.ts";
import { DRAG, Icon, Toast, type ToastView } from "./components.tsx";
import type { View } from "./route.ts";
import { text } from "./text.ts";

export type PanelView = { readonly eyebrow: string; readonly content: ReactNode; readonly onClose: () => void };
export type ToastSlot = { readonly view: ToastView; readonly onDismiss: (id: number) => void };

type Props = {
  readonly port: Port;
  readonly nav: ReactNode;
  readonly sidebar: Sidebar | null;
  readonly onSidebar: (next: Sidebar) => void;
  readonly view: View;
  readonly now: string;
  readonly panel: PanelView | null;
  readonly toast: ToastSlot | null;
  readonly children: ReactNode;
};

export function Shell({ port, nav, sidebar, onSidebar, view, now, panel, toast, children }: Props) {
  const [live, setLive] = useState<Sidebar | null>(null);
  const side = live ?? sidebar;
  const width = side ? (side.collapsed ? SIDEBAR_STRIP : side.width) : undefined;
  return (
    <div className="shell">
      <nav className="nav" aria-label={text.nav.label} style={width === undefined ? undefined : { width: `${width}px` }} data-collapsed={side?.collapsed || undefined} data-resizing={live ? true : undefined}>
        {nav}
        {sidebar && <ResizeHandle sidebar={sidebar} live={live} setLive={setLive} commit={onSidebar} />}
      </nav>
      <div className="main">
        <header className={panel ? "bar bar-crumbs" : "bar bar-crumbs bar-last"} {...DRAG}>
          <ol className="crumbs" aria-label={text.crumbs}>
            {view.crumbs.map((c, i) => (
              <li key={i} aria-current={i === view.crumbs.length - 1 ? "page" : undefined}>
                {"sticker" in c ? <img className="crumb-sticker" src={stickers[c.sticker]} alt="" /> : <Icon name={c.icon} />}
                {c.label}
              </li>
            ))}
          </ol>
          <span className="bar-spacer" />
          <span className="now">{now}</span>
          {!panel && <WindowControls port={port} />}
        </header>
        <main className="page" tabIndex={-1} data-grid={view.grid || undefined}>
          {children}
        </main>
        <div className="toast-region" role="status">
          {toast && <Toast key={toast.view.id} toast={toast.view} onDismiss={toast.onDismiss} />}
        </div>
      </div>
      {panel && (
        <aside className="panel" aria-label={text.panel.label}>
          <header className="bar bar-panel bar-last" {...DRAG}>
            <button type="button" className="panel-close" aria-label={text.panel.close} onClick={panel.onClose}>
              <span aria-hidden="true">»</span>
            </button>
            <span className="panel-eyebrow">{panel.eyebrow}</span>
            <span className="bar-spacer" />
            <WindowControls port={port} />
          </header>
          <div className="panel-content">{panel.content}</div>
        </aside>
      )}
    </div>
  );
}

const KEY_STEP = 8;

// WAI-ARIA window splitter pattern.
function ResizeHandle({ sidebar, live, setLive, commit }: { sidebar: Sidebar; live: Sidebar | null; setLive: (s: Sidebar | null) => void; commit: (s: Sidebar) => void }) {
  const dragging = useRef(false);
  const current = live ?? sidebar;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const left = e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    setLive(resize(sidebar, e.clientX - left));
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (live && (live.width !== sidebar.width || live.collapsed !== sidebar.collapsed)) commit(live);
    setLive(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" && !sidebar.collapsed) commit(resize(sidebar, sidebar.width - KEY_STEP));
    else if (e.key === "ArrowRight") commit(sidebar.collapsed ? toggleCollapsed(sidebar) : resize(sidebar, sidebar.width + KEY_STEP));
    else if (e.key === "Enter") commit(toggleCollapsed(sidebar));
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="nav-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={text.nav.resize}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={current.collapsed ? SIDEBAR_STRIP : current.width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => commit(resetWidth(sidebar))}
      onKeyDown={onKeyDown}
    />
  );
}

function WindowControls({ port }: { port: Port }) {
  // Out of the Tab order like the native Windows title bar; Alt+F4 and Win+arrow keys still work.
  const button = (label: string, glyph: string, act: () => Promise<void>, extra = "") => (
    <button type="button" className={`window-button${extra}`} tabIndex={-1} aria-label={label} title={label} onClick={() => void act()}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
  return (
    <div className="window-controls">
      {button(text.window.minimize, "–", port.window.minimize)}
      {button(text.window.maximize, "□", port.window.toggleMaximize)}
      {button(text.window.close, "×", port.window.close, " window-button-close")}
    </div>
  );
}
