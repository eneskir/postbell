import type { ReactNode } from "react";
import type { Screen, StoreScreenError } from "../core/screen.ts";
import type { BrandReading } from "./brand-data.ts";
import type { BrandId } from "../core/shares.ts";
import type { StoreFile } from "../core/store.ts";
import { Button, EmptyState, ErrorState, Notice, SkeletonList } from "./components.tsx";
import { assertNever, type Route, type View } from "./route.ts";
import { text } from "./text.ts";

type Props = {
  readonly route: Route;
  readonly view: View;
  readonly screen: Screen<StoreFile, StoreScreenError>;
  readonly go: (r: Route) => void;
  readonly retry: () => void;
  readonly reading: (brand: BrandId) => BrandReading | null;
  readonly reread: () => void;
  readonly children?: ReactNode;
};

function PageTitle({ view }: { view: View }) {
  return <h1 className="visually-hidden">{view.title}</h1>;
}

export function PageContent({ route, view, screen, go, retry, reading, reread, children }: Props) {
  const placeholder = <Placeholder route={route} go={go} reading={reading} reread={reread} />;
  switch (screen.kind) {
    case "loading":
      return (
        <>
          <PageTitle view={view} />
          <div className="page-body">
            <SkeletonList label={text.sharesLoading} />
          </div>
        </>
      );
    case "error":
      return (
        <>
          <PageTitle view={view} />
          {screen.code === "store-newer-version" ? (
            <ErrorState tag={text.store.errorTag} title={text.store.errorTitle} body={text.store.newerBody} />
          ) : (
            <ErrorState tag={text.store.errorTag} title={text.store.errorTitle} body={text.store.errorBody(screen.code)} action={{ label: text.store.retry, onClick: retry }} />
          )}
        </>
      );
    case "empty":
      return (
        <>
          <PageTitle view={view} />
          {route.kind === "home" ? (
            <EmptyState drawing="whirl-3" title={text.store.emptyTitle} body={text.store.emptyBody} action={{ label: text.page.brandNew, onClick: () => go({ kind: "brand-new" }) }} />
          ) : (
            (children ?? placeholder)
          )}
        </>
      );
    case "ready":
      return (
        <>
          <PageTitle view={view} />
          {children ?? placeholder}
        </>
      );
    default:
      return assertNever(screen);
  }
}

export function folderBlock(brand: BrandId, r: BrandReading, go: (r: Route) => void, reread: () => void): ReactNode {
  const settings = { label: text.folder.settings, onClick: () => go({ kind: "brand-settings", brand }) };
  switch (r.folder.kind) {
    case "missing":
      return <ErrorState tag={text.folder.tag} title={text.folder.missingTitle} body={text.folder.missingBody} action={{ label: text.folder.retry, onClick: reread }} link={settings} />;
    case "unreadable":
      return <ErrorState tag={text.folder.tag} title={text.folder.unreadableTitle} body={text.folder.unreadableBody(r.folder.code)} action={{ label: text.folder.retry, onClick: reread }} link={settings} />;
    case "empty":
      return <EmptyState drawing="whirl-3" title={text.folder.emptyTitle} body={text.folder.emptyBody} action={settings} />;
    case "read":
      return null;
    default:
      return assertNever(r.folder);
  }
}

export function RejectedNotice({ reading, reread }: { reading: BrandReading; reread: () => void }) {
  if (reading.rejected.length === 0) return null;
  return (
    <Notice
      tone="danger"
      action={{ label: text.folder.retry, onClick: reread }}
      detail={reading.rejected.map((x) => text.folder.rejectedItem(x.dir, x.why)).join("\n")}
    >
      {text.folder.rejected(reading.rejected.length)}
    </Notice>
  );
}

function Placeholder({ route, go, reading, reread }: Pick<Props, "route" | "go" | "reading" | "reread">) {
  const r = route.kind === "brand" && route.page !== "accounts" ? reading(route.brand) : null;
  const block = route.kind === "brand" && r ? folderBlock(route.brand, r, go, reread) : null;
  if (block) return block;
  return (
    <div className="page-body">
      {r && <RejectedNotice reading={r} reread={reread} />}
      <p className="page-summary">{text.placeholder.body}</p>
      {route.kind === "brand" && (
        <Button variant="ghost" onClick={() => go({ kind: "brand-settings", brand: route.brand })}>
          {text.page.brandSettings}
        </Button>
      )}
    </div>
  );
}
