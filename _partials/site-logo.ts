/**
 * The ONE logo (Vegvisning, 2026-10-28): a blue sign square with a white inset
 * rule carrying «S», wordmark «Synlig». Håkon 10-26: «forskjellige … størrelser
 * på logo». Every page renders this string — Base.astro imports it, build.ts
 * injects it into the static pages — so design-gate.ts reads exactly one variant.
 * Its CSS lives with the tokens (src/styles/global.css `.logo`); LOGO_CSS is the
 * same rule for pages that do not load global.css.
 */
export const LOGO_HTML = `<a href="/" class="logo" aria-label="Synlig — til forsiden"><i aria-hidden="true">S</i>Synlig</a>`;

export const LOGO_CSS =
  `.logo{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:22px;line-height:1;color:var(--color-ink);text-decoration:none}` +
  `.logo i{width:30px;height:30px;border-radius:5px;background:var(--color-brand);box-shadow:inset 0 0 0 2px var(--color-brand),inset 0 0 0 4px var(--color-paper);display:grid;place-items:center;padding-top:3px;color:var(--color-paper);font-style:normal;font-size:17px}`;

/** Shared chrome for the static pages (phase 2, 10-28): reset, ground, nav, footer.
 *  build.ts injects it BEFORE each page's own <style>, so a page rule still wins.
 *  Pages carry only what is theirs. Nav markup: nav > .nav-inner > logo + .nav-links.
 *  .nav-cta::after widens the tap target to 44px without growing the nav (08-14). */
export const CHROME_CSS =
  `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}` +
  `html{-webkit-font-smoothing:antialiased;scroll-padding-top:6rem}` +
  `body{font-family:var(--font-sans);background:var(--color-wash);color:var(--color-ink);line-height:1.6}` +
  `nav{position:sticky;top:0;z-index:100;background:var(--color-wash);border-bottom:1px solid var(--color-line)}` +
  `.nav-inner{max-width:1100px;margin:0 auto;padding:0 24px;height:64px;display:flex;justify-content:space-between;align-items:center;gap:24px}` +
  `.nav-links{list-style:none;display:flex;gap:24px;align-items:center}` +
  `.nav-links a{color:var(--color-muted);text-decoration:none;font-size:.95rem;font-weight:500}` +
  `.nav-links a:hover,.nav-links a[aria-current]{color:var(--color-ink)}` +
  `.nav-links .nav-cta{background:var(--color-ink);color:var(--color-paper);padding:8px 16px;border-radius:5px;position:relative}` +
  `.nav-cta::after{content:"";position:absolute;inset:50% 0 auto;transform:translateY(-50%);height:44px}` +
  `@media(max-width:800px){.nav-links{gap:16px}.nav-links>:not(:last-child){display:none}}` +
  `footer{margin-top:64px;padding:32px 24px;background:var(--color-paper);border-top:1px solid var(--color-line);text-align:center;font-size:.85rem;color:var(--color-muted)}` +
  `footer a{color:var(--color-muted);text-decoration:none}footer a:hover{text-decoration:underline}`;
