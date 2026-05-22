#!/usr/bin/env bun
// Patch /workspace/synlig-site/reports/*.html in place: upgrade each report's
// CTA from mailto-primary to a green Stripe-direct primary button → /priser
// with #lead-email-handlingsplan anchor (mirrors sjekk-email + sjekk-result
// CTAs landed 2026-05-22 at 13:43).
//
// Why: 90+ static AEO reports are linked from cold-outreach E1/E2/E3/E4 emails
// (synligdigital.no/r/<hash>). Each click on the report's CTA today routes to
// a mailto handler — silent leak vs. the in-page Stripe path that the rest of
// the funnel converts on. Bringing the report CTA to parity unifies conversion
// across email + web + report surfaces.
//
// Safety:
//   - Additive on cta-card variants: prepends green button BEFORE the existing
//     mailto+secondary stack; demotes "📧 Ta kontakt" from .btn → .btn-secondary.
//     Existing fine-print "Full handlingsplan fra 4 900 NOK" line (added by the
//     prior patch-reports-pricing-anchor.ts) is preserved verbatim, so the
//     deploy.ts pricing-anchor invariant gate continues to pass with zero gate
//     changes.
//   - Replacing on cta-box variants: swaps the single mailto-btn for a green
//     button + a small secondary mailto link. cta-box reports are exempt from
//     the pricing-anchor gate (CTA_BOX_EXEMPT list in deploy.ts), so adding a
//     pricing-bearing CTA there is also gate-safe.
//   - Idempotent: skips any report whose CTA already contains
//     "ref=cold-report" (the campaign-attribution marker introduced here).
//
// UTM tagging:
//   ref=cold-report             — funnel source
//   utm_source=cold-report
//   utm_medium=html-report
//   utm_campaign=<hash>         — per-report attribution (priser.html sanitize
//                                 allows 8-char alphanum hash to flow into the
//                                 lead-form slug, so each conversion can be
//                                 traced back to its originating report).

import { readdirSync } from "fs";
import { join } from "path";

const REPORTS_DIR = "/workspace/synlig-site/reports";

// Already-applied marker — any CTA-href containing this string means we've
// patched this file. Used for idempotency.
const APPLIED_MARKER = "ref=cold-report";

// ─────────────────────────────────────────────────────────────────────────────
// cta-card variants. The mailto button has 3 known label shapes across 90 reports:
//   - "📧 Ta kontakt"               (69 reports, subject="AEO-rapport for X")
//   - "📧 Få hjelp med AEO →"        (17 reports, subject="AEO-hjelp for X (score)" + body)
//   - "Ta kontakt"                  (3 reports, no subject, no btn-secondary follower)
// And two follower shapes:
//   - A: followed by <br>\n + <a class="btn-secondary">Les mer om AEO →</a>  (86 reports)
//   - B: followed by no btn-secondary, just whitespace + fine-print pricing   (4 reports)
//
// Patch in two passes: apply pattern A first (more specific, with follower);
// then pattern B for any cta-card report whose mailto-btn is still un-patched.
// Both passes capture the mailto-href + label, demote class="btn" →
// "btn-secondary" so the green Stripe CTA is unambiguously primary.
// ─────────────────────────────────────────────────────────────────────────────
const CTA_CARD_WITH_LES_MER_RE = /(<a href="mailto:hei@synligdigital\.no[^"]*" )class="btn"(>[^<]+<\/a>)<br>\n(\s*)<a href="https:\/\/synligdigital\.no" class="btn-secondary">Les mer om AEO →<\/a>/;
const CTA_CARD_STANDALONE_RE = /(<a href="mailto:hei@synligdigital\.no[^"]*" )class="btn"(>[^<]+<\/a>)/;

function greenBtnHtml(hash: string, extraStyle = ""): string {
  return `<a href="https://synligdigital.no/priser?ref=cold-report&utm_source=cold-report&utm_medium=html-report&utm_campaign=${hash}#lead-email-handlingsplan" style="display:inline-block;background:#22c55e;color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(34,197,94,.3);${extraStyle}">Bestill handlingsplan — 4 900 NOK →</a>`;
}

