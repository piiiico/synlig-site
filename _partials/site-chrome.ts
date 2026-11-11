/**
 * THE site chrome as one <style> string (Vegvisning, 2026-10-28): Overpass
 * faces, the tokens parsed from src/styles/global.css @theme, CHROME_CSS and
 * LOGO_CSS. build.ts injects it into the static pages; tools/aeo-audit's
 * report-html.ts puts it in every generated report. global.css is a text
 * import so the worker bundle carries the same token file the build reads —
 * no copy to drift. Astro does not import this file (it loads global.css itself).
 */
import theme from "../src/styles/global.css" with { type: "text" };
import { CHROME_CSS, LOGO_CSS } from "./site-logo";

const vars = [...(theme.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? "").matchAll(/(--(?:color|font)-[a-z-]+):\s*([^;]+);/g)].map((m) => `${m[1]}:${m[2].trim()}`);
if (vars.length < 10) throw new Error(`site chrome: ${vars.length} tokens parsed from global.css @theme (floor 10)`);
export const TOKEN_COUNT = vars.length;

// U+B7 excluded: Overpass marks «·» as a combining mark (GDEF class 3) → zero advance, «Guide ·AEO».
const faces = [400, 700, 800].map((w) => `@font-face{font-family:"Overpass";src:url("/fonts/overpass/overpass-${w}.woff2") format("woff2");font-weight:${w === 700 ? "500 700" : w};font-display:swap;unicode-range:U+0-B6,U+B8-10FFFF}`).join("");

export const SITE_CHROME_STYLE = `<style>${faces}:root{${vars.join(";")}}${CHROME_CSS}${LOGO_CSS}</style>`;
