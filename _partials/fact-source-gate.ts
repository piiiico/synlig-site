// Fact-source gate — claim-traceability invariant for blog HTML.
//
// History: 2026-05-20 08:16 reflection. Agent drafted /blogg/90-prosent-usynlige-i-ai-sok
// with a fabricated vertical-breakdown table (9 advokater snitt 34, 8 SaaS 47, 7 klinikker 28,
// 6 regnskap 31, 5 e-handel 38, 5 andre 29) — entirely invented from thin air.
// Cross-check against /workspace/money/aeo/report-registry.jsonl revealed actual breakdown
// (5 tannlege snitt 50, 4 advokat 58, 3 kiropraktor 59, 2 fysio 40, 2 e-handel 48;
// overall snitt 54.3 not 32). Caught ONLY because the agent happened to query the registry.
// Quote: "no automated gate intercepts stat-claim-without-source-row."
//
// Motivated reasoning prevented: agent writes a punchy round-number breakdown to fit
// the narrative. The fix is structural enforcement at build time: every numeric claim
// must have a traceable source (Kilde proximity OR external href OR registry row OR
// audit-table data-source OR explicit allow-list comment), otherwise the build fails
// with the offending file + nearest heading + claim string. Bypass is opt-IN (allow-list
// at top of file with explicit reason) per CLAUDE.md execution-path-intervention rule.
//
// CLAUDE.md citation: "1st occurrence → principle/skill text; 2nd occurrence → code gate."
// The principle text ("Verify claims before asserting them") + fact-check skill already
// existed and was NOT enforced. This is the code-gate escalation.

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const PROXIMITY_CHARS = 200;

// Minimum-expected-input floor. Without it an empty (or renamed-away) source
// directory returns 0 files / 0 claims / 0 violations, and the build prints
// "0 unverified" and passes — the gate reads loudest exactly when it has
// stopped reading anything. Added 2026-08-09 during the fase-3 port, which
// moved the source of truth from blogg/ to src/content/blogg/ and made a
// silent mis-point a one-typo failure. 36 posts exist; the set only grows.
const MIN_BLOG_FILES = 10; // prune 2026-10-28: 40 → 10 posts

const REPORT_REGISTRY = "/workspace/money/aeo/report-registry.jsonl";
const FACT_REGISTRY = "/workspace/money/aeo/fact-registry.jsonl";
// (url, number) pairs a fetch has confirmed: {url, number, found, status, fetched_at}.
// Written by tools/verify-source-numbers.ts, never by hand.
export const SOURCE_CACHE = "/workspace/money/aeo/source-number-cache.jsonl";

export type Claim = {
  raw: string;          // original matched text from the HTML
  normalized: string;   // whitespace-stripped, comma->period, lowercased
  pattern: string;      // which CLAIM_PATTERNS rule fired
  position: number;     // byte offset into the cleaned content
  heading: string;      // nearest enclosing h1/h2/h3 text
  acceptedBy: string | null; // ladder rung that certified it; null = violation
};

export type Violation = {
  file: string;
  claim: string;
  pattern: string;
  heading: string;
  snippet: string;
};

export type GateResult = {
  files: number;
  claims: number;
  registryRows: number;
  violations: Violation[];
};

// Numeric-claim regexes (per task spec). Run against the BODY of a blog file
// after <head>, <script>, <style> blocks are stripped. Each pattern is global so
// we iterate every occurrence.
const CLAIM_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Percent: "89,8 %", "16%", "23 %"
  { name: "percent", re: /(\d{1,3}(?:[,.]\d+)?)\s*%/g },
  // Large counts with Norwegian thousands-separator: "107 011", "1 147", "550 976"
  { name: "large-count", re: /\b\d{1,3}(?:[\s ]\d{3})+\b/g },
  // Ratio: "2/8", "138/148"
  { name: "ratio", re: /\b(\d+)\s*\/\s*(\d+)\b/g },
  // Score declaration: "snitt 54", "score 76", "grade 89"
  { name: "score-decl", re: /\b(?:snitt|score|grade)\s+(?:på\s+)?(\d{1,3})\b/gi },
];

// Currency suffix — skip "4 900 NOK", "14 900 kr", "4 900 kr/mnd".
// Looked up immediately after the matched text (≤12 chars).
const CURRENCY_SUFFIX = /^\s*(NOK\b|kr\b|EUR\b|USD\b|øre\b|\$|€)/i;

