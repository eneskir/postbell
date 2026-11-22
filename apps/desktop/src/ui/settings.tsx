import { useId, type ReactNode } from "react";

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
