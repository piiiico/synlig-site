#!/usr/bin/env bun
// BACKFILL-ONLY (as of 2026-05-22 22:xx): the "Full handlingsplan fra 4 900 NOK"
// pricing-anchor line is now baked directly by tools/aeo-audit/src/report-html.ts,
// so newly-generated reports satisfy the deploy.ts pricing-anchor invariant gate
// without this script. This script remains for legacy report files that predate
// the inline bake (idempotent: skips any file already carrying the pricing line).
//
// Patch /workspace/synlig-site/reports/*.html in place: insert pricing-anchor
// paragraph into the .cta-card. Targets reports that already have CTA card +
// btn-secondary "Les mer om AEO →" pattern and lack "Full handlingsplan".
// Leaves alone the 6 alternate-layout reports (cta-box, different structure).
//
// Safety: idempotent (skips already-patched), structural anchor match.

import { readdirSync } from "fs";
import { join } from "path";

const REPORTS_DIR = "/workspace/synlig-site/reports";
const PRICING_LINE = `    <p style="font-size:13px;color:var(--text-muted);margin-top:20px;padding-top:16px;border-top:1px solid rgba(99,102,241,0.2);margin-bottom:0">Full handlingsplan fra 4 900 NOK. <a href="https://synligdigital.no/priser" style="color:var(--indigo-light);text-decoration:underline;font-weight:500">Se priser →</a></p>`;

// Two cta-card anchor patterns to handle template variants:
//   v1 (current, btn + btn-secondary):
//       <a href="..." class="btn-secondary">Les mer om AEO →</a>\n  </div>
//   v2 (older, btn-only, 6 March-era reports for kiropraktor/helse):
//       <a href="mailto:hei@synligdigital.no" class="btn">Ta kontakt</a>\n  </div>
// Insert PRICING_LINE between the last <a> in the cta-card and the closing </div>.
const ANCHOR_RE_V1 = /(<a href="https:\/\/synligdigital\.no" class="btn-secondary">Les mer om AEO →<\/a>)\n(\s*<\/div>)/;
const ANCHOR_RE_V2 = /(<a href="mailto:hei@synligdigital\.no" class="btn">Ta kontakt<\/a>)\n(\s*<\/div>)/;

const dryRun = process.argv.includes("--dry-run");

let patched = 0;
let skippedAlready = 0;
let skippedNoAnchor = 0;
const noAnchor: string[] = [];

for (const fname of readdirSync(REPORTS_DIR).filter(f => f.endsWith(".html"))) {
  const path = join(REPORTS_DIR, fname);
  const html = await Bun.file(path).text();

  if (html.includes("Full handlingsplan fra 4 900 NOK")) {
    skippedAlready++;
    continue;
  }

  let anchor: RegExp | null = null;
  if (ANCHOR_RE_V1.test(html)) anchor = ANCHOR_RE_V1;
  else if (ANCHOR_RE_V2.test(html)) anchor = ANCHOR_RE_V2;
  if (!anchor) {
    skippedNoAnchor++;
    noAnchor.push(fname);
    continue;
  }

  const next = html.replace(anchor, `$1\n${PRICING_LINE}\n$2`);
  if (next === html) {
    skippedNoAnchor++;
    noAnchor.push(fname + " (no-op replace)");
    continue;
  }
  if (!dryRun) {
    await Bun.write(path, next);
  }
  patched++;
}

console.log(`patched=${patched} already=${skippedAlready} no-anchor=${skippedNoAnchor}${dryRun ? " [DRY RUN]" : ""}`);
if (noAnchor.length > 0) {
  console.log("skipped (no anchor):", noAnchor.join(", "));
}