// Year-shaped tokens we treat as dates not claims (1900-2099).
function isLikelyDate(raw: string): boolean {
  return /\b(19|20)\d{2}\b/.test(raw);
}

// Citation styles accepted within PROXIMITY_CHARS of a claim:
//   - Norwegian "(Kilde: ...)" explicit citation
//   - "(OrgName, 2026)" parenthetical with org name + year (e.g. "(Conductor, 2026)")
//   - "Ifølge OrgName" — Norwegian for "According to"
//   - "egne data|tal|AEO|benchmark|audit|analyse|undersøkelse" own-data annotation
//   - "<h*>Kilder</h*>" sources-section heading
const PROXIMITY_MARKER = new RegExp(
  [
    "\\(Kilde:",
    "\\([A-ZÆØÅ][\\w &./-]{2,40}(?:[,.]?\\s*)(?:19|20)\\d{2}\\)",
    "Ifølge\\s+[A-ZÆØÅ]",
    "\\(egne\\s+\\w",
    "\\begne\\s+(data|tal|AEO|benchmark|audit|analys|undersøkels|tall)\\b",
    "Kilder<\\/h\\d>",
  ].join("|"),
  "i",
);

function normalizeClaim(raw: string): string {
  return raw
    .replace(/[\s ]+/g, "")
    .replace(/,/g, ".")
    .toLowerCase();
}

// Strip noise: <head>, <script>, <style>, and inline style="..." attributes.
// Preserve byte offsets by replacing stripped regions with same-length whitespace.
// Inline style attributes contain CSS values like width:33.3% which are bar-width
// presentation, not factual claims — see stavanger-agent-beredskap-april-2026.html
// where 60+ such inline style percents would otherwise dominate the gate output.
//
// fase 3 (2026-08-09): blog sources are Astro content-collection fragments and
// the visible headline, lead and category chips moved OUT of the body INTO a
// <script type="application/json" id="frontmatter"> block — which the <script>
// rule below blanks. Left alone that silently narrows the gate: measured
// 341 → 321 claims, i.e. 20 numeric claims in headlines and leads would stop
// being checked while the build still printed "0 unverified". A gate that
// shrinks quietly is worse than no gate, so those prose fields are
// re-materialised as ordinary markup before scanning.
//
// Only fields that were VISIBLE IN THE BODY before the port are restored.
// title/description/og* lived in <head>, which this function has always
// blanked; restoring them would widen the gate rather than preserve it.
const FRONTMATTER_RE =
  /<script type="application\/json" id="frontmatter">\s*([\s\S]*?)\s*<\/script>/;
const BODY_PROSE_FIELDS = ["category", "heading", "lead", "breadcrumbLabel"] as const;

function frontmatterProse(html: string): string {
  const m = FRONTMATTER_RE.exec(html);
  if (!m) return "";
  let fm: Record<string, unknown>;
  try {
    fm = JSON.parse(m[1]);
  } catch {
    return "";
  }
  const parts: string[] = [];
  for (const key of BODY_PROSE_FIELDS) {
    const v = fm[key];
    if (typeof v === "string" && v.trim()) {
      parts.push(key === "heading" ? `<h1>${v}</h1>` : `<p>${v}</p>`);
    }
  }
  const chips = fm.metaChips;
  if (Array.isArray(chips)) {
    for (const c of chips) if (typeof c === "string" && c.trim()) parts.push(`<p>${c}</p>`);
  }
  return parts.length ? `<header>${parts.join("")}</header>\n` : "";
}

// A bare external href no longer certifies a claim (2026-10-26, task 6848d378):
// the 10-22 stat trace found claims passing on links to pages that never carry
// the number. An href within PROXIMITY_CHARS passes only when the source cache
// records that page containing the claim's number.
const EXTERNAL_HREF = /href="(https?:\/\/(?!(?:www\.)?synligdigital\.no)[^"]+)"/gi;

// Number keys, format-tolerant: "89,8 %" -> 89.8, "107 011" -> 107011,
// "2/8" -> [2, 8]. A ratio is carried only if BOTH sides are on the page.
export function claimNumbers(raw: string): string[] {
  return (raw.match(/\d[\d\s ]*(?:[.,]\d+)?/g) ?? []).map((t) =>
    t.replace(/[\s ]+/g, "").replace(",", ".").replace(/\.0+$/, ""),
  ).filter(Boolean);
}

