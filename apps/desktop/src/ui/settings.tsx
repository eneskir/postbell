import { useId, type ReactNode } from "react";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu.tsx";
import { text } from "./text.ts";

const MENU_SIDE = 4;

export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={id}>
      <h2 className="group-label" id={id}>
        {label}
      </h2>
      {children}
    </section>
  );
}

type RowProps = {
  readonly title: string;
  readonly description?: string;
  readonly error?: string | null;
  readonly fieldId?: string;
  readonly muted?: boolean;
  readonly children?: ReactNode;
};

export function SettingRow({ title, description, error, fieldId, muted = false, children }: RowProps) {
  const note = error ?? description;
  return (
    <div className="setting-row">
      <div className="setting-label">
        {fieldId ? (
          <label className="setting-title" htmlFor={fieldId}>
            {title}
          </label>
        ) : (
          <span className={muted ? "setting-title muted" : "setting-title"}>{title}</span>
        )}
        {note && (
          <span className={error ? "setting-error" : "setting-description"} id={fieldId ? `${fieldId}-note` : undefined} role={error ? "alert" : undefined}>
            {note}
          </span>
        )}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

// `control/toggle/on|off`: the state word, then the 44 x 24 switch; Space and Enter flip it.
export function Switch({ id, on, onChange }: { id: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <>
      <span className="switch-state" aria-hidden="true">
        {on ? text.settings.on : text.settings.off}
      </span>
      <button id={id} type="button" role="switch" aria-checked={on} aria-describedby={`${id}-note`} className="switch" onClick={() => onChange(!on)}>
        <span className="switch-knob" />
      </button>
    </>
  );
}

type Option<T> = { readonly value: T; readonly label: string };

// `select/setting`: the value and a caret; the list opens 4 px below, right edges aligned, arrow keys move in it.
export function SettingSelect<T extends string | number>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: readonly Option<T>[]; onChange: (value: T) => void }) {
  const current = options.find((o) => o.value === value)?.label ?? String(value);
  return (
    <Menu>
      <MenuTrigger asChild>
        <button id={id} type="button" className="button button-tertiary setting-select" aria-label={`${label}: ${current}`} aria-describedby={`${id}-note`}>
          {current}
          <span aria-hidden="true">▾</span>
        </button>
      </MenuTrigger>
      <MenuContent sideOffset={MENU_SIDE} alignOffset={0}>
        <MenuRadioGroup value={String(value)}>
          {options.map((o) => (
            <MenuRadioItem key={String(o.value)} value={String(o.value)} onSelect={() => onChange(o.value)}>
              {o.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

type FieldProps = {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid?: boolean;
  readonly maxLength?: number;
  readonly autoFocus?: boolean;
  readonly placeholder?: string;
  readonly onBlur?: () => void;
  readonly onEnter?: () => void;
  readonly size: "name" | "time";
};

export function TextField({ id, value, onChange, invalid = false, maxLength, autoFocus = false, placeholder, onBlur, onEnter, size }: FieldProps) {
  return (
    <input
      id={id}
      className={`field field-${size}`}
      type="text"
      value={value}
      maxLength={maxLength}
      autoFocus={autoFocus}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      inputMode={size === "time" ? "numeric" : undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-note` : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onEnter && ((e) => e.key === "Enter" && onEnter())}
    />
  );
}