function ctaCardReplacementWithLesMer(hash: string) {
  return (_match: string, p1: string, p2: string, p3: string): string => {
    return `${greenBtnHtml(hash, "margin-bottom:14px")}<br>\n${p3}${p1}class="btn-secondary"${p2}\n${p3}<a href="https://synligdigital.no" class="btn-secondary">Les mer om AEO →</a>`;
  };
}

function ctaCardReplacementStandalone(hash: string) {
  return (_match: string, p1: string, p2: string): string => {
    return `${greenBtnHtml(hash, "margin-bottom:14px")}<br>\n    ${p1}class="btn-secondary"${p2}`;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// cta-box variant (3 reports — a7b8c9d0, b8c9d0e1, c9d0e1f2). Existing:
//
//   <div class="cta-box">
//     <h2>Klar for å bli synlig?</h2>
//     <p>Vi kan fikse disse problemene for deg. Første samtale er gratis og uforpliktende.</p>
//     <a class="btn" href="mailto:hei@synligdigital.no">Svar på e-posten for en gratis gjennomgang</a>
//   </div>
//
// Replace single mailto-btn with: green primary + small mailto secondary
// (keeps the "svar på e-posten" copy since these reports were sent via email).
// ─────────────────────────────────────────────────────────────────────────────
const CTA_BOX_RE = /<a class="btn" href="mailto:hei@synligdigital\.no">Svar på e-posten for en gratis gjennomgang<\/a>/;

function ctaBoxReplacement(hash: string): string {
  const greenBtn = greenBtnHtml(hash);
  const mailto = `<a class="btn-secondary" style="display:inline-block;margin-top:14px" href="mailto:hei@synligdigital.no">Eller svar på e-posten for en gratis gjennomgang</a>`;
  return `${greenBtn}<br>\n    ${mailto}`;
}

// ─────────────────────────────────────────────────────────────────────────────
const dryRun = process.argv.includes("--dry-run");

let patchedCard = 0;
let patchedBox = 0;
let skippedAlready = 0;
let skippedNoAnchor = 0;
const noAnchor: string[] = [];

for (const fname of readdirSync(REPORTS_DIR).filter(f => f.endsWith(".html"))) {
  const path = join(REPORTS_DIR, fname);
  const hash = fname.replace(".html", "");
  const html = await Bun.file(path).text();

  if (html.includes(APPLIED_MARKER)) {
    skippedAlready++;
    continue;
  }

  let next: string | null = null;
  let kind: "card" | "box" | null = null;

  if (CTA_CARD_WITH_LES_MER_RE.test(html)) {
    next = html.replace(CTA_CARD_WITH_LES_MER_RE, ctaCardReplacementWithLesMer(hash) as any);
    kind = "card";
  } else if (CTA_CARD_STANDALONE_RE.test(html)) {
    next = html.replace(CTA_CARD_STANDALONE_RE, ctaCardReplacementStandalone(hash) as any);
    kind = "card";
  } else if (CTA_BOX_RE.test(html)) {
    next = html.replace(CTA_BOX_RE, ctaBoxReplacement(hash));
    kind = "box";
  }

  if (!next || next === html) {
    skippedNoAnchor++;
    noAnchor.push(fname);
    continue;
  }

  if (!dryRun) {
    await Bun.write(path, next);
  }
  if (kind === "card") patchedCard++;
  else if (kind === "box") patchedBox++;
}

console.log(`patched: cta-card=${patchedCard} cta-box=${patchedBox} | already=${skippedAlready} no-anchor=${skippedNoAnchor}${dryRun ? " [DRY RUN]" : ""}`);
if (noAnchor.length > 0) {
  console.log("skipped (no anchor):", noAnchor.join(", "));
}