// Every reading of every number in a page's text: "107,011" is both 107011
// and 107.011, "25,11" is 25.11, "1 234" is 1234.
export function pageNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.match(/\d{1,3}(?:[,. \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) ?? []) {
    const strip = (s: string) => s.replace(/\.0+$/, "");
    out.add(strip(t.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")));
    out.add(strip(t.replace(/[\s\u00a0\u202f,]/g, "")));
    out.add(strip(t.replace(/[\s\u00a0\u202f.]/g, "").replace(",", ".")));
    out.add(t.replace(/[\s\u00a0\u202f.,]/g, ""));
  }
  return out;
}

export type SourceCache = Map<string, Set<string>>; // url -> numbers confirmed on it

export function loadSourceCache(path = SOURCE_CACHE): SourceCache {
  const cache: SourceCache = new Map();
  let txt = "";
  try { txt = readFileSync(path, "utf8"); } catch { return cache; }
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.found !== true || !r.url || !r.number) continue;
      if (!cache.has(r.url)) cache.set(r.url, new Set());
      cache.get(r.url)!.add(String(r.number));
    } catch { /* malformed row: not a confirmation */ }
  }
  return cache;
}

// External hrefs whose attribute starts within PROXIMITY_CHARS of pos.
export function hrefsNear(urlText: string, pos: number): string[] {
  const out: string[] = [];
  EXTERNAL_HREF.lastIndex = 0;
  for (const m of urlText.matchAll(EXTERNAL_HREF)) {
    if (Math.abs(m.index! - pos) <= PROXIMITY_CHARS) out.push(m[1].replace(/&amp;/g, "&"));
  }
  return out;
}

export function cleanHtml(html: string, keepUrlEscapes = false): string {
  let out = frontmatterProse(html) + html;
  out = out.replace(/<head[\s\S]*?<\/head>/gi, (m) => " ".repeat(m.length));
  out = out.replace(/<script[\s\S]*?<\/script>/gi, (m) => " ".repeat(m.length));
  out = out.replace(/<style[\s\S]*?<\/style>/gi, (m) => " ".repeat(m.length));
  out = out.replace(/\sstyle="[^"]*"/gi, (m) => " ".repeat(m.length));
  // HTML comments are not user-facing — including AUDIT-CTA markers and our own
  // fact-source-allow / fact-source TODO comments which may legitimately quote
  // example claim strings. Strip them so the gate doesn't trip on its own metadata.
  out = out.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  // Blind spot closed 2026-08-09: "61&nbsp;%" is a percent claim, but the raw
  // entity does not match /\d\s*%/, so seven claims in one headline-heavy post
  // were never scanned. Six spaces keeps every byte offset intact and \s* then
  // spans them. Found by the fase-3 port, which decoded entities into the
  // collection frontmatter and made the gate count jump by one.
  out = out.replace(/&nbsp;/g, "      ");
  // Blind spot closed 2026-08-12, opposite direction: percent-ENCODING inside a
  // URL is not a percent CLAIM. Two adjacent encoded characters produce the
  // literal digits-then-% shape the scanner looks for — "…be%20om%20en%20s…"
  // contains "20%", and "(9%20900" contains "9%". Retiring the dead price tiers
  // lengthened the mailto bodies on 33 blog CTAs and manufactured three
  // "unverified claims" out of an href, on a page whose prose was untouched.
  //
  // Scoped to href/src attribute values, not global: the proximity check at
  // PROXIMITY_PATTERNS reads `<a href="https://…">` to decide whether a nearby
  // link is external, so the URL itself must survive. Only the %XX escapes are
  // blanked, length-preserving like every other rule here.
  if (!keepUrlEscapes) out = out.replace(/\s(?:href|src)="[^"]*"/gi, (attr) =>
    attr.replace(/%[0-9A-Fa-f]{2}/g, "   "),
  );
  return out;
}

function isPrice(cleaned: string, endPos: number): boolean {
  const trailing = cleaned.slice(endPos, endPos + 12);
  return CURRENCY_SUFFIX.test(trailing);
}

