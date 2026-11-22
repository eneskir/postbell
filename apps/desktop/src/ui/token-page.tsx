import "./fonts.css";
import "./tokens.gen.css";
import "./layout.css";
import "./styles.css";
import "./components.css";
import "./token-page.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import figma from "../../tokens/figma.json";
import { contrastRatio } from "../core/contrast.ts";
import { emptyDrawings, logos, navIcons, stickers } from "./assets.gen.ts";
import { Button, Notice, SkeletonList, Tag, type ButtonVariant, type Tone } from "./components.tsx";
import { text } from "./text.ts";

type Variable = { name: string; type: string; value: string | number };
type TextStyle = { name: string; family: string; style: string; size: number; lineHeight: number };
const variables = figma.variables as Variable[];
const textStyles = figma.textStyles as TextStyle[];

const cssName = (figmaName: string) => `--${figmaName.replace(/\//g, "-")}`;
const colors = variables.filter((v) => v.type === "COLOR");
const numbers = variables.filter((v) => v.type === "FLOAT");
const valueOf = (name: string) => String(variables.find((v) => v.name === name)?.value ?? "");
const SAMPLE = "Bugün üç paylaşım sırada; ilki 14.15'te Instagram'a gidiyor.";
const STATUS = ["success", "warning", "danger"] as const;
const VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "tertiary", "ghost"];
const TONES: readonly Tone[] = ["danger", "warning", "neutral", "success"];
const noop = () => undefined;

function TokenPage() {
  return (
    <main className="tokens">
      <h1>Postbell jetonları</h1>
      <p className="muted" id="counts">
        {`Değişken ${variables.length} (renk ${colors.length}, sayı ${numbers.length}) · yazı stili ${textStyles.length} · görsel ${
          Object.keys(navIcons).length + Object.keys(stickers).length + Object.keys(emptyDrawings).length + Object.keys(logos).length
        }`}
      </p>

      <h2>Renkler</h2>
      <ul className="grid">
        {colors.map((c) => (
          <li key={c.name} className="swatch" data-token={c.name}>
            <span className="chip" style={{ background: `var(${cssName(c.name)})` }} />
            <span>{c.name}</span>
            <span className="muted">{String(c.value)}</span>
          </li>
        ))}
      </ul>

      <h2>Durum çiftleri</h2>
      <ul className="list">
        {STATUS.map((s) => (
          <li key={s} className="status" data-status={s} style={{ background: `var(--color-${s}-soft)`, color: `var(--color-${s})` }}>
            {`${s} ${valueOf(`color/${s}`)} / ${s}-soft ${valueOf(`color/${s}-soft`)} · karşıtlık ${contrastRatio(valueOf(`color/${s}`), valueOf(`color/${s}-soft`)).toFixed(2)}:1`}
          </li>
        ))}
      </ul>

      <h2>Boşluk, köşe, ölçü</h2>
      <ul className="list">
        {numbers.map((n) => (
          <li key={n.name} className="number">
            <span className="bar" style={{ width: `var(${cssName(n.name)})` }} />
            <span>{`${n.name} = ${n.value}`}</span>
          </li>
        ))}
      </ul>

      <h2>Yazı stilleri</h2>
      <ul className="list">
        {textStyles.map((t) => (
          <li key={t.name} className="text-sample" data-style={t.name}>
            <span className="muted">{`${t.name} · ${t.family} ${t.style} ${t.size}/${t.lineHeight}`}</span>
            <span style={{ font: `var(${cssName(t.name)})` }}>{SAMPLE}</span>
          </li>
        ))}
      </ul>

      <h2>Bileşenler</h2>
      <div className="components" id="components">
        <div className="row">
          {VARIANTS.map((v) => (
            <Button key={v} variant={v} onClick={noop}>
              {`button/${v}`}
            </Button>
          ))}
          <Button variant="primary" onClick={noop} disabled>
            devre dışı
          </Button>
        </div>
        <div className="row">
          {TONES.map((t) => (
            <Tag key={t} tone={t}>{`tag/status/${t}`}</Tag>
          ))}
        </div>
        <Notice tone="neutral" action={{ label: text.today.setupAction["add-account"], onClick: noop }}>
          {text.today.setupNotice}
        </Notice>
        <Notice tone="danger" action={{ label: text.folder.retry, onClick: noop }}>
          {text.folder.rejected(1)}
        </Notice>
        <SkeletonList label="iskelet" />
      </div>

      <h2>Görseller</h2>
      <ul className="grid">
        {Object.entries(navIcons).map(([n, url]) => (
          <li key={n} className="asset">
            <span className="nav-icon" style={{ maskImage: `url("${url}")` }} />
            <span>{`icon/nav/${n}`}</span>
          </li>
        ))}
        {Object.entries(stickers).map(([n, url]) => (
          <li key={n} className="asset">
            <img src={url} alt="" width={24} height={24} />
            <span>{`icon/brand/${n}`}</span>
          </li>
        ))}
        {Object.entries(emptyDrawings).map(([n, url]) => (
          <li key={n} className="asset">
            <img src={url} alt="" width={96} height={96} />
            <span>{`illustration/empty/${n}`}</span>
          </li>
        ))}
        {Object.entries(logos).map(([n, url]) => (
          <li key={n} className="asset">
            <img src={url} alt="" />
            <span>{`logo/postbell/${n}`}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("UI_ROOT_MISSING");
createRoot(root).render(
  <StrictMode>
    <TokenPage />
  </StrictMode>,
);
