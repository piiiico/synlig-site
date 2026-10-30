#!/usr/bin/env bun
/**
 * design-gate.ts — one design system, counted on the HTML a visitor receives.
 *
 * Håkon 10-26: «inkonsistent med forskjellige farger, størrelser på logo».
 * Gate across the CORE pages taken together (not per page):
 *   ≤ 12 distinct colours (hex + rgb/hsl/oklch literals) · exactly 1 logo variant · ≤ 2 font stacks.
 *
 * Usage: bun design-gate.ts            → fetch CORE_PAGES live (the oracle)
 *        bun design-gate.ts --base URL → same paths on another origin
 * Exit 1 on a breach, 2 when fewer pages parsed than requested (no verdict).
 */

export const CORE_PAGES = [
  "/", "/leaderboard", "/metode", "/priser", "/faktura",
  "/blogg/aeo-byra-norge", "/tjenester/", "/tjenester/aeo",
  "/tjenester/aeo-for-advokater", "/tjenester/digital-markedsforing-stavanger", "/audit",
];
export const LIMITS = { colors: 12, logos: 1, fonts: 2 };

const expand = (h: string) => {
  h = h.toLowerCase();
  if (h.length === 4 || h.length === 5) h = "#" + [...h.slice(1)].map((c) => c + c).join("");
  return h.length === 9 && h.endsWith("ff") ? h.slice(0, 7) : h;
};

/** Text that only executes or annotates, never paints: JSON-LD, comments. */
const strip = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*type=["']application\/ld\+json["'][\s\S]*?<\/script>/gi, "");

export function colors(html: string): Set<string> {
  const s = new Set<string>();
  for (const m of strip(html).matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    if ([4, 5, 7, 9].includes(m[0].length)) s.add(expand(m[0]));
  }
  // Tailwind v4 paints in oklch(); a hex-only count reads its palette as zero colours.
  for (const m of strip(html).matchAll(/\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/gi)) {
    if (!/var\(|calc\(/.test(m[0])) s.add(m[0].toLowerCase().replace(/\s+/g, " "));
  }
  return s;
}

/** Font stack = its PRIMARY family. Read from font-family, the `font:` shorthand and
 *  custom properties alike — a counter blind to shorthand reads `font:600 14px X` as no font. */
export function fonts(html: string): Set<string> {
  const s = new Set<string>();
  const add = (v: string) => {
    const first = v.split(",")[0].replace(/!important/, "").replace(/["']/g, "").trim().toLowerCase();
    if (first && !/^[\d.]+\w*$/.test(first) && !first.startsWith("var(") && !["inherit", "initial", "unset"].includes(first)) s.add(first);
  };
  const css = strip(html);
  for (const m of css.matchAll(/font-family\s*:\s*([^;}"]+)/gi)) add(m[1]);
  for (const m of css.matchAll(/(?:^|[;{\s])font\s*:\s*[^;}]*?[\d.]+(?:px|rem|em|%|pt)(?:\s*\/\s*[\d.]+\w*)?\s+([^;}]+)/gi)) add(m[1]);
  for (const m of css.matchAll(/--[\w-]*(?:font|serif|sans|mono)[\w-]*\s*:\s*([^;}]+)/gi)) add(m[1]);
  return s;
}

/** Logo = rendered text of the first element whose class names a logo, plus its class.
 *  A page with none is its own variant ("∅"): a missing logo is an inconsistency too. */
export function logo(html: string): string {
  const m = strip(html).match(/<(a|div|span)\b[^>]*class=["'][^"']*\blogo\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return "∅";
  return m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() + " {" + (m[0].match(/class=["']([^"']*)/i)?.[1] ?? "") + "}";
}

export function measure(pages: Record<string, string>) {
  const c = new Set<string>(), f = new Set<string>(), l = new Map<string, string[]>();
  for (const [p, html] of Object.entries(pages)) {
    colors(html).forEach((x) => c.add(x));
    fonts(html).forEach((x) => f.add(x));
    const v = logo(html);
    l.set(v, [...(l.get(v) ?? []), p]);
  }
  const breaches = [
    c.size > LIMITS.colors && `colors ${c.size} > ${LIMITS.colors}`,
    l.size !== LIMITS.logos && `logo variants ${l.size} ≠ ${LIMITS.logos}`,
    f.size > LIMITS.fonts && `font stacks ${f.size} > ${LIMITS.fonts}`,
  ].filter(Boolean) as string[];
  return { colors: [...c].sort(), fonts: [...f], logos: Object.fromEntries(l), breaches };
}

if (import.meta.main) {
  const i = process.argv.indexOf("--base");
  const base = i > 0 ? process.argv[i + 1] : "https://synligdigital.no";
  const pages: Record<string, string> = {};
  for (const p of CORE_PAGES) {
    const r = await fetch(base + p, { headers: { "User-Agent": "Pico-design-gate/1.0 (AI agent; synligdigital.no)" } });
    const t = await r.text();
    if (!r.ok || !/<html/i.test(t)) { console.error(`UNPARSED ${p}: HTTP ${r.status}`); continue; }
    // Linked stylesheets paint too — a page that moved its colours to /_astro/*.css
    // must not read clean. An unfetchable stylesheet voids the page (no partial verdict).
    let css = "", ok = true;
    for (const m of t.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) {
      const href = m[0].match(/href=["']([^"']+)/)?.[1];
      if (!href) continue;
      const cr = await fetch(new URL(href, base + p));
      if (cr.ok) css += "\n<style>" + (await cr.text()) + "</style>"; else { ok = false; console.error(`UNPARSED css ${href} on ${p}: ${cr.status}`); }
    }
    if (ok) pages[p] = t + css;
  }
  const n = Object.keys(pages).length;
  const out = measure(pages);
  console.log(JSON.stringify({ base, parsed: n, of: CORE_PAGES.length, ...out, colors: `${out.colors.length}: ${out.colors.join(" ")}` }, null, 1));
  if (n < CORE_PAGES.length) { console.error(`NO VERDICT: parsed ${n}/${CORE_PAGES.length}`); process.exit(2); }
  if (out.breaches.length) { console.error("RED: " + out.breaches.join("; ")); process.exit(1); }
  console.log("GREEN");
}
