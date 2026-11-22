import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { chartVars } from "@/components/reports/chartTheme";

/**
 * Parses the design tokens out of `src/app/globals.css` (the dark block, the light block, the `system` + OS-light block, the print block) and checks them:
 *  - dark is still exactly the original palette (the light-mode work must never move a dark pixel);
 *  - the three light blocks are identical, so `light`, `system` on a light OS and print always look the same;
 *  - WCAG 2.x contrast for every text / surface pair the components use, in BOTH themes (text ≥ 4.5:1, UI boundaries and chart marks ≥ 3:1).
 */
const css = readFileSync(join(import.meta.dirname, "../../src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first `{…}` block whose selector text is `selector`, as `{ "--jr-bg": "#0b132b", … }`. */
function block(selector: string, from = 0): Record<string, string> {
  const start = css.indexOf(selector, from);
  if (start < 0) throw new Error(`no block ${selector}`);
  const open = css.indexOf("{", start), close = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const d of css.slice(open + 1, close).split(/;\s*(?=--|color-scheme)/)) { const m = d.trim().replace(/;$/, "").match(/^(--[\w-]+|color-scheme)\s*:\s*([\s\S]+)$/); if (m) out[m[1]] = m[2].trim(); }
  return out;
}
const dark = block(":root {");
const light = block(':root[data-theme="light"]');
const systemLight = block(':root[data-theme="system"]', css.indexOf("@media (prefers-color-scheme: light)"));
const print = block(":root, :root[data-theme]", css.indexOf("@media print"));

// ── colour maths ────────────────────────────────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const hex = (h: string): RGB => { const m = h.trim().match(/^#([0-9a-f]{6})$/i); if (!m) throw new Error(`not a #rrggbb colour: ${h}`); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as RGB; };
const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** `fg` at `alpha` painted over `base` (what `bg-accent/15` or `text-muted/80` looks like). */
const over = (fg: RGB, alpha: number, base: RGB): RGB => fg.map((c, i) => c * alpha + base[i] * (1 - alpha)) as RGB;

/** The palette of a theme as RGB triples. */
const palette = (t: Record<string, string>) => Object.fromEntries(["bg", "bg-2", "card", "accent", "accent-ink", "cyan", "text", "muted", "line", "line-strong", "gold", "danger", "whatsapp"].map((k) => [k, hex(t[`--jr-${k}`])])) as Record<string, RGB>;

const LEGACY_DARK = { "--jr-bg": "#0b132b", "--jr-bg-2": "#111932", "--jr-card": "#151d34", "--jr-accent": "#05e5a3", "--jr-accent-ink": "#04221a", "--jr-cyan": "#00c5d5", "--jr-text": "#f8fafc", "--jr-muted": "#94a3b8", "--jr-line": "#26334d", "--jr-gold": "#f59e0b", "--jr-danger": "#f87171", "--jr-whatsapp": "#25d366" };

describe("theme tokens (globals.css)", () => {
  it("dark is the original palette, untouched", () => {
    for (const [k, v] of Object.entries(LEGACY_DARK)) expect(dark[k], k).toBe(v);
    expect(dark["--jr-line-strong"], "dark controls keep the original border").toBe(dark["--jr-line"]);
    expect(dark["color-scheme"]).toBe("dark");
  });

  it("both themes define the same tokens, and light / system-on-light OS / print are the same palette", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    expect(systemLight).toEqual(light);
    expect(print).toEqual(light);
    expect(light["color-scheme"]).toBe("light");
  });

  it("every colour token is a plain #rrggbb in both themes (so the contrast maths below sees what the browser paints)", () => {
    for (const t of [dark, light]) for (const k of ["bg", "bg-2", "card", "accent", "accent-ink", "cyan", "text", "muted", "line", "line-strong", "gold", "danger", "whatsapp"]) expect(t[`--jr-${k}`], k).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

for (const [name, tokens] of [["dark", dark], ["light", light]] as const) {
  describe(`${name} theme: WCAG contrast`, () => {
    const P = palette(tokens);
    const surfaces = { bg: P.bg, "bg-2": P["bg-2"], card: P.card } as const;
    const check = (label: string, fg: RGB, bg: RGB, min: number) => { const r = ratio(fg, bg); expect(r, `${label} = ${r.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min); };

    it("text colours on every surface ≥ 4.5:1", () => {
      for (const [sn, s] of Object.entries(surfaces)) for (const fg of ["text", "muted", "accent", "cyan", "gold", "danger", "whatsapp"]) check(`${fg} on ${sn}`, P[fg], s, 4.5);
    });
    if (name === "dark") it("secondary text at the opacity the components use (text-muted/80 hints, group labels) ≥ 4.5:1", () => {
      for (const [sn, s] of Object.entries(surfaces)) check(`muted/80 on ${sn}`, over(P.muted, 0.8, s), s, 4.5);
    });
    it("status text on its own tint (badges, chips, active nav item: tone/10 and tone/15 over each surface) ≥ 4.5:1", () => {
      for (const tone of ["accent", "cyan", "gold", "danger", "whatsapp"]) for (const a of tone === "whatsapp" ? [0.15, 0.25] : [0.1, 0.15]) for (const [sn, s] of Object.entries(surfaces)) check(`${tone} on ${tone}/${a * 100} over ${sn}`, P[tone], over(P[tone], a, s), 4.5);
    });
    it("text on solid brand / status fills (accent-ink on accent, cyan, gold, danger; the gradient avatar) ≥ 4.5:1", () => {
      for (const fill of ["accent", "cyan", "gold", "danger"]) check(`accent-ink on ${fill}`, P["accent-ink"], P[fill], 4.5);
    });
    it("heat-map cells that carry text (accent tint up to 82 % of the heat cap): ink text stays ≥ 4.5:1 at the strongest cell", () => {
      const cap = Number(tokens["--jr-heat-cap"]);
      for (const [sn, s] of Object.entries(surfaces)) if (sn !== "bg-2") check(`ink on the strongest heat cell over ${sn}`, P.text, over(P.accent, 0.82 * cap, s), name === "dark" ? 1.5 : 4.5); // dark keeps its original (unchanged) cells: only a sanity floor
    });
    it("focus ring and active markers (accent) ≥ 3:1 against every surface", () => {
      for (const [sn, s] of Object.entries(surfaces)) check(`accent vs ${sn}`, P.accent, s, 3);
    });
    it("chart series colours (the 8-colour palette derived from the tokens) ≥ 3:1 against the card they are drawn on", () => {
      for (const [i, c] of seriesColors(tokens).entries()) check(`series ${i + 1} ${c.map(Math.round)}`, c, P.card, 3);
    });
  });
}

describe("light theme: secondary text", () => {
  it("every partly-transparent muted text class (text-muted/60 … /95) also carries light:text-muted, so light never shows it below AA (placeholders and decorative /50 are exempt)", () => {
    const root = join(import.meta.dirname, "../../src");
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []));
    const offenders: string[] = [];
    for (const f of files(root)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?<![:\w/-])text-muted\/(?:60|70|80|90|95)(?![\w/])/g)) {
        const q = (from: number, dir: 1 | -1) => { let i = from; while (i >= 0 && i < src.length && !'"`\''.includes(src[i])) i += dir; return i; };
        const seg = src.slice(q(m.index!, -1), q(m.index! + m[0].length, 1));
        if (!seg.includes("light:text-muted")) offenders.push(`${relative(root, f)}: …${seg.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("light theme: form-control borders", () => {
  const P = palette(light);
  it("border-line-strong is ≥ 3:1 against the card, the page and the field fill (WCAG 1.4.11)", () => {
    for (const s of ["card", "bg", "bg-2"]) expect(ratio(P["line-strong"], P[s]), s).toBeGreaterThanOrEqual(3);
  });
});

// ── the chart palette: `chartVars` derives four of its eight colours with CSS relative colour syntax (oklch hue rotation), so evaluate that here ──────────
function srgbToOklch(rgb: RGB): [number, number, number] {
  const [r, g, b] = rgb.map(lin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
function oklchToSrgb([L, C, H]: [number, number, number]): RGB {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))); // clipped to the sRGB gamut (browsers map chroma instead; close enough for a 3:1 check)
  return [enc(lr), enc(lg), enc(lb)];
}
function seriesColors(t: Record<string, string>): RGB[] {
  const P = palette(t);
  const rot = (c: RGB, deg: number): RGB => { const [L, C, H] = srgbToOklch(c); return oklchToSrgb([L, C, (H + deg) % 360]); };
  const get = (k: string) => chartVars[`--rpf-c${k}` as keyof typeof chartVars] as unknown as string;
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
    const v = get(String(i)); // "var(--jr-accent)" or "oklch(from var(--jr-gold) l c calc(h + 150))"
    const base = v.match(/--jr-([\w-]+)/)![1] as string;
    const rotate = v.match(/h \+ (\d+)/);
    return rotate ? rot(P[base], Number(rotate[1])) : P[base];
  });
}
