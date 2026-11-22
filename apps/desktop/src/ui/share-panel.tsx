import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import type { ContentFile } from "../core/manifest.ts";
import { panelSteps } from "../core/panel-steps.ts";
import type { Share } from "../core/shares.ts";
import { timeOf } from "../core/time.ts";
import { Button, Icon, Notice, Tag } from "./components.tsx";
import { assertNever, type Route } from "./route.ts";
import { text } from "./text.ts";

const COPIED_MS = 1500;

export type ShareActions = {
  readonly copy: () => Promise<boolean>;
  readonly reveal: () => void;
  readonly open: () => void;
  readonly restore: () => void;
  readonly mark: () => void;
  readonly skip: () => void;
  readonly undo: () => void;
  readonly addAccount: () => void;
};

type Props = {
  readonly share: Share;
  readonly size: number | null;
  readonly url: string | null;
  readonly go: (r: Route) => void;
  readonly actions: ShareActions;
};

export function SharePanel({ share: s, size, url, go, actions }: Props) {
  const missing = s.blockers.includes("file-missing");
  const tag = headTag(s);
  const steps = panelSteps(s);
  const markButton = useRef<HTMLButtonElement>(null);
  const focusMark = useRef(false);
  const finished = steps.mark.kind === "done";
  useEffect(() => {
    if (!focusMark.current || !finished) return;
    focusMark.current = false;
    markButton.current?.focus();
  }, [finished]);
  const skip = () => {
    focusMark.current = true;
    actions.skip();
  };
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => setCopied(0), [s.id]);
  const copy = () => void actions.copy().then((ok) => ok && setCopied(Date.now()));
  const shareButton = useRef<HTMLButtonElement>(null);
  const focusShare = useRef(false);
  useEffect(() => {
    if (!focusShare.current || missing) return;
    focusShare.current = false;
    shareButton.current?.focus();
  }, [missing]);
  const restore = () => {
    focusShare.current = true;
    actions.restore();
  };
  const toSettings = () => go({ kind: "brand-settings", brand: s.brand });
  return (
    <>
      <div className="share-head">
        {tag}
        <h2 className="panel-heading">{s.content.title}</h2>
      </div>
      {s.account && s.plannedAt.kind === "unscheduled" && s.status.kind === "upcoming" && (
        <Notice tone="neutral" action={{ label: text.share.addTime, onClick: toSettings }}>
          {text.share.noTimeNotice(s.platform)}
        </Notice>
      )}
      <Preview file={s.file} url={missing ? null : url} />
      <p className={`share-file${missing ? " share-file-missing" : ""}`}>{text.share.fileLine(s.file, missing ? null : size)}</p>
      {missing && (
        <div className="share-missing">
          <p className="share-missing-text">{text.share.missingNotice}</p>
          <Button variant="primary" onClick={restore}>
            {text.share.restore}
          </Button>
        </div>
      )}
      <hr className="share-divider" />
      <section className="share-step">
        <h3 className="share-step-title">{text.share.steps.prepare}</h3>
        <p className="share-caption">{s.text}</p>
        <div className="share-actions">
          <Button variant="tertiary" onClick={copy}>
            <span className="copy-label">
              {text.share.copy}
              <span className={copied ? "copy-tick copy-tick-on" : "copy-tick"}>
                <Icon name="tick" />
              </span>
            </span>
          </Button>
          <span className="visually-hidden" role="status">
            {copied ? text.toast.copied : ""}
          </span>
          {steps.reveal && (
            <Button variant="tertiary" onClick={actions.reveal}>
              {text.share.reveal}
            </Button>
          )}
        </div>
      </section>
      <section className="share-step">
        <h3 className="share-step-title">{text.share.steps.share}</h3>
        {shareStep(s, steps.share, actions.open, actions.addAccount, shareButton)}
      </section>
      <section className="share-step">
        <h3 className="share-step-title">{text.share.steps.mark}</h3>
        <Button variant="secondary" ref={markButton} disabled={steps.mark.kind === "blocked"} onClick={finished ? actions.undo : actions.mark}>
          {finished ? text.share.undo : text.share.mark}
        </Button>
      </section>
      {steps.skip && (
        <>
          <hr className="share-divider" />
          <div className="share-defer">
            <Button variant="ghost" onClick={skip}>
              {text.share.skip}
            </Button>
            <p className="share-note">{text.share.skipNote}</p>
          </div>
        </>
      )}
    </>
  );
}

function shareStep(s: Share, state: ReturnType<typeof panelSteps>["share"], open: () => void, toAccounts: () => void, ref: Ref<HTMLButtonElement>): ReactNode {
  if (state.kind === "blocked" && state.reason === "file-missing") return <p className="share-hint share-hint-muted">{text.share.fileWait}</p>;
  if (state.kind === "blocked" || !s.account)
    return (
      <>
        <Button variant="primary" onClick={toAccounts}>
          {text.share.addAccount(s.platform)}
        </Button>
        <p className="share-hint">{text.share.noAccount(s.platform)}</p>
      </>
    );
  return (
    <>
      <Button variant="primary" ref={ref} onClick={open}>
        {text.share.open(s.account.handle, s.platform)}
      </Button>
      <p className="share-hint">{text.share.accountCheck(s.account.handle, s.platform)}</p>
    </>
  );
}

function headTag(s: Share): ReactNode {
  const st = s.status;
  switch (st.kind) {
    case "late":
      return <Tag tone="danger">{text.share.late(st.lateBy)}</Tag>;
    case "due":
      return <Tag tone="warning">{text.today.due}</Tag>;
    case "done":
      return <Tag tone="success">{text.share.done(timeOf(st.at))}</Tag>;
    case "skipped":
      return <Tag tone="neutral">{text.share.skipped(timeOf(st.at))}</Tag>;
    case "upcoming":
      return s.plannedAt.kind === "unscheduled" ? <Tag tone="neutral">{text.share.noTime}</Tag> : null;
    default:
      return assertNever(st);
  }
}

function Preview({ file, url }: { file: ContentFile; url: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const style = { "--preview-ratio": file.width / file.height } as CSSProperties;
  const media =
    url === null || failed === url ? (
      <span className="share-preview-media share-preview-empty" style={style} />
    ) : file.kind === "image" ? (
      <img className="share-preview-media" style={style} src={url} alt="" onError={() => setFailed(url)} />
    ) : (
      <video className="share-preview-media" style={style} src={`${url}#t=0.1`} muted playsInline preload="metadata" onError={() => setFailed(url)} />
    );
  return (
    <div className="share-preview" aria-hidden="true">
      {media}
    </div>
  );
}
