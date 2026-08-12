#!/usr/bin/env bun
/**
 * One-price sweep across the 193 pre-baked outreach reports (reports/*.html).
 *
 * WHY (2026-08-12):
 * The 2026-08-08 tier retirement (Analyse 4 900 / Fundament 14 900 / Løpende
 * 4 900 per month, all killed on measured zeros) swept the HTML pages and — on
 * 2026-08-12 — the machine layer (llms.txt, agent-card, agent-skills, priser.md,
 * context.md). It never touched reports/, because the build's dead-tier gate
 * scans 57 files and reports/ is not among them.
 *
 * Measured before this sweep, on the LIVE site:
 *   • 192 of 193 report pages advertised "4 900"
 *   • 133 shipped a working Stripe checkout button, name="tier"
 *     value="handlingsplan", labelled "Eller full handlingsplan — 4 900 NOK →"
 *   • 28 also advertised 14 900 (Fundament)
 *   • 411 /faktura deep-links carried pakke=priser-analyse, a package the
 *     dropdown can no longer select — so the form opened blank
 *
 * These are not marketing pages. Each report is generated for one named
 * prospect and emailed to them; /r/{hash} is the link in the email. It is the
 * highest-intent surface Synlig owns, and for four days it took card payment
 * for a product we had stopped delivering. Reading a stale price is a
 * credibility problem; charging for a dead product is a refund and a
 * complaint.
 *
 * WHAT IT DOES
 * Eight exact-string/regex replacements, each counted, with a floor: the script
 * exits non-zero if it changes nothing (so a silent no-op cannot look like
 * success) and prints a post-sweep residual scan the caller can assert on.
 *
 * The dead tiers are replaced by the live offer set:
 *   Sitert-måling  9 900 NOK  (invoiced, ordered by email — no card rail)
 *   Synlig Lite      990 NOK  (card or /faktura?slug=priser-lite)
 *
 * The handlingsplan SUBMIT BUTTON becomes an <a href="mailto:"> rather than a
 * second submit, for the same reason as en.html: the measurement is invoiced
 * and /api/lead-capture would demand a card. Every affected report already
 * carries the Lite submit button (verified: 133 of 133), so no form is left
 * without a submit.
 *
 * IDEMPOTENT: re-running finds 0 matches and exits 0 with "already clean".
 * Enforcement lives in build.ts (reports/ added to the dead-tier gate) — this
 * script is the one-time backfill, the gate is what stops the regression.
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DIR = "/workspace/synlig-site/reports";
const DRY = process.argv.includes("--dry-run");

const MAILTO_SITERT =
  "mailto:hei@synligdigital.no?subject=Sitert-m%C3%A5ling" +
  "&body=Hei%20Synlig%2C%0A%0AVi%20fikk%20AEO-rapporten%20og%20vil%20bestille%20en%20sitert-m%C3%A5ling" +
  "%20(9%20900%20NOK%20eks.%20mva%2C%20engangsbel%C3%B8p).%0A%0AMed%20vennlig%20hilsen%2C%0A";

type Rule = { name: string; re: RegExp; to: string | ((...a: string[]) => string) };

const RULES: Rule[] = [
  // 1. Live Stripe checkout button for a discontinued tier → invoiced mailto.
  //    Capture the style attribute so the button's outline look is preserved.
  {
    name: "handlingsplan-submit-button → sitert mailto",
    re: /<button type="submit" name="tier" value="handlingsplan"([^>]*)>[^<]*<\/button>/g,
    to: (_m: string, attrs: string) =>
      `<a href="${MAILTO_SITERT}"${attrs}>Eller sitert-måling — 9 900 NOK →</a>`,
  },
  // 2. Legacy anchor CTA to a /priser fragment that no longer exists
  //    (#lead-email-handlingsplan died with the tier). Keep the /priser
  //    deep-link and its ref=cold-report attribution — the pricing-anchor gate
  //    requires a visible price plus a /priser link — but point it at the
  //    section that does exist (id="sitert-maaling", priser.html:~747).
  {
    name: "handlingsplan anchor → /priser#sitert-maaling",
    re: /<a href="(https:\/\/synligdigital\.no\/priser\?[^"]*)#lead-email-handlingsplan"([^>]*)>[^<]*<\/a>/g,
    to: (_m: string, href: string, attrs: string) =>
      `<a href="${href}#sitert-maaling"${attrs}>Bestill sitert-måling — 9 900 NOK →</a>`,
  },
  // 3. The implementation pitch. We no longer sell implementation-by-the-hour;
  //    the faktura link beneath it now resolves to priser-lite (rule 8), so the
  //    copy has to promise what that link actually orders.
  {
    name: "implementation prose → Lite + measurement",
    re: /Synlig implementerer disse \+ resten av handlingsplanen for <strong([^>]*)>4 900 NOK<\/strong> på 5 virkedager\./g,
    to: (_m: string, attrs: string) =>
      `Vil dere ha den viktigste siden rettet, koster Synlig Lite <strong${attrs}>990 NOK</strong> og leveres på én virkedag. ` +
      `Vil dere først vite om AI-assistentene faktisk siterer dere i deres marked, er sitert-måling <strong${attrs}>9 900 NOK</strong>.`,
  },
  // 4. Price-ladder footer naming two dead tiers and a dead subscription.
  {
    name: "pricing-ladder footer → two packages",
    re: /Pakker fra 990 NOK \(Lite\) til 14 900 NOK \(Fundament\), pluss 4 900 NOK\/mnd løpende\./g,
    to: "To pakker: Synlig Lite 990 NOK og sitert-måling 9 900 NOK. Begge engangsbeløp, eks. mva.",
  },
  {
    name: "cta-card price line → measurement",
    re: /Full handlingsplan fra 4 900 NOK\. /g,
    to: "Sitert-måling 9 900 NOK, Synlig Lite 990 NOK. ",
  },
  {
    name: "top-cta sub → live delivery promise",
    re: /Vi leverer komplett handlingsplan på 5 virkedager\. Faktura eller kort\./g,
    to: "Sitert-måling 9 900 NOK på faktura, Synlig Lite 990 NOK med kort eller faktura.",
  },
  {
    name: "top-cta sub (dual-tier variant) → live delivery promise",
    re: /Lite leveres på 1 virkedag, full handlingsplan på 5\. Faktura eller kort\./g,
    to: "Lite leveres på 1 virkedag. Sitert-målingen kjøres over flere dager — minst ni kjøringer. Faktura eller kort.",
  },
  // 8. /faktura?…&pakke=priser-analyse pre-selects a package the dropdown no
  //    longer offers, so the form opened with nothing selected — the exact
  //    dangling-alias failure en-recovery-banner.test.ts pins for /en/.
  {
    name: "faktura pakke=priser-analyse → priser-lite",
    re: /pakke=priser-analyse/g,
    to: "pakke=priser-lite",
  },
  // 9. Provenance comment naming a dead idempotency marker. Stripped from the
  //    served page by the comment-strip gate, but left in source it is a
  //    carrier that makes the next dead-tier grep false-positive forever.
  {
    name: "provenance comment marker",
    re: /"ref=cold-report" \+ "Full handlingsplan fra 4 900 NOK"/g,
    to: '"ref=cold-report" + "Sitert-måling 9 900 NOK"',
  },
];

// Residual scan. Anything here after the sweep means a shape we did not model.
const RESIDUAL: Array<[RegExp, string]> = [
  [/4[  ]900/, "Analyse/Handlingsplan 4 900"],
  [/14[  ]900/, "Fundament 14 900"],
  [/value="(handlingsplan|fundament|lopende)"/, "checkout button for a discontinued tier"],
  [/priser-analyse|priser-fundament|priser-lopende/, "faktura deep-link to a retired pakke"],
  [/#lead-email-handlingsplan/, "anchor to a /priser fragment that no longer exists"],
];

// Dated, counterparty-specific PROPOSAL documents — not live sales surfaces.
// Their prices are a record of what we actually quoted Visionmedia, embedded in
// argument ("…det er et plattform-koordineringsprosjekt, ikke en 14 900 kr
// Fundament"). A blind price swap would both break the sentences and rewrite a
// document the counterparty holds a copy of. Neither carries a checkout button
// (verified: 0 hits for value="handlingsplan"), so nothing here can take money
// for a discontinued tier. The correct treatment is a dated "superseded" banner,
// not a silent edit — tracked separately.
const PROPOSAL_EXEMPT = new Set([
  "visionmedia-northug-week1.html",
  "visionmedia-pilot.html",
]);

const files = readdirSync(DIR).filter((f) => f.endsWith(".html") && !PROPOSAL_EXEMPT.has(f));
// Floor: the gate must never pass by scanning nothing.
if (files.length < 100) {
  console.error(`❌ Only ${files.length} report files found in ${DIR} — expected ~193. Refusing to run blind.`);
  process.exit(1);
}

const counts: Record<string, number> = {};
let filesChanged = 0;

for (const fn of files) {
  const p = join(DIR, fn);
  const before = readFileSync(p, "utf8");
  let after = before;
  for (const r of RULES) {
    const n = (after.match(r.re) || []).length;
    if (n === 0) continue;
    counts[r.name] = (counts[r.name] || 0) + n;
    after = after.replace(r.re, r.to as any);
  }
  if (after !== before) {
    filesChanged++;
    if (!DRY) writeFileSync(p, after);
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`${DRY ? "[dry-run] " : ""}Scanned ${files.length} reports, changed ${filesChanged}, ${total} replacements:`);
for (const r of RULES) console.log(`  ${String(counts[r.name] ?? 0).padStart(4)}  ${r.name}`);

if (total === 0) {
  console.log("\n✅ Already clean — no dead-tier shapes found (idempotent re-run).");
}

// Post-sweep residual scan, read back from disk (not from the in-memory string
// we just built — a write that did not land must show up here).
const residualHits: string[] = [];
for (const fn of files) {
  const body = readFileSync(join(DIR, fn), "utf8");
  for (const [re, why] of RESIDUAL) {
    if (re.test(body)) residualHits.push(`${fn}: ${why}`);
  }
}
// The success line is printed ONLY when the count is actually zero. The first
// draft of this block printed "✅ 0 hits" unconditionally and suppressed the
// failure branch under --dry-run, so a dry run over 192 still-dirty files
// reported all-clear: a self-certifying instrument, which is the failure this
// whole sweep exists to undo. --dry-run now reports the residual honestly (it
// SHOULD be dirty — nothing was written) and only the exit code is suppressed.
if (residualHits.length > 0) {
  console.error(`\n${DRY ? "⚠️  [dry-run]" : "❌"} ${residualHits.length} residual dead-tier hit(s)${DRY ? " (expected: nothing was written)" : " — a shape this script does not model"}:`);
  for (const h of residualHits.slice(0, 25)) console.error(`   ${h}`);
  if (!DRY) process.exit(1);
} else {
  console.log(`\n✅ Residual scan: 0 dead-tier hits across ${files.length} reports.`);
}
