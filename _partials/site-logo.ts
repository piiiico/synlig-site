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
