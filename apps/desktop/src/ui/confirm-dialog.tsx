import { useEffect, useId, useRef } from "react";
import { Button } from "./components.tsx";

type Props = {
  readonly title: string;
  readonly body: string;
  readonly confirm: string;
  readonly cancel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmDialog({ title, body, confirm, cancel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // Focus starts on Cancel so a stray Enter cannot run the destructive action.
    cancelRef.current?.focus();
    return () => d.close();
  }, []);

  // A modal dialog blocks focus to the rest of the page, so close it before reporting.
  const finish = (then: () => void) => () => {
    ref.current?.close();
    then();
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Prevent Esc so the window-level handler does not also close the panel.
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        finish(onCancel)();
      }}
      onCancel={(e) => {
        e.preventDefault();
        finish(onCancel)();
      }}
    >
      <div className="dialog-text">
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        <p className="dialog-body" id={bodyId}>
          {body}
        </p>
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" danger onClick={finish(onConfirm)}>
          {confirm}
        </Button>
        <Button variant="ghost" ref={cancelRef} onClick={finish(onCancel)}>
          {cancel}
        </Button>
      </div>
    </dialog>
  );
}
