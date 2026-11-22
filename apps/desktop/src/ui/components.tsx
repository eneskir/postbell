import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { emptyDrawings, navIcons, type EmptyDrawingName, type IconName } from "./assets.gen.ts";

export type Action = { readonly label: string; readonly onClick: () => void };

// "deep" lets child elements drag the window too; buttons do not.
export const DRAG = { "data-tauri-drag-region": "deep" } as const;

// Focus goes back to the control that opened a toast, panel or dialog, or to the page once that control is gone.
export const focusBack = (to: HTMLElement | null | undefined) => (to?.isConnected ? to : document.querySelector<HTMLElement>("main.page"))?.focus();

export function Icon({ name }: { name: IconName }) {
  return <span className="icon" aria-hidden="true" style={{ maskImage: `url("${navIcons[name]}")` }} />;
}

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost";

type ButtonProps = { variant: ButtonVariant; disabled?: boolean; danger?: boolean; ref?: Ref<HTMLButtonElement>; children: ReactNode } & (
  | { submit: true; onClick?: never }
  | { submit?: false; onClick: () => void }
);

export function Button({ variant, onClick, submit = false, disabled = false, danger = false, ref, children }: ButtonProps) {
  return (
    <button ref={ref} type={submit ? "submit" : "button"} className={`button button-${variant}${danger ? " button-danger" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export type ToastView = { readonly id: number; readonly text: string; readonly action?: Action };

export const TOAST_MS = 5000;

// Pauses while hovered or focused (WCAG 2.2.1). The shell's `aria-live` region stays mounted so the first toast is announced.
export function Toast({ toast, onDismiss }: { toast: ToastView; onDismiss: (id: number) => void }) {
  const { action } = toast;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const back = useRef<HTMLElement | null>(null);
  const paused = hover || focus;
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast.id, paused, onDismiss]);
  return (
    <div
      className="toast"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => {
        setFocus(true);
        if (!e.currentTarget.contains(e.relatedTarget)) back.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
      }}
      onBlur={(e) => setFocus(e.currentTarget.contains(e.relatedTarget))}
    >
      <span className="toast-text">{toast.text}</span>
      {action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            const to = back.current;
            action.onClick();
            focusBack(to);
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export type Tone = "danger" | "warning" | "neutral" | "success";

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function EmptyState({ drawing, title, body, action }: { drawing: EmptyDrawingName; title: string; body: string; action?: Action }) {
  return (
    <>
      <div className="state-art" aria-hidden="true">
        <span className="state-art-drawing" style={{ maskImage: `url("${emptyDrawings[drawing]}")` }} />
      </div>
      <section className="state-block">
        <h2 className="state-title">{title}</h2>
        <p className="state-body">{body}</p>
        {action && (
          <Button variant="secondary" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </section>
    </>
  );
}

export function ErrorState({ tag, title, body, action, link }: { tag: string; title: string; body: string; action?: Action; link?: Action }) {
  return (
    <section className="state-block">
      <Tag tone="danger">{tag}</Tag>
      <h2 className="state-title">{title}</h2>
      <p className="state-body">{body}</p>
      {action && (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {link && (
        <Button variant="ghost" onClick={link.onClick}>
          {link.label}
        </Button>
      )}
    </section>
  );
}

export function Notice({ tone, children, action, detail }: { tone: "neutral" | "danger"; children: ReactNode; action?: Action; detail?: string }) {
  return (
    <div className={`notice${tone === "danger" ? " notice-danger" : ""}`} role={tone === "danger" ? "alert" : "status"}>
      <p className="notice-text" title={detail}>
        {children}
      </p>
      {action && (
        <Button variant="tertiary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

const SKELETON = [
  { label: "--skeleton-label-1", rows: ["--skeleton-text-1", "--skeleton-text-2", "--skeleton-text-3"] },
  { label: "--skeleton-label-2", rows: ["--skeleton-text-4", "--skeleton-text-5"] },
] as const;

const bar = (width: string) => <span className="skeleton" style={{ width: `var(${width})` }} />;

export function SkeletonList({ label, groups = SKELETON.length }: { label: string; groups?: number }) {
  return (
    <div className="skeleton-block" role="status" aria-busy="true">
      <p className="page-summary">{label}</p>
      <div className="skeleton-list" aria-hidden="true">
        {SKELETON.slice(0, groups).map((g) => (
          <div key={g.label}>
            <div className="skeleton-label">{bar(g.label)}</div>
            {g.rows.map((w) => (
              <div key={w} className="skeleton-row">
                <span className="skeleton skeleton-thumb" />
                {bar(w)}
                <span className="skeleton-spacer" />
                {bar("--skeleton-meta-1")}
                {bar("--skeleton-meta-2")}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
