import "./setup.css";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { askOf, errorButtons, isUpdate, type Job, type Phase, type SetupError, type SetupInfo, type SetupPort } from "../core/setup.ts";
import { logos } from "./assets.gen.ts";
import { Button, Tag, type ButtonVariant } from "./components.tsx";
import { text } from "./text.ts";

const t = text.setup;
const DRAG = { "data-tauri-drag-region": "deep" } as const;

type ViewButton = { readonly label: string; readonly variant: ButtonVariant; readonly danger?: boolean; readonly act: (() => void) | null };
type View = {
  readonly name: string;
  readonly tag?: string;
  readonly title: string;
  readonly line?: string;
  readonly check?: { readonly label: string; readonly checked: boolean; readonly set: (v: boolean) => void };
  readonly busy: boolean;
  readonly buttons: readonly ViewButton[];
};

export function SetupApp({ port }: { port: SetupPort }) {
  const [info, setInfo] = useState<SetupInfo | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: "ask" });
  const [desktop, setDesktop] = useState(false);
  const [removeData, setRemoveData] = useState(false);
  const [progress, setProgress] = useState(0);
  const shown = useRef(false);
  const actions = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void port.state().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [port]);
  useEffect(() => port.onProgress((p) => setProgress(p.done / p.total)), [port]);

  const close = () => void port.close().catch(() => undefined);
  const run = async (job: "install" | "uninstall", force: boolean) => {
    setProgress(0);
    setPhase({ kind: "busy" });
    if (force) {
      const c = await port.forceCloseApp();
      if (!c.ok) return setPhase({ kind: "error", job, error: c.error });
    }
    const r = job === "install" ? await port.install(desktop) : await port.uninstall(removeData);
    setPhase(r.ok ? { kind: "done" } : { kind: "error", job, error: r.error });
  };
  const open = async () => {
    const r = await port.openApp();
    if (!r.ok) setPhase({ kind: "error", job: "open-app", error: r.error });
  };

  const view = info === undefined ? null : viewOf(info, phase, { desktop, setDesktop, removeData, setRemoveData, run, open, close });

  useEffect(() => {
    if (!view || shown.current) return;
    shown.current = true;
    void port.ready(`setup:${view.name}`).catch(() => undefined);
  }, [view, port]);
  useEffect(() => {
    if (phase.kind === "done" || phase.kind === "error") actions.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [phase]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase.kind !== "busy") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!view) return null;
  return (
    <div className={`setup setup-${view.name}`}>
      <div className="setup-bar" {...DRAG}>
        <button type="button" className="window-button window-button-close" tabIndex={-1} aria-label={text.window.close} title={text.window.close} disabled={view.busy} onClick={close}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="setup-content">
        <div className="setup-body">
          <img className="setup-logo" src={logos.sticker} alt="" />
          <div className="setup-text">
            {view.tag && <Tag tone="danger">{view.tag}</Tag>}
            <h1 className="setup-title">{view.title}</h1>
            {view.line && <p className="setup-line">{view.line}</p>}
          </div>
          {view.check && (
            <label className="setup-check">
              <input type="checkbox" checked={view.check.checked} disabled={view.busy} onChange={(e) => view.check?.set(e.currentTarget.checked)} />
              <span>{view.check.label}</span>
            </label>
          )}
        </div>
        <div ref={actions} className={`setup-actions${view.busy ? " setup-actions-busy" : ""}`}>
          {view.busy && (
            <div className="setup-progress" role="progressbar" aria-label={t.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div className="setup-progress-fill" style={{ "--progress": progress } as CSSProperties} />
            </div>
          )}
          {view.buttons.map((b) => (
            <Button key={b.label} variant={b.variant} danger={b.danger} disabled={!b.act} onClick={() => b.act?.()}>
              {b.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

type Handlers = {
  readonly desktop: boolean;
  readonly setDesktop: (v: boolean) => void;
  readonly removeData: boolean;
  readonly setRemoveData: (v: boolean) => void;
  readonly run: (job: "install" | "uninstall", force: boolean) => Promise<void>;
  readonly open: () => Promise<void>;
  readonly close: () => void;
};

function viewOf(info: SetupInfo | null, phase: Phase, h: Handlers): View {
  const closeButton: ViewButton = { label: t.close, variant: "secondary", act: h.close };
  if (!info) return { name: "error", tag: t.tag.install, title: t.stateTitle, line: t.stateLine(t.stateCode), busy: false, buttons: [closeButton] };
  const uninstall = info.mode === "uninstall";
  const update = isUpdate(info);
  const install = () => void h.run("install", false);
  const openApp = () => void h.open();

  if (phase.kind === "done") {
    if (uninstall) return { name: "done", title: t.removed, line: t.removedLine(h.removeData), busy: false, buttons: [closeButton] };
    return { name: "done", title: update ? t.updated : t.installed, busy: false, buttons: [{ label: t.open, variant: "primary", act: openApp }, closeButton] };
  }
  if (phase.kind === "error") return errorView(info, phase.job, phase.error, h);

  const ask = askView(info, h, install, openApp);
  if (phase.kind === "ask") return ask;
  const label = uninstall ? t.removing : update ? t.updating : t.installing;
  return { ...ask, name: "busy", busy: true, buttons: [{ label, variant: uninstall ? "secondary" : "primary", danger: uninstall, act: null }] };
}

function askView(info: SetupInfo, h: Handlers, install: () => void, openApp: () => void): View {
  const ask = askOf(info);
  const installed = info.installed.kind === "none" ? "" : info.installed.version;
  switch (ask) {
    case "welcome":
      return { name: ask, title: t.welcome, line: t.version(info.version), check: { label: t.desktop, checked: h.desktop, set: h.setDesktop }, busy: false, buttons: [{ label: t.install, variant: "primary", act: install }] };
    case "update":
      return { name: ask, title: t.updateTitle(installed), line: t.updateLine(info.version), busy: false, buttons: [{ label: t.update, variant: "primary", act: install }] };
    case "same":
      return {
        name: ask,
        title: t.sameTitle(info.version),
        busy: false,
        buttons: [
          { label: t.open, variant: "primary", act: openApp },
          { label: t.reinstall, variant: "secondary", act: install },
        ],
      };
    case "newer":
      return { name: ask, title: t.newerTitle, line: t.newerLine(installed, info.version), busy: false, buttons: [{ label: t.close, variant: "secondary", act: h.close }] };
    case "confirm":
      return {
        name: ask,
        title: t.confirmTitle,
        line: t.confirmLine,
        check: { label: t.removeData, checked: h.removeData, set: h.setRemoveData },
        busy: false,
        buttons: [
          { label: t.remove, variant: "secondary", danger: true, act: () => void h.run("uninstall", false) },
          { label: t.cancel, variant: "ghost", act: h.close },
        ],
      };
  }
}

function errorView(info: SetupInfo, job: Job, error: SetupError, h: Handlers): View {
  const tag = job === "open-app" ? t.tag.open : job === "uninstall" ? t.tag.uninstall : isUpdate(info) ? t.tag.update : t.tag.install;
  const { title, line } = t.error(job === "uninstall", error.code);
  const work = job === "uninstall" ? "uninstall" : "install";
  const buttons = errorButtons(job, error).map((b): ViewButton => {
    switch (b) {
      case "retry":
        return { label: t.retry, variant: "primary", act: () => void h.run(work, false) };
      case "force-close":
        return { label: t.forceClose, variant: "secondary", act: () => void h.run(work, true) };
      case "close":
        return { label: t.close, variant: "secondary", act: h.close };
    }
  });
  return { name: "error", tag, title, line, busy: false, buttons };
}
