/**
 * Patch deployed cold-outreach reports to remove the false-positive
 * "robots.txt blokkerer AI-crawlere" claim.
 *
 * Background (verified 2026-05-23):
 *   /workspace/tools/aeo-audit/src/analyzers/ai-signals.ts had a regex-only
 *   check that flagged any robots.txt mentioning an AI bot AND containing
 *   "Disallow:/<anything>" as fully blocking. False-positive on all Squarespace
 *   sites (Disallow: /config/ is a partial path) plus any site where AI bots
 *   are listed but have Allow:/ (e.g. boost.ai).
 *
 *   Verified by curl'ing each prospect's live robots.txt against the new
 *   per-user-agent parser (findBlockedAiBots). 6 of 7 deployed reports
 *   carrying the claim are false positives. The 7th (kampanje.com,
 *   i7bkbc29) is CORRECTLY blocking and is intentionally NOT patched.
 *
 * The bug-fix in ai-signals.ts handles future audits; this script repairs
 * already-deployed reports so prospects don't see a verifiably wrong claim
 * if they curl their own robots.txt.
 *
 * Run: bun /workspace/synlig-site/patch-reports-robots-falsepos.ts
 * Then redeploy via /workspace/synlig-worker/deploy.ts to bake into worker.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const REPORTS_DIR = "/workspace/synlig-site/reports";

// Hashes verified to be false-positives (Squarespace prospects whose
// robots.txt does NOT contain Disallow: / for any AI bot — confirmed via
// `curl` against each domain on 2026-05-23). Excludes i7bkbc29 (kampanje.com)
// which legitimately blocks GPTBot/ClaudeBot/PerplexityBot.
const FALSE_POSITIVES = new Set([
  "1iynsa1q", // familieadvokatene.no
  "5297rkcq", // smalhans.no
  "a5b6c7d8", // barberell.no
  "bryl8n2k", // bryggeloftet.no
  "e1f2a3b4", // nordiclithium.no (paying customer SD-2026-001 — credibility-critical)
  "f5e4d3c2", // nordiclithium.no (duplicate)
]);

// Exact <li> text emitted by the buggy version of ai-signals.ts.
// (The fixed version emits per-bot names; old reports always carry this exact string.)
const FALSE_LI = `<li>robots.txt blokkerer AI-crawlere (GPTBot/ClaudeBot/PerplexityBot) — innholdet er usynlig for de fleste AI-modeller</li>`;

// "N stk" chip from the Problemer-funnet card header. We decrement by 1.
const CHIP_RE = /<div class="score-chip">(\d+) stk<\/div>/;

let patched = 0;
let skipped = 0;
let unchanged = 0;
let counterMissed = 0;

const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith(".html"));
for (const f of files) {
  const hash = f.replace(/\.html$/, "");
  if (!FALSE_POSITIVES.has(hash)) {
    skipped++;
    continue;
  }
  const path = join(REPORTS_DIR, f);
  const before = readFileSync(path, "utf8");
  if (!before.includes(FALSE_LI)) {
    console.log(`  unchanged ${hash}: FALSE_LI string not present (already patched or shape drift)`);
    unchanged++;
    continue;
  }

  let after = before.replace(FALSE_LI, "");

  // Decrement the count chip — the false LI is one of the N issues.
  const chipMatch = after.match(CHIP_RE);
  if (chipMatch) {
    const before_n = Number(chipMatch[1]);
    const new_n = Math.max(0, before_n - 1);
    after = after.replace(CHIP_RE, `<div class="score-chip">${new_n} stk</div>`);
  } else {
    counterMissed++;
    console.warn(`  warn  ${hash}: count chip not found — LI removed but count not decremented`);
  }

  writeFileSync(path, after);
  patched++;
  console.log(`  patched ${hash} → removed false robots-block claim`);
}

console.log(`\nDone. patched=${patched} unchanged=${unchanged} skipped=${skipped} counter-missed=${counterMissed}`);
if (FALSE_POSITIVES.size !== patched + unchanged) {
  console.warn(`\nMismatch: expected to touch ${FALSE_POSITIVES.size} files, found ${patched + unchanged}.`);
  console.warn(`(Some hashes may have been deleted or renamed. Check the FALSE_POSITIVES list.)`);
}