function nearestHeading(cleaned: string, pos: number): string {
  const upToPos = cleaned.slice(0, pos);
  // Iterate all h1/h2/h3 BEFORE pos; take the last one.
  const matches = [...upToPos.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  if (matches.length === 0) return "(no heading)";
  return matches[matches.length - 1][1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function nearbyHasMarker(cleaned: string, pos: number, marker: RegExp): boolean {
  const window = cleaned.slice(
    Math.max(0, pos - PROXIMITY_CHARS),
    pos + PROXIMITY_CHARS
  );
  return marker.test(window);
}

function extractAllowList(html: string): Set<string> {
  // Top-of-file allow-list comment (per-claim):
  //   <!-- fact-source-allow: ["89,8 %", "107 011"] -->
  // Only honored in the first 1500 bytes (must be top-of-file).
  // The file-wide fact-source-allow-all comment is retired (2026-10-26): it
  // certified a Seer number as "own data" under a leaderboard reason, and a
  // number-in-named-data-file test still passed it (61 is a leaderboard score).
  // Own data is attested per claim, here.
  const top = html.slice(0, 1500);
  const m = top.match(/<!--\s*fact-source-allow:\s*(\[[\s\S]*?\])\s*-->/);
  if (!m) return new Set();
  try {
    const arr = JSON.parse(m[1]);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((s) => normalizeClaim(String(s))));
  } catch {
    return new Set();
  }
}

function inAuditTableWithSource(html: string, pos: number): boolean {
  // Walk back from pos to find the enclosing <table>; pass only if it carries
  // class="audit-table" AND a data-source="..." attribute pointing to a registry.
  const before = html.slice(0, pos);
  const lastOpen = before.lastIndexOf("<table");
  if (lastOpen === -1) return false;
  const between = html.slice(lastOpen, pos);
  if (between.includes("</table>")) return false;
  const tagEnd = html.indexOf(">", lastOpen);
  if (tagEnd === -1) return false;
  const tag = html.slice(lastOpen, tagEnd + 1);
  return /class="[^"]*\baudit-table\b[^"]*"/.test(tag) && /data-source="[^"]+"/.test(tag);
}

export function loadRegistryCorpus(): { corpus: string; rowCount: number } {
  let corpus = "";
  let rows = 0;
  for (const path of [REPORT_REGISTRY, FACT_REGISTRY]) {
    try {
      const txt = readFileSync(path, "utf8");
      corpus += txt + "\n";
      rows += txt.split("\n").filter((l) => l.trim()).length;
    } catch {
      // fact-registry may not exist on first run
    }
  }
  return { corpus, rowCount: rows };
}

export function loadFactRegistry(): Set<string> {
  const out = new Set<string>();
  try {
    const txt = readFileSync(FACT_REGISTRY, "utf8");
    for (const line of txt.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.claim) out.add(normalizeClaim(String(row.claim)));
      } catch {
        /* skip malformed row */
      }
    }
  } catch {
    /* file may not exist on first run */
  }
  return out;
}

