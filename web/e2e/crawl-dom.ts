/**
 * The in-page half of the UI crawl (`crawl.spec.ts`): ONE function that runs inside the browser and returns plain facts about the page as it is rendered
 * (text, headings, overflow, unnamed controls, duplicate ids, small targets, Latin-only text nodes …). The judgement ("is that a finding?") lives in `crawl-lib.ts`.
 * It must stay self-contained: Playwright serialises it, so it cannot reference anything outside its own body.
 */
export interface DomFacts {
  text: string;
  h1: string[];
  mains: number;
  lang: string;
  theme: string;
  dir: string;
  title: string;
  vw: number;
  scrollW: number;
  overflowers: string[];
  unnamed: string[];
  unlabeled: string[];
  placeholderOnly: string[];
  imgNoAlt: string[];
  dupIds: string[];
  smallTargets: string[];
  headingJumps: string[];
  latinNodes: string[];
  devOverlay: string | null;
  alerts: string[];
  busy: number;
  links: string[];
  tableNoHead: number;
  positiveTabindex: string[];
}

export function collectFacts(opts: { checkTargets: boolean }): DomFacts {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  const hidden = (el: Element) => !!el.closest("[inert],[aria-hidden='true'],dialog:not([open])") || (!!el.closest("details:not([open])") && !el.closest("summary")) || !vis(el);
  const snip = (el: Element) => {
    const e = el as HTMLElement;
    const tid = e.getAttribute("data-testid");
    const cls = (e.getAttribute("class") ?? "").replace(/\s+/g, " ").slice(0, 50);
    const txt = (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    return `<${e.tagName.toLowerCase()}${tid ? ` data-testid="${tid}"` : ""}${e.id ? ` id="${e.id}"` : ""}${cls ? ` class="${cls}"` : ""}>${txt}`;
  };
  const byId = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
  const nameOf = (el: Element): string => {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const t = lb.split(/\s+/).map(byId).join(" ").trim(); if (t) return t; }
    const al = el.getAttribute("aria-label")?.trim();
    if (al) return al;
    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) return el.value || el.title || "";
    const t = ((el as HTMLElement).innerText || el.textContent || "").trim();
    if (t) return t;
    const alt = el.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt");
    if (alt) return alt;
    const st = el.querySelector("svg title")?.textContent?.trim();
    if (st) return st;
    return el.getAttribute("title")?.trim() ?? "";
  };

  const docEl = document.documentElement;
  const vw = docEl.clientWidth;
  const scrollW = docEl.scrollWidth;

  // elements sticking out of the viewport that no scroll container clips (only worth computing when the page itself overflows)
  const overflowers: string[] = [];
  if (scrollW > vw + 1) {
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (overflowers.length >= 8) break;
      if (hidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; } }
        if (getComputedStyle(p).position === "fixed") { clipped = true; break; }
      }
      if (!clipped) overflowers.push(`${snip(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
  }

  const unnamed: string[] = [];
  for (const el of Array.from(document.querySelectorAll("button, [role='button'], a[href], [role='tab'], [role='menuitem'], input[type='button'], input[type='submit'], summary"))) {
    if (hidden(el)) continue;
    if (!nameOf(el)) unnamed.push(snip(el));
  }
  const unlabeled: string[] = [];
  const placeholderOnly: string[] = [];
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const e = el as HTMLInputElement;
    if (e.type === "hidden" || e.type === "button" || e.type === "submit" || e.type === "reset" || e.type === "image" || hidden(el)) continue;
    const named = !!(el.getAttribute("aria-label")?.trim() || (el.getAttribute("aria-labelledby") && el.getAttribute("aria-labelledby")!.split(/\s+/).map(byId).join("").trim())
      || (e.labels && Array.from(e.labels).some((l) => (l.textContent ?? "").trim())) || el.getAttribute("title")?.trim());
    if (!named) (el.getAttribute("placeholder") ? placeholderOnly : unlabeled).push(snip(el));
  }
  const imgNoAlt = Array.from(document.querySelectorAll("img:not([alt])")).filter((i) => !hidden(i)).map(snip);

  const seen = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll("[id]"))) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  const dupIds = Array.from(seen).filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`);

  const smallTargets: string[] = [];
  if (opts.checkTargets) {
    for (const el of Array.from(document.querySelectorAll("button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='tab']"))) {
      if (hidden(el)) continue;
      if (el.classList.contains("sr-only")) continue; // the skip link is visually hidden until focused
      const cs = getComputedStyle(el);
      if (el.tagName === "A" && cs.display === "inline" && el.closest("p, li, span, dd, td")) continue; // inline links inside running text are exempt (WCAG 2.5.8)
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") && el.labels && el.labels.length) continue; // the label is the target
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) smallTargets.push(`${snip(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  const levels = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter((h) => !hidden(h)).map((h) => ({ n: Number(h.tagName[1]), t: (h.textContent ?? "").trim().slice(0, 30) }));
  const headingJumps: string[] = [];
  levels.forEach((h, i) => { if (i > 0 && h.n > levels[i - 1].n + 1) headingJumps.push(`h${levels[i - 1].n} → h${h.n} "${h.t}"`); });

  // visible text nodes with Latin letters only (no Arabic script, not inside a number/code/LTR island): untranslated copy in an RTL locale
  const latinNodes: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (s.length < 3 || !/[A-Za-z]{3,}/.test(s) || /[؀-ۿ]/.test(s)) continue;
    const p = n.parentElement; if (!p || p.closest("script,style,noscript,code,pre,[dir='ltr'],.ltr-num,[data-testid='lang-switch']") || hidden(p)) continue;
    if (latinNodes.length < 400) latinNodes.push(s.slice(0, 120));
  }

  let devOverlay: string | null = null;
  const sr = document.querySelector("nextjs-portal")?.shadowRoot;
  if (sr) {
    const dlg = sr.querySelector("[data-nextjs-dialog]");
    const badge = sr.querySelector("[data-next-badge][data-error='true']");
    if (dlg) devOverlay = (dlg.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    else if (badge) devOverlay = `dev badge reports an error: ${(badge.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100)}`;
  }

  const links = Array.from(document.querySelectorAll("a[href]")).filter((a) => !a.hasAttribute("download")).map((a) => a.getAttribute("href") ?? "");
  return {
    text: document.body.innerText,
    h1: Array.from(document.querySelectorAll("h1")).filter((h) => !hidden(h)).map((h) => (h.textContent ?? "").trim()),
    mains: document.querySelectorAll("main, [role='main']").length,
    lang: docEl.lang, theme: docEl.dataset.theme ?? "", dir: docEl.dir, title: document.title, vw, scrollW, overflowers,
    unnamed, unlabeled, placeholderOnly, imgNoAlt, dupIds, smallTargets, headingJumps, latinNodes, devOverlay,
    alerts: Array.from(document.querySelectorAll("[role='alert']")).filter((a) => !hidden(a)).map((a) => (a.textContent ?? "").trim().slice(0, 160)),
    busy: Array.from(document.querySelectorAll("[aria-busy='true'], .animate-pulse")).filter((e) => !hidden(e) && e.getBoundingClientRect().height > 12).length, // a pulsing 8 px status dot is decoration, not a skeleton
    links,
    tableNoHead: Array.from(document.querySelectorAll("table")).filter((t) => !hidden(t) && !t.querySelector("th")).length,
    positiveTabindex: Array.from(document.querySelectorAll("[tabindex]")).filter((e) => Number(e.getAttribute("tabindex")) > 0).map(snip),
  };
}
