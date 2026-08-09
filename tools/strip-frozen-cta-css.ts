/**
 * The fase-3 migration captured each article's RENDERED inline <style> into the
 * fragment's `css` frontmatter field. At capture time that style already held a
 * copy of the audit-CTA widget's CSS — which build.ts injects fresh on every
 * build from _partials/render-audit-cta.ts.
 *
 * Result: two copies of the same widget CSS on every migrated page, the frozen
 * one last in document order and unlayered, so it wins. Editing the real source
 * changed nothing live (measured 2026-08-09: input height stayed 200px on
 * mobile because `flex: 1 1 200px` + `flex-direction: column` sizes HEIGHT).
 *
 * This strips the frozen copy so render-audit-cta.ts is the single writer again.
 * It removes ONLY rules whose selector names an audit-cta/lead-form class, and
 * drops @media blocks that become empty. Everything else is left byte-identical.
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DIRS = ["/workspace/synlig-site/src/content/blogg", "/workspace/synlig-site/src/content/case"];
const OWNED = /audit-cta|lead-form/;
const apply = process.argv.includes("--apply");

/** Split CSS into top-level chunks (rules and at-blocks), brace-balanced. */
function chunks(css: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  if (css.slice(start).trim()) out.push(css.slice(start));
  return out;
}

function selectorOf(chunk: string): string {
  const i = chunk.indexOf("{");
  return i === -1 ? chunk : chunk.slice(0, i);
}

function stripCss(css: string): string {
  const kept: string[] = [];
  for (const ch of chunks(css)) {
    const sel = selectorOf(ch).trim();
    if (sel.startsWith("@media") || sel.startsWith("@supports")) {
      const open = ch.indexOf("{");
      const inner = ch.slice(open + 1, ch.lastIndexOf("}"));
      const innerKept = chunks(inner).filter((r) => !OWNED.test(selectorOf(r)));
      const body = innerKept.join("").trim();
      if (body) kept.push(`${sel}{\n${body}\n}`);
      continue;
    }
    if (OWNED.test(sel)) continue;
    kept.push(ch);
  }
  return kept.join("").trim();
}

let touched = 0, totalRemoved = 0, scanned = 0;
for (const dir of DIRS) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const path = join(dir, file);
    const src = readFileSync(path, "utf8");
    const m = src.match(/(<script type="application\/json" id="frontmatter">\s*)([\s\S]*?)(\s*<\/script>)/);
    if (!m) throw new Error(`${path}: no frontmatter block`);
    scanned++;
    const fm = JSON.parse(m[2]);
    if (typeof fm.css !== "string" || !OWNED.test(fm.css)) continue;
    const before = fm.css.length;
    fm.css = stripCss(fm.css);
    const removed = before - fm.css.length;
    if (removed <= 0) continue;
    touched++;
    totalRemoved += removed;
    console.log(`${removed.toString().padStart(5)} B  ${file}${fm.css.length === 0 ? "  (css now empty)" : ""}`);
    if (apply) {
      const rebuilt = src.slice(0, src.indexOf(m[0])) + m[1] + JSON.stringify(fm, null, 2) + m[3] +
        src.slice(src.indexOf(m[0]) + m[0].length);
      writeFileSync(path, rebuilt);
    }
  }
}

// Minimum-expected-input floor: an empty/mis-pointed dir would report a clean 0.
if (scanned < 39) {
  console.log(`FLOOR BREACH: scanned only ${scanned} fragments — not a measurement.`);
  process.exit(1);
}
console.log(`\n${apply ? "APPLIED" : "DRY RUN"}: ${touched}/${scanned} fragments, ${totalRemoved} B of frozen widget CSS removed.`);
if (touched === 0) console.log("Nothing to do — frozen copies already gone.");
