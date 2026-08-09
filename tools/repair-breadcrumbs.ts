/**
 * ONE-SHOT REPAIR of two breadcrumb defects the fase-3 port shipped into
 * src/content/. Kept in the repo as the record, like migrate-to-collections.ts.
 *
 * Found by criterion (f) of the port task — reading a migrated page as an
 * IMAGE rather than as HTML. Both defects are invisible to every gate that was
 * green at the time (tests, fact-source, sitemap, JSON-LD parity) because both
 * produce perfectly valid markup.
 *
 *  1. DUPLICATE TRAIL. migrate-to-collections.ts stripped the page's own
 *     breadcrumb only when it was spelled <nav class="breadcrumb">. Sixteen of
 *     the 36 posts spell it <div class="breadcrumb">, so those kept their trail
 *     in the body while Article.astro rendered a second one above it. Two
 *     breadcrumbs, stacked, on every one of those pages.
 *
 *  2. SLUG-CASED LABEL. When no trail was found the label fell back to the
 *     slug: "Google search profiles 61 prosent ctr fall", "Aeo byra norge",
 *     "Chatgpt konverterer 9x". For the 16 above the page had said the real
 *     label all along ("Google", "Analyse", "Lite-pakken"). Where there is
 *     genuinely no trail, the editorial card title is used — real curated text
 *     beats a mangled slug. mcp-security-march-2026 had the mirror-image bug:
 *     its separators are &rsaquo; entities, which the glyph-only split missed,
 *     so its whole trail became the label ("Home &rsaquo; Blog &rsaquo; …").
 *
 * Run:  cd /workspace/synlig-site && bun tools/repair-breadcrumbs.ts [--dry]
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DRY = process.argv.includes("--dry");
const DIRS = ["src/content/blogg", "src/content/case"];
const FM_RE = /(<script type="application\/json" id="frontmatter">\s*)([\s\S]*?)(\s*<\/script>)/;

/** Same shape migrate-to-collections.ts used as its last-resort label. */
function slugCase(slug: string): string {
  return slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:rsaquo|raquo|gt|rarr);/g, "›")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Last crumb of a trail. Splitting the flattened text on separator GLYPHS is
 * wrong: "Hjem / Blogg / Google I/O 2026" splits inside the label and yields
 * "O 2026". The separators are their own elements, so take whatever follows
 * the last one and only fall back to glyph-splitting (never on "/") when the
 * trail is plain text.
 */
function lastCrumb(inner: string): string {
  const lastTag = Math.max(inner.lastIndexOf("</span>"), inner.lastIndexOf("</a>"));
  if (lastTag !== -1) {
    const tail = textOf(inner.slice(lastTag));
    if (tail) return tail;
  }
  return textOf(inner).split(/[›»]/).pop()?.trim() ?? "";
}

let stripped = 0, relabelled = 0, files = 0;
const table: string[] = [];

for (const dir of DIRS) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html")).sort()) {
    const path = join(dir, file);
    const src = readFileSync(path, "utf8");
    const slug = file.replace(/\.html$/, "");

    const fm = src.match(FM_RE);
    if (!fm) throw new Error(`${path}: no frontmatter block`);
    const data = JSON.parse(fm[2]) as Record<string, unknown>;
    const before = String(data.breadcrumbLabel ?? "");

    // ── 1. strip the page's own trail out of the body ──────────────────────
    let body = src.slice(src.indexOf(fm[0]) + fm[0].length);
    const head = src.slice(0, src.indexOf(fm[0]) + fm[0].length);
    let ownLabel = "";
    const open = body.search(/<div[^>]*class=["'][^"']*breadcrumb[^"']*["'][^>]*>/i);
    if (open !== -1) {
      const tagEnd = body.indexOf(">", open) + 1;
      const close = body.indexOf("</div>", tagEnd);
      if (close === -1) throw new Error(`${path}: unterminated breadcrumb div`);
      const inner = body.slice(tagEnd, close);
      // Balanced-nesting guard: these trails are flat (<a>/<span> only). If one
      // ever nests a <div>, indexOf would cut the element in half and silently
      // corrupt the page — fail instead.
      if (/<div\b/i.test(inner)) throw new Error(`${path}: nested <div> inside breadcrumb — hand-check`);
      ownLabel = lastCrumb(inner);
      body = body.slice(0, open) + body.slice(close + "</div>".length);
      stripped++;
    }

    // ── 2. repair the label ────────────────────────────────────────────────
    // Precedence: the page's own trail, then the editorial card title, then
    // whatever is already there. A slug-cased label counts as absent.
    // A single-word slug's "slug case" is just the word capitalised, which is
    // frequently the correct label — "pierstop" → "Pierstop" is the curated
    // case label, not a mangling. Only multi-word slugs can be slug-cased.
    const isSlugCased = slug.includes("-") && before === slugCase(slug);
    const trailish = textOf(before);
    const looksLikeWholeTrail = /[›»]/.test(trailish);
    let after = before;
    if (ownLabel) after = ownLabel;
    else if (looksLikeWholeTrail) {
      // The label swallowed the whole trail (entity separators the port's
      // glyph-only split missed). Its own last segment is the real label.
      after = trailish.split(/[›»]/).pop()?.trim() || String(data.cardTitle ?? before);
    } else if (isSlugCased) after = String(data.cardTitle ?? before);

    if (after !== before) {
      data.breadcrumbLabel = after;
      relabelled++;
      table.push(`  ${slug.padEnd(46)} ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    }

    const out = head.replace(FM_RE, (_m, a, _json, c) => `${a}${JSON.stringify(data, null, 2)}${c}`) + body;
    if (!DRY && out !== src) writeFileSync(path, out);
    files++;
  }
}

if (files < 39) throw new Error(`only ${files} fragments seen — wrong directory, not a clean run`);
console.log(`\n${files} fragments scanned`);
console.log(`duplicate <div class="breadcrumb"> trails removed from body: ${stripped}`);
console.log(`breadcrumb labels repaired: ${relabelled}`);
for (const t of table) console.log(t);
