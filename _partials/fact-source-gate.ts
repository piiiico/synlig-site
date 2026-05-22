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

const REPORT_REGISTRY = "/workspace/money/aeo/report-registry.jsonl";
const FACT_REGISTRY = "/workspace/money/aeo/fact-registry.jsonl";

export type Claim = {
  raw: string;          // original matched text from the HTML
  normalized: string;   // whitespace-stripped, comma->period, lowercased
  pattern: string;      // which CLAIM_PATTERNS rule fired
  position: number;     // byte offset into the cleaned content
  heading: string;      // nearest enclosing h1/h2/h3 text
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
//   - External <a href="https://..."> link (not pointing back to synligdigital.no)
//   - "(OrgName, 2026)" parenthetical with org name + year (e.g. "(Conductor, 2026)")
//   - "Ifølge OrgName" — Norwegian for "According to"
//   - "egne data|tal|AEO|benchmark|audit|analyse|undersøkelse" own-data annotation
//   - "<h*>Kilder</h*>" sources-section heading
const PROXIMITY_MARKER = new RegExp(
  [
    "\\(Kilde:",
    "<a\\s+href=\"https?:\\/\\/(?!(?:www\\.)?synligdigital\\.no)",
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
function cleanHtml(html: string): string {
  let out = html;
  out = out.replace(/<head[\s\S]*?<\/head>/gi, (m) => " ".repeat(m.length));
  out = out.replace(/<script[\s\S]*?<\/script>/gi, (m) => " ".repeat(m.length));
  out = out.replace(/<style[\s\S]*?<\/style>/gi, (m) => " ".repeat(m.length));
  out = out.replace(/\sstyle="[^"]*"/gi, (m) => " ".repeat(m.length));
  // HTML comments are not user-facing — including AUDIT-CTA markers and our own
  // fact-source-allow / fact-source TODO comments which may legitimately quote
  // example claim strings. Strip them so the gate doesn't trip on its own metadata.
  out = out.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
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

function extractAllowAll(html: string): string | null {
  // Top-of-file file-wide allow comment, used when every numeric claim in a file
  // is own-data from a single named source (own benchmark JSONL, own audit registry).
  // The string after the colon is the REQUIRED non-empty reason — forces the author
  // to name the source. Without a reason the gate ignores the comment.
  //
  // Example:
  //   <!-- fact-source-allow-all: "Own benchmark of 30 Stavanger SMEs (April 2026 scanner run); raw data in /workspace/money/aeo/audits/" -->
  const top = html.slice(0, 1500);
  const m = top.match(/<!--\s*fact-source-allow-all:\s*"([^"]{20,})"\s*-->/);
  return m ? m[1] : null;
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
): { claims: Claim[]; violations: Violation[] } {
  const cleaned = cleanHtml(html);
  const allowList = extractAllowList(html);
  const allowAllReason = extractAllowAll(html);
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

      const key = `${start}:${raw}`;
      if (seenAt.has(key)) continue;
      seenAt.add(key);

      const normalized = normalizeClaim(raw);
      const heading = nearestHeading(cleaned, start);
      claims.push({ raw, normalized, pattern: name, position: start, heading });

      // Acceptance ladder — pass if any rule fires.

      // (0) File-wide allow-all comment with documented source/reason.
      if (allowAllReason !== null) continue;
      // (1) Proximity marker within 200 chars (Kilde:, external href, egne data, Kilder section).
      if (nearbyHasMarker(cleaned, start, PROXIMITY_MARKER)) continue;
      // (2) Top-of-file allow-list comment.
      if (allowList.has(normalized)) continue;
      // (3) Fact-registry claim row (exact normalized match against "claim" field).
      if (factSet.has(normalized)) continue;
      // (4) Numeric token appears in either registry corpus (substring match).
      //     Use the digits+decimal form (e.g. "89.8") — minimum 3 chars to avoid
      //     trivial small-number false positives.
      const numericOnly = normalized.replace(/[^\d.]/g, "");
      if (numericOnly.length >= 3 && registryCorpus.includes(numericOnly)) continue;
      // Also match the raw form for cases like "89,8" or "107 011" appearing
      // literally in a registry row.
      if (raw.trim().length >= 3 && registryCorpus.includes(raw.trim())) continue;
      // (5) Inside <table class="audit-table" data-source="..."> (own-data table).
      if (inAuditTableWithSource(html, start)) continue;

      // No acceptance rule fired — this is an unverified claim.
      const snippet = cleaned
        .slice(Math.max(0, start - 80), Math.min(cleaned.length, end + 80))
        .replace(/\s+/g, " ")
        .trim();
      violations.push({
        file: fileName,
        claim: raw,
        pattern: name,
        heading,
        snippet,
      });
    }
  }
  return { claims, violations };
}

export type RunMode = "enforce" | "report";

export function runFactSourceGate(bloggDir: string, mode: RunMode = "enforce"): GateResult {
  const { corpus, rowCount } = loadRegistryCorpus();
  const factSet = loadFactRegistry();
  const files = readdirSync(bloggDir).filter((f) => f.endsWith(".html") && f !== "index.html");
  let claimCount = 0;
  const allViolations: Violation[] = [];
  for (const f of files) {
    const full = join(bloggDir, f);
    const html = readFileSync(full, "utf8");
    const { claims, violations } = scanBlog(f, html, corpus, factSet);
    claimCount += claims.length;
    allViolations.push(...violations);
  }
  return { files: files.length, claims: claimCount, registryRows: rowCount, violations: allViolations };
}

// CLI: `bun fact-source-gate.ts [--report]`
// `--report` prints all extracted claims (not just violations) for seeding the registry.
if (import.meta.main) {
  const bloggDir = "/workspace/synlig-site/blogg";
  const reportMode = process.argv.includes("--report");
  if (reportMode) {
    // Report mode: dump every extracted claim with file, heading, snippet, acceptance status.
    const { corpus, rowCount } = loadRegistryCorpus();
    const factSet = loadFactRegistry();
    const files = readdirSync(bloggDir).filter((f) => f.endsWith(".html") && f !== "index.html");
    console.log(`# fact-source-gate REPORT mode`);
    console.log(`# blogs: ${files.length}, registry rows: ${rowCount}`);
    console.log(`# format: STATUS\tfile\tpattern\tclaim\theading`);
    for (const f of files) {
      const full = join(bloggDir, f);
      const html = readFileSync(full, "utf8");
      const { claims, violations } = scanBlog(f, html, corpus, factSet);
      // Index violations by snippet (unique per position) so that two claims with
      // identical (file, pattern, claim, heading) but different surrounding context
      // get classified independently — otherwise an FAQ question + answer that share
      // a heading collapse to a single key and both show UNVERIFIED.
      const violationSnippets = new Set(violations.map((v) => v.snippet));
      for (const c of claims) {
        // Recompute snippet identically to scanBlog so the lookup matches.
        // (We do not strip styles here because cleanHtml was applied inside scanBlog;
        // we just compute a position-aware key from the heading + first 40 chars
        // of the raw text. This is good enough for human-readable reports.)
        // Simpler approach: mark UNVERIFIED if any violation has the same heading
        // AND the same exact claim AND any unmatched violation remains. Fall back
        // by popping from a Map of (key -> remaining violation count).
        // Use a per-position counter instead.
      }
      // Position-aware mapping: rebuild violation map keyed by (claim, position).
      const violationPositions = new Set<string>();
      for (const v of violations) violationPositions.add(`${v.file}\t${v.pattern}\t${v.claim}\t${v.snippet}`);
      for (const c of claims) {
        // Recompute the snippet identical to scanBlog's logic so we can do a
        // position-accurate lookup.
        const cleaned = html
          .replace(/<head[\s\S]*?<\/head>/gi, (m) => " ".repeat(m.length))
          .replace(/<script[\s\S]*?<\/script>/gi, (m) => " ".repeat(m.length))
          .replace(/<style[\s\S]*?<\/style>/gi, (m) => " ".repeat(m.length))
          .replace(/\sstyle="[^"]*"/gi, (m) => " ".repeat(m.length));
        const snippet = cleaned
          .slice(Math.max(0, c.position - 80), Math.min(cleaned.length, c.position + c.raw.length + 80))
          .replace(/\s+/g, " ")
          .trim();
        const k = `${f}\t${c.pattern}\t${c.raw}\t${snippet}`;
        const status = violationPositions.has(k) ? "UNVERIFIED" : "OK";
        console.log(`${status}\t${f}\t${c.pattern}\t${c.raw}\t${c.heading}`);
      }
    }
    process.exit(0);
  }
  const result = runFactSourceGate(bloggDir, "enforce");
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
