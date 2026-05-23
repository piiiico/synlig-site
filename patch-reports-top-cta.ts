#!/usr/bin/env bun
// BACKFILL ONLY: injects the peak-attention top-cta block (right after the
// hero score) into pre-rendered cold-outreach reports that predate commit
// 50a46d5 (2026-05-23). New reports from report-html.ts already include it.
//
// Why: E2/E4 follow-up batches fire next week. Prospects click /r/<hash>
// links from the original cold email. Without this patch they see the legacy
// layout (CTA buried below the recommendations wall). The top-cta is the
// first thing a skim-reader sees after the hero score.
//
// What it does per file:
//   1. CSS: inserts .top-cta / .top-cta-headline / .top-cta-sub /
//      .top-cta-secondary rules after the .hero-text p rule.
//   2. HTML: inserts <div class="top-cta"> block between the hero closing
//      </div> and the <!-- COMPONENT SCORES --> comment.
//   3. Green CTA: REUSES the priser href from the existing bottom green button
//      (preserves per-report utm_campaign hash and attribution chain).
//   4. Mailto: REUSES the mailto href from the bottom btn-secondary link.
//   5. Headline: counts <li class="pri-high" occurrences, uses score framing
//      as fallback if zero.
//
// Idempotent: skips any file already containing class="top-cta".

import { readdirSync } from "fs";
import { join } from "path";

const REPORTS_DIR = "/workspace/synlig-site/reports";
const APPLIED_MARKER = 'class="top-cta"';

// ── CSS to inject ────────────────────────────────────────────────────────────
const CSS_ANCHOR = "  .hero-text p { color: var(--text-muted); font-size: 14px; max-width: 500px; }";
const CSS_INJECTION = `
  /* Top CTA — peak-attention conversion surface, positioned right after hero
     so skim-readers see the next-step before the wall of recommendations. */
  .top-cta {
    background: linear-gradient(135deg, #1e3a8a 0%, #312e81 100%);
    border: 1px solid var(--indigo);
    border-radius: 12px;
    padding: 22px 24px;
    margin-bottom: 24px;
    text-align: center;
  }
  .top-cta-headline { font-size: 17px; font-weight: 700; margin-bottom: 6px; color: var(--text); }
  .top-cta-sub { font-size: 14px; color: var(--text-muted); margin-bottom: 16px; }
  .top-cta-secondary {
    display: inline-block;
    color: var(--indigo-light);
    font-size: 13px;
    text-decoration: underline;
    margin-top: 2px;
  }`;

// ── HTML patterns ─────────────────────────────────────────────────────────────
// Injection point: the hero closes with two </div>s, a blank line, then the COMPONENT SCORES comment.
// We match the specific blank-line + comment sequence to insert our block before it.
const HTML_INJECTION_ANCHOR = "\n\n  <!-- COMPONENT SCORES -->";

// Extract green button href from bottom CTA (anchor variant, all current reports)
const GREEN_HREF_RE = /<a href="(https:\/\/synligdigital\.no\/priser\?ref=cold-report[^"]+)"[^>]*>Bestill handlingsplan/;

// Extract mailto href from bottom btn-secondary (the mailto, not the "Les mer" link)
const MAILTO_HREF_RE = /<a href="(mailto:hei@synligdigital\.no[^"]*)"[^>]*class="btn-secondary"|<a[^>]*class="btn-secondary"[^>]*href="(mailto:hei@synligdigital\.no[^"]*)"/;

// ── score extraction for fallback headline ────────────────────────────────────
const SCORE_RE = /(\d+)\/100 \(([A-F][+-]?)\)/;

// ── main loop ─────────────────────────────────────────────────────────────────
const dryRun = process.argv.includes("--dry-run");

let patched = 0;
let skippedAlready = 0;
let skippedNoAnchor = 0;
const noAnchor: string[] = [];

for (const fname of readdirSync(REPORTS_DIR).filter(f => f.endsWith(".html"))) {
  const path = join(REPORTS_DIR, fname);
  const html = await Bun.file(path).text();

  if (html.includes(APPLIED_MARKER)) {
    skippedAlready++;
    continue;
  }

  // Extract green CTA href
  const greenMatch = GREEN_HREF_RE.exec(html);
  if (!greenMatch) {
    skippedNoAnchor++;
    noAnchor.push(fname);
    continue;
  }
  const greenHref = greenMatch[1];

  // Extract mailto href (btn-secondary in bottom cta-card)
  const mailtoMatch = MAILTO_HREF_RE.exec(html);
  const mailtoHref = mailtoMatch ? (mailtoMatch[1] || mailtoMatch[2]) : "mailto:hei@synligdigital.no";

  // Count high-priority recommendations
  const highCount = (html.match(/<li class="pri-high"/g) || []).length;

  // Headline
  const scoreMatch = SCORE_RE.exec(html);
  const scoreText = scoreMatch ? `${scoreMatch[1]}/100` : "";
  const headline = highCount > 0
    ? `${highCount} høy-prioritets tiltak gjenstår`
    : scoreText
      ? `${scoreText} — grunnlaget er på plass, men du kan løfte deg`
      : "Øk AI-synligheten din — vi leverer handlingsplan på 5 virkedager";

  // Build top-cta HTML block
  const topCtaHtml = `\n\n  <!-- TOP CTA — primary conversion surface at peak attention right after the
       hero. Mirrors the bottom .cta-card action so skim-readers who never
       reach the recommendations wall still see the next step. -->
  <div class="top-cta">
    <div class="top-cta-headline">${headline}</div>
    <div class="top-cta-sub">Vi leverer komplett handlingsplan på 5 virkedager. Faktura eller kort.</div>
    <a href="${greenHref}" style="display:inline-block;background:#22c55e;color:white;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(34,197,94,.3);margin-bottom:14px;border:0;cursor:pointer">Bestill handlingsplan — 4 900 NOK →</a><br>
    <a href="${mailtoHref}" class="top-cta-secondary">eller ta en uforpliktende prat →</a>
  </div>`;

  // 1. Inject CSS
  if (!html.includes(CSS_ANCHOR)) {
    skippedNoAnchor++;
    noAnchor.push(fname + " (no css anchor)");
    continue;
  }
  let next = html.replace(CSS_ANCHOR, CSS_ANCHOR + CSS_INJECTION);

  // 2. Inject HTML before <!-- COMPONENT SCORES -->
  if (!next.includes(HTML_INJECTION_ANCHOR)) {
    skippedNoAnchor++;
    noAnchor.push(fname + " (no html anchor)");
    continue;
  }
  next = next.replace(HTML_INJECTION_ANCHOR, topCtaHtml + HTML_INJECTION_ANCHOR);

  if (next === html) {
    skippedNoAnchor++;
    noAnchor.push(fname + " (no change)");
    continue;
  }

  if (!dryRun) {
    await Bun.write(path, next);
  }
  patched++;
}

console.log(`patched=${patched} | already=${skippedAlready} no-anchor=${skippedNoAnchor}${dryRun ? " [DRY RUN]" : ""}`);
if (noAnchor.length > 0) {
  console.log("skipped:", noAnchor.join(", "));
}