export function scanBlog(
  fileName: string,
  html: string,
  registryCorpus: string,
  factSet: Set<string>,
  sourceCache: SourceCache = new Map(),
): { claims: Claim[]; violations: Violation[] } {
  const cleaned = cleanHtml(html);
  const urlText = cleanHtml(html, true); // same offsets, hrefs intact
  if (urlText.length !== cleaned.length) throw new Error(`fact-source gate: offset drift in ${fileName}`);
  const allowList = extractAllowList(html);
  const claims: Claim[] = [];
  const violations: Violation[] = [];
  const seenAt = new Set<string>(); // dedupe per (claim,position)

  for (const { name, re } of CLAIM_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;

      // Skip prices like "4 900 NOK", "14 900 kr/mnd"
      if (isPrice(cleaned, end)) continue;
      // Skip year-shaped tokens
      if (isLikelyDate(raw)) continue;
      // Skip the "24/7" availability idiom (means "around the clock", not a measurement)
      if (raw.replace(/\s/g, "") === "24/7") continue;
      // Skip identifiers: a ≥9-digit number that is the link text of an href
      // carrying the same digits ("936 525 326" -> brreg.no/…/936525326).
      const digits = raw.replace(/\D/g, "");
      if (digits.length >= 9 && hrefsNear(urlText, start).some((u) => u.includes(digits))) continue;

      const key = `${start}:${raw}`;
      if (seenAt.has(key)) continue;
      seenAt.add(key);

      const normalized = normalizeClaim(raw);
      const heading = nearestHeading(cleaned, start);
      const nums = claimNumbers(raw);
      const claim: Claim = { raw, normalized, pattern: name, position: start, heading, acceptedBy: null };
      claims.push(claim);
      const numericOnly = normalized.replace(/[^\d.]/g, "");

      // Acceptance ladder — first rung that fires is recorded.
      claim.acceptedBy =
        // (1) Attribution text within 200 chars (Kilde:, (Org, year), Ifølge, egne data, Kilder).
        nearbyHasMarker(cleaned, start, PROXIMITY_MARKER) ? "marker"
        // (2) A nearby external href whose page the source cache confirms carries the number.
        : hrefsNear(urlText, start).some((u) => nums.length > 0 && nums.every((n) => sourceCache.get(u)?.has(n))) ? "href-verified"
        // (3) Top-of-file per-claim allow-list comment.
        : allowList.has(normalized) ? "allow-list"
        // (4) Fact-registry claim row (exact normalized match against "claim" field).
        : factSet.has(normalized) ? "fact-registry"
        // (5) Number in a registry corpus (≥3 chars, digits form or raw form).
        : (numericOnly.length >= 3 && registryCorpus.includes(numericOnly)) ||
          (raw.trim().length >= 3 && registryCorpus.includes(raw.trim())) ? "registry-corpus"
        // (6) Inside <table class="audit-table" data-source="..."> (own-data table).
        : inAuditTableWithSource(html, start) ? "audit-table"
        : null;
      if (claim.acceptedBy) continue;

      const snippet = cleaned
        .slice(Math.max(0, start - 80), Math.min(cleaned.length, end + 80))
        .replace(/\s+/g, " ")
        .trim();
      violations.push({ file: fileName, claim: raw, pattern: name, heading, snippet });
    }
  }
  return { claims, violations };
}

export type RunMode = "enforce" | "report";

export function runFactSourceGate(
  bloggDir: string,
  mode: RunMode = "enforce",
): GateResult & { all: Array<Claim & { file: string }> } {
  const { corpus, rowCount } = loadRegistryCorpus();
  const factSet = loadFactRegistry();
  const cache = loadSourceCache();
  const files = readdirSync(bloggDir).filter((f) => f.endsWith(".html") && f !== "index.html");
  if (files.length < MIN_BLOG_FILES) {
    throw new Error(
      `fact-source gate: ${bloggDir} yielded ${files.length} scannable HTML files, ` +
        `floor is ${MIN_BLOG_FILES}. Either posts were deleted (lower the floor ` +
        `deliberately) or the gate is pointed at the wrong directory.`,
    );
  }
  const all: Array<Claim & { file: string }> = [];
  const allViolations: Violation[] = [];
  for (const f of files) {
    const { claims, violations } = scanBlog(f, readFileSync(join(bloggDir, f), "utf8"), corpus, factSet, cache);
    all.push(...claims.map((c) => ({ ...c, file: f })));
    allViolations.push(...violations);
  }
  return { files: files.length, claims: all.length, registryRows: rowCount, violations: allViolations, all };
}

// CLI: `bun fact-source-gate.ts [--report]`
// `--report` prints every claim with the ladder rung that certified it.
if (import.meta.main) {
  // fase 3 (2026-08-09): source of truth is the Astro content collection.
  const bloggDir = "/workspace/synlig-site/src/content/blogg";
  const result = runFactSourceGate(bloggDir, "enforce");
  if (process.argv.includes("--report")) {
    console.log(`# format: RUNG\tfile\tpattern\tclaim\theading`);
    for (const c of result.all) console.log(`${c.acceptedBy ?? "UNVERIFIED"}\t${c.file}\t${c.pattern}\t${c.raw}\t${c.heading}`);
    process.exit(0);
  }
  if (result.violations.length === 0) {
    console.log(`fact-source: ${result.claims} claims across ${result.files} blogs, ${result.registryRows} registry rows, 0 unverified`);
    process.exit(0);
  }
  console.error(`\n[BUILD FAIL] fact-source gate: ${result.violations.length} unverified claim(s) in blogg/`);
  for (const v of result.violations) {
    console.error(`  ${v.file} [${v.heading}]: ${v.pattern} "${v.claim}"`);
    console.error(`    ...${v.snippet}...`);
  }
  process.exit(1);
}
