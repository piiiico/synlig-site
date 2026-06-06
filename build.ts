// Reads static files from /workspace/synlig-site/ and generates
// /workspace/synlig-worker/worker.ts with embedded content.
// Also loads AEO reports from /workspace/synlig-site/reports/ for /r/{hash} routing.
//
// CANONICAL SOURCE for /workspace/synlig-worker/worker.ts. Single-writer
// invariant enforced below ("DUPLICATE-WRITER GUARD"). If you need to add
// a route, edit this file — do NOT create a second build script.

import { readdirSync, readFileSync, statSync } from "fs";
import { join, basename, resolve } from "path";
import { applyMarkers, MID_MARKER, BOTTOM_MARKER, LEAD_CAPTURE_PATH, CHECKOUT_HREF_PREFIX, MAILTO_PREFIX, type Stage } from "./_partials/render-audit-cta";
import { runFactSourceGate } from "./_partials/fact-source-gate";

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE-WRITER GUARD — single-writer invariant for synlig-worker/worker.ts
//
// History: 2026-05-20. Two build scripts (this file, and the now-deleted
// /workspace/bin/build-synlig-worker.ts) both emitted worker.ts. Predecessor
// wired handleFundamentCheckout/handleLopendeCheckout into the bin/ script only;
// next run of THIS script regenerated worker.ts WITHOUT those handlers, and
// /api/fundament-checkout + /api/lopende-checkout went 404 in production for
// ~2h until dogfood at 05:32 caught it. The structural fix is single-writer,
// guarded at build time.
//
// Scan bounded dirs for any .ts/.js that both references the output path AND
// invokes a write verb. Itself is excluded. Anything else = abort.
//
// Scope is intentionally small (bin/, synlig-site/, synlig-worker/, tools/,
// scripts/) so the guard stays fast (<100ms) and runs every build. If the
// build adds a new candidate dir for build scripts, add it to SCAN_ROOTS.
// ─────────────────────────────────────────────────────────────────────────────
{
  const SELF = resolve(import.meta.path ?? "/workspace/synlig-site/build.ts");
  const TARGET = "synlig-worker/worker.ts";
  const SCAN_ROOTS = [
    "/workspace/bin",
    "/workspace/synlig-site",
    "/workspace/synlig-worker",
    "/workspace/tools",
    "/workspace/scripts",
  ];
  // Write verbs that would create worker.ts. Bun.write / writeFileSync are the
  // common cases; this catches both.
  const WRITE_VERB = /Bun\.write\s*\(|writeFileSync\s*\(|fs\.writeFile\s*\(/;

  function walk(dir: string, acc: string[]): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      // Skip generated bundles, node_modules, .git, dist/ — they may contain
      // the target string as data, not as a writer.
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full, acc);
      } else if (st.isFile() && (full.endsWith(".ts") || full.endsWith(".js"))) {
        // Skip generated worker.ts/worker.js themselves — they contain the path
        // string as a self-reference comment, not as a writer.
        if (full === "/workspace/synlig-worker/worker.ts") continue;
        if (full === "/workspace/synlig-worker/worker.js") continue;
        acc.push(full);
      }
    }
  }
  const candidates: string[] = [];
  for (const r of SCAN_ROOTS) walk(r, candidates);

  const offenders: string[] = [];
  for (const f of candidates) {
    if (resolve(f) === SELF) continue;
    let src: string;
    try { src = require("fs").readFileSync(f, "utf8"); } catch { continue; }
    if (src.includes(TARGET) && WRITE_VERB.test(src)) {
      offenders.push(f);
    }
  }
  if (offenders.length > 0) {
    console.error(`\n[BUILD FAIL] DUPLICATE-WRITER GUARD: another file writes to ${TARGET}.`);
    console.error(`Single-writer invariant violated. Canonical writer: ${SELF}`);
    console.error(`Offending file(s):`);
    for (const o of offenders) console.error(`  - ${o}`);
    console.error(`\nFix: delete the offender, OR rename its target path. This file is`);
    console.error(`the canonical generator — add routes here, not in a parallel script.`);
    console.error(`History: 2026-05-20 — duplicate writer caused /api/fundament-checkout`);
    console.error(`and /api/lopende-checkout 404s in production for ~2h.`);
    process.exit(1);
  }
}

// Stage classification: slug -> awareness | consideration | decision.
// Drives audit-cta rendering (decision posts get pricing-first; others get audit-first
// with pricing as secondary). Maintained in _partials/blog-stages.json.
const stagesDoc = await Bun.file("/workspace/synlig-site/_partials/blog-stages.json").json();
const STAGES: Record<string, Stage> = stagesDoc.stages;

// applyBlogCta: load a blog post from disk, replace AUDIT-CTA markers with
// rendered partial HTML (stage-aware). Fails the build if markers are missing
// or stage is unmapped.
async function applyBlogCta(absPath: string): Promise<string> {
  const fname = basename(absPath);
  const slug = fname.replace(/\.html$/, "");
  const raw = await Bun.file(absPath).text();
  // index.html has no CTA; pass through.
  if (fname === "index.html") return raw;

  const stage = STAGES[slug];
  if (!stage) {
    console.error(`\n[BUILD FAIL] No stage classified for blog post slug "${slug}".`);
    console.error(`Add it to /workspace/synlig-site/_partials/blog-stages.json under "stages".`);
    process.exit(1);
  }
  const { html, errors } = applyMarkers(slug, raw, stage);
  if (errors.length > 0) {
    console.error(`\n[BUILD FAIL] audit-cta markers invalid in blogg/${fname}:`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\nEvery blog post must contain exactly one ${MID_MARKER} and one ${BOTTOM_MARKER}.`);
    console.error(`Source: /workspace/synlig-site/_partials/render-audit-cta.ts`);
    process.exit(1);
  }
  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERTICAL_LANDINGS registry — single source of truth for /tjenester/* pages.
// Adding a 4th vertical requires exactly ONE edit: a new entry here.
// All 5 wiring places (file load, const decl, routes ×3, sitemap assertion)
// are auto-derived. Root cause: 2026-05-20 CF 10021 on aeo-for-tannleger —
// const decl was the silent 5th place, caught only by post-deploy live-route gate.
//
// `deprecated: true` opts out of the sitemap-consistency gate (page stays
// live + routed for residual organic/direct traffic, but is NOT promoted via
// sitemap.xml — Google de-indexes as it re-crawls). Authoritative source for
// the deprecated set: /workspace/bin/check-vertical.ts DEPRECATED_VERTICAL_KEYWORDS.
// Added 2026-05-23 as part of the agent-facing-positioning sweep
// (llms.txt + context.md + sitemap.xml) — 0/309 conversion across Feb–Apr 2026
// was a concluded experiment, not an open hypothesis.
// ─────────────────────────────────────────────────────────────────────────────
const VERTICAL_LANDINGS: Array<{ slug: string; file: string; sitemapPriority: number; deprecated?: boolean }> = [
  { slug: 'aeo-for-advokater',         file: 'tjenester/aeo-for-advokater.html',         sitemapPriority: 0.9, deprecated: true },
  { slug: 'aeo-for-saas-bedrifter',    file: 'tjenester/aeo-for-saas-bedrifter.html',    sitemapPriority: 0.9 },
  { slug: 'aeo-for-tannleger',         file: 'tjenester/aeo-for-tannleger.html',         sitemapPriority: 0.9, deprecated: true },
  { slug: 'aeo-for-eiendomsmeglere',   file: 'tjenester/aeo-for-eiendomsmeglere.html',   sitemapPriority: 0.9, deprecated: true },
  { slug: 'aeo-for-regnskap',          file: 'tjenester/aeo-for-regnskap.html',          sitemapPriority: 0.9, deprecated: true },
  { slug: 'aeo-for-kiropraktor',       file: 'tjenester/aeo-for-kiropraktor.html',       sitemapPriority: 0.9, deprecated: true },
  // Added 2026-06-06: psykolog vertical to back active outreach pipeline
  // (Stavanger Psykologhus E1 2026-06-02, Dialog Psykologsenter E1 2026-06-02,
  // E2s scheduled 2026-06-09). deprecated: true follows the verticals-are-
  // poor-organic-converters finding (0/309 Feb–Apr 2026) — page is routed for
  // inbound outreach replies but NOT sitemap-promoted.
  { slug: 'aeo-for-psykolog',          file: 'tjenester/aeo-for-psykolog.html',          sitemapPriority: 0.9, deprecated: true },
  // Added 2026-06-06: tanntekniker vertical for imminent E2s
  // (Din Tanntekniker AS E1 2026-06-02 score 56, E2 scheduled 2026-06-08 08:00;
  // Nano Tannteknikk E1 2026-06-02 score 42, E2 scheduled 2026-06-09 08:00).
  // deprecated: true same pattern — page routes for outreach reply destination,
  // not for organic search promotion.
  { slug: 'aeo-for-tanntekniker',      file: 'tjenester/aeo-for-tanntekniker.html',      sitemapPriority: 0.9, deprecated: true },
];

// Derive worker constant name from slug: aeo-for-advokater -> TJENESTER_AEO_FOR_ADVOKATER_HTML
function verticalConstName(slug: string): string {
  return 'TJENESTER_' + slug.toUpperCase().replace(/-/g, '_') + '_HTML';
}

// Load vertical landing HTML — fails build immediately if a file is missing.
const verticalFiles: Record<string, string> = {};
for (const v of VERTICAL_LANDINGS) {
  const fullPath = `/workspace/synlig-site/${v.file}`;
  try {
    verticalFiles[verticalConstName(v.slug)] = await Bun.file(fullPath).text();
  } catch {
    console.error(`\n[BUILD FAIL] VERTICAL_LANDINGS: file not found: ${fullPath}`);
    console.error(`Check the 'file' field in VERTICAL_LANDINGS for slug '${v.slug}'.`);
    process.exit(1);
  }
}

const files = {
  INDEX_HTML: await Bun.file("/workspace/synlig-site/index.html").text(),
  EN_HTML: await Bun.file("/workspace/synlig-site/en.html").text(),
  PRISER_HTML: await Bun.file("/workspace/synlig-site/priser.html").text(),
  FAKTURA_HTML: await Bun.file("/workspace/synlig-site/faktura.html").text(),
  GUIDE_HTML: await Bun.file("/workspace/synlig-site/guide.html").text(),
  DASHBOARD_HTML: await Bun.file("/workspace/synlig-site/dashboard.html").text(),
  LLMS_TXT: await Bun.file("/workspace/synlig-site/llms.txt").text(),
  ROBOTS_TXT: await Bun.file("/workspace/synlig-site/robots.txt").text(),
  SITEMAP_XML: await Bun.file("/workspace/synlig-site/sitemap.xml").text(),
  OG_SVG: await Bun.file("/workspace/synlig-site/og.svg").text(),
  FAVICON_SVG: await Bun.file("/workspace/synlig-site/favicon.svg").text(),
  KOMPLETT_AEO_HTML: await Bun.file("/workspace/synlig-site/komplett-aeo-analyse.html").text(),
  NORDIC_LITHIUM_CASE_HTML: await Bun.file("/workspace/synlig-site/nordic-lithium-case.html").text(),
  EN_CASE_NORDIC_LITHIUM_HTML: await Bun.file("/workspace/synlig-site/en-case-nordic-lithium.html").text(),
  EN_BLOG_HTML: await Bun.file("/workspace/synlig-site/en-blog.html").text(),
  EN_BLOG_LLM_SMELL_CHECK_BENCHMARK_HTML: await Bun.file("/workspace/synlig-site/en-blog-llm-smell-check-benchmark.html").text(),
  PIERSTOP_CASE_HTML: await Bun.file("/workspace/synlig-site/pierstop-case.html").text(),
  AGENT_CARD_JSON: await Bun.file("/workspace/synlig-site/agent-card.json").text(),
  BLOGG_INDEX_HTML: await Bun.file("/workspace/synlig-site/blogg/index.html").text(),
  BLOGG_HVA_ER_AEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/hva-er-aeo.html"),
  BLOGG_AEO_I_NORGE_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-i-norge-2026.html"),
  BLOGG_NORSK_AEO_BENCHMARK_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/norsk-aeo-benchmark-2026.html"),
  BLOGG_MCP_SECURITY_MARCH_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/mcp-security-march-2026.html"),
  BLOGG_AEO_BYRA_NORGE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-byra-norge.html"),
  BLOGG_LOKAL_AI_SYNLIGHET_HTML: await applyBlogCta("/workspace/synlig-site/blogg/lokal-ai-synlighet.html"),
  BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML: await applyBlogCta("/workspace/synlig-site/blogg/slik-blir-du-synlig-i-chatgpt.html"),
  BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/caveman-ai-pricing-april-2026.html"),
  BLOGG_ER_NETTSIDA_DI_KLAR_HTML: await applyBlogCta("/workspace/synlig-site/blogg/er-nettsida-di-klar-for-ai-agentar.html"),
  BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML: await applyBlogCta("/workspace/synlig-site/blogg/stavanger-agent-beredskap-april-2026.html"),
  BLOGG_HVA_ER_AEO_GUIDE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/hva-er-aeo-guide.html"),
  BLOGG_AEO_VS_SEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-vs-seo.html"),
  RAPPORT_STATE_AEO_2026_HTML: await Bun.file("/workspace/synlig-site/rapport/state-of-aeo-2026.html").text(),
  // Note: /tjenester/aeo-for-* verticals are loaded via VERTICAL_LANDINGS registry above (verticalFiles).
  TJENESTER_INDEX_HTML: await Bun.file("/workspace/synlig-site/tjenester/index.html").text(),
  TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML: await Bun.file("/workspace/synlig-site/tjenester/digital-markedsforing-stavanger.html").text(),
  BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML: await applyBlogCta("/workspace/synlig-site/blogg/digital-markedsforing-stavanger.html"),
  BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/chatgpt-annonser-og-aeo-april-2026.html"),
  BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML: await applyBlogCta("/workspace/synlig-site/blogg/automatisert-aeo-vs-radgiving.html"),
  BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/stavanger-klinikk-aeo-analyse.html"),
  BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML: await applyBlogCta("/workspace/synlig-site/blogg/norges-aeo-leaderboard-2026-04.html"),
  BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML: await applyBlogCta("/workspace/synlig-site/blogg/eu-ai-act-norske-bedrifter.html"),
  BLOGG_AEO_BUDSJETT_45X_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-budsjett-45x-okonomi.html"),
  BLOGG_AEO_SJEKKLISTE_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/aeo-sjekkliste-2026.html"),
  BLOGG_GA4_AI_ASSISTANT_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/ga4-ai-assistant-2026.html"),
  BLOGG_CHATGPT_KONVERTERER_9X_HTML: await applyBlogCta("/workspace/synlig-site/blogg/chatgpt-konverterer-9x.html"),
  BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/google-sok-redesign-mai-2026.html"),
  BLOGG_90_PROSENT_USYNLIGE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/90-prosent-usynlige-i-ai-sok.html"),
  BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/google-spam-policy-aeo-mai-2026.html"),
  BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML: await applyBlogCta("/workspace/synlig-site/blogg/93-prosent-ai-mode-null-klikk.html"),
  BLOGG_AI_PRODUKSJON_RELIABILITY_GAP_HTML: await applyBlogCta("/workspace/synlig-site/blogg/ai-produksjon-reliability-gap.html"),
  BLOGG_ROBINHOOD_AI_AGENTER_HTML: await applyBlogCta("/workspace/synlig-site/blogg/robinhood-ai-agenter-norske-merkevarer.html"),
  BLOGG_VIBESEC_AI_GENERERT_KODE_HTML: await applyBlogCta("/workspace/synlig-site/blogg/vibesec-ai-generert-kode-sikkerhet.html"),
  BLOGG_SOK_FRAGMENTERES_2026_HTML: await applyBlogCta("/workspace/synlig-site/blogg/sok-fragmenteres-2026.html"),
  BLOGG_EY_FALSKE_AI_KILDER_HTML: await applyBlogCta("/workspace/synlig-site/blogg/ey-falske-ai-kilder.html"),
  BLOGG_LLM_SMELLS_AEO_HTML: await applyBlogCta("/workspace/synlig-site/blogg/llm-smells-aeo-synlighet.html"),
  BLOGG_AEO_LITE_FAQPAGE_HTML: await Bun.file("/workspace/synlig-site/blogg/aeo-lite-faqpage-990-kr.html").text(),
  LEADERBOARD_HTML: await Bun.file("/workspace/synlig-site/leaderboard.html").text(),
  LEADERBOARD_JSON: await Bun.file("/workspace/synlig-site/leaderboard.json").text(),
  CONTEXT_MD: await Bun.file("/workspace/synlig-site/context.md").text(),
  PRISER_MD: await Bun.file("/workspace/synlig-site/priser.md").text(),
  // Cloudflare Agent Readiness Score — Level 3+ ("Agent-Readable") well-known endpoints.
  // Added 2026-05-27 after isitagentready.com scan reported Level 2 with the
  // following missing checks: markdownNegotiation, agentSkills, mcpServerCard,
  // apiCatalog, linkHeaders. Each file below corresponds to one check.
  AGENT_SKILLS_INDEX_JSON: await Bun.file("/workspace/synlig-site/.well-known/agent-skills/index.json").text(),
  AGENT_SKILLS_AEO_AUDIT_MD: await Bun.file("/workspace/synlig-site/.well-known/agent-skills/aeo-audit-SKILL.md").text(),
  AGENT_SKILLS_AEO_IMPLEMENTATION_MD: await Bun.file("/workspace/synlig-site/.well-known/agent-skills/aeo-implementation-SKILL.md").text(),
  MCP_JSON: await Bun.file("/workspace/synlig-site/.well-known/mcp.json").text(),
  API_CATALOG: await Bun.file("/workspace/synlig-site/.well-known/api-catalog").text(),
  // IndexNow key file — served at /<key>.txt so search engines can verify ownership.
  // Key generated 2026-06-05 for synligdigital.no. Rotate by generating a new key
  // with `openssl rand -hex 16`, updating this file + INDEXNOW_KEY below + scripts/indexnow-ping.ts.
  INDEXNOW_KEY_TXT: await Bun.file("/workspace/synlig-site/22424f96edcdb8ea14002edcd65a6b0c.txt").text(),
};

// Sitemap assertion: every ACTIVE vertical in VERTICAL_LANDINGS must appear in
// sitemap.xml. Adding a new vertical without updating sitemap.xml fails the
// build here, not silently at deploy time.
// Deprecated verticals (`deprecated: true`) must NOT appear in sitemap —
// they're being de-promoted, kept live only for residual traffic. The check
// runs both directions so re-adding a deprecated slug to sitemap also fails.
for (const v of VERTICAL_LANDINGS) {
  const inSitemap = files.SITEMAP_XML.includes(`/tjenester/${v.slug}`);
  if (!v.deprecated && !inSitemap) {
    console.error(`\n[BUILD FAIL] VERTICAL_LANDINGS: slug "${v.slug}" missing from sitemap.xml.`);
    console.error(`Add https://synligdigital.no/tjenester/${v.slug} to /workspace/synlig-site/sitemap.xml.`);
    process.exit(1);
  }
  if (v.deprecated && inSitemap) {
    console.error(`\n[BUILD FAIL] VERTICAL_LANDINGS: deprecated slug "${v.slug}" is still in sitemap.xml.`);
    console.error(`Remove the <url> entry for https://synligdigital.no/tjenester/${v.slug} from sitemap.xml.`);
    console.error(`(Deprecated verticals stay live for residual traffic but must not be promoted to search engines.)`);
    process.exit(1);
  }
}

// Audit-CTA invariants (post-injection, validates rendered output):
//   1. Every blog post must surface class="audit-cta" at least twice (mid+bottom).
//      History: chatgpt-konverterer-9x.html shipped with only mid CTA (2026-05-19),
//      caught manually during a blog->buy walk. This gate prevents silent regression.
//   2. Every blog post must surface the "4 900 NOK" pricing anchor at least once.
//      History: 2026-05-19 — blog layer surfaced only free-audit CTA; pricing
//      anchor lived only at /sjekk thank-you + cold emails. Buyers researching
//      on the blog never saw a buy path. This gate enforces blog-layer parity.
//   3. Markers must NOT survive into rendered output (would indicate render failure).
const bloggDir = "/workspace/synlig-site/blogg";
const ctaViolations: string[] = [];
const blogFileMap: Record<string, string> = {
  "hva-er-aeo.html": files.BLOGG_HVA_ER_AEO_HTML,
  "aeo-i-norge-2026.html": files.BLOGG_AEO_I_NORGE_2026_HTML,
  "norsk-aeo-benchmark-2026.html": files.BLOGG_NORSK_AEO_BENCHMARK_2026_HTML,
  "mcp-security-march-2026.html": files.BLOGG_MCP_SECURITY_MARCH_2026_HTML,
  "aeo-byra-norge.html": files.BLOGG_AEO_BYRA_NORGE_HTML,
  "lokal-ai-synlighet.html": files.BLOGG_LOKAL_AI_SYNLIGHET_HTML,
  "slik-blir-du-synlig-i-chatgpt.html": files.BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML,
  "caveman-ai-pricing-april-2026.html": files.BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML,
  "er-nettsida-di-klar-for-ai-agentar.html": files.BLOGG_ER_NETTSIDA_DI_KLAR_HTML,
  "stavanger-agent-beredskap-april-2026.html": files.BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML,
  "hva-er-aeo-guide.html": files.BLOGG_HVA_ER_AEO_GUIDE_HTML,
  "aeo-vs-seo.html": files.BLOGG_AEO_VS_SEO_HTML,
  "digital-markedsforing-stavanger.html": files.BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML,
  "chatgpt-annonser-og-aeo-april-2026.html": files.BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML,
  "automatisert-aeo-vs-radgiving.html": files.BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML,
  "stavanger-klinikk-aeo-analyse.html": files.BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML,
  "norges-aeo-leaderboard-2026-04.html": files.BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML,
  "eu-ai-act-norske-bedrifter.html": files.BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML,
  "aeo-budsjett-45x-okonomi.html": files.BLOGG_AEO_BUDSJETT_45X_HTML,
  "aeo-sjekkliste-2026.html": files.BLOGG_AEO_SJEKKLISTE_2026_HTML,
  "ga4-ai-assistant-2026.html": files.BLOGG_GA4_AI_ASSISTANT_2026_HTML,
  "chatgpt-konverterer-9x.html": files.BLOGG_CHATGPT_KONVERTERER_9X_HTML,
  "google-sok-redesign-mai-2026.html": files.BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML,
  "90-prosent-usynlige-i-ai-sok.html": files.BLOGG_90_PROSENT_USYNLIGE_HTML,
  "google-spam-policy-aeo-mai-2026.html": files.BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML,
  "93-prosent-ai-mode-null-klikk.html": files.BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML,
  "ai-produksjon-reliability-gap.html": files.BLOGG_AI_PRODUKSJON_RELIABILITY_GAP_HTML,
  "robinhood-ai-agenter-norske-merkevarer.html": files.BLOGG_ROBINHOOD_AI_AGENTER_HTML,
  "vibesec-ai-generert-kode-sikkerhet.html": files.BLOGG_VIBESEC_AI_GENERERT_KODE_HTML,
  "sok-fragmenteres-2026.html": files.BLOGG_SOK_FRAGMENTERES_2026_HTML,
  "ey-falske-ai-kilder.html": files.BLOGG_EY_FALSKE_AI_KILDER_HTML,
  "llm-smells-aeo-synlighet.html": files.BLOGG_LLM_SMELLS_AEO_HTML,
  "aeo-lite-faqpage-990-kr.html": files.BLOGG_AEO_LITE_FAQPAGE_HTML,
};
const allBlogFiles = readdirSync(bloggDir).filter(f => f.endsWith(".html") && f !== "index.html");
for (const fname of allBlogFiles) {
  const rendered = blogFileMap[fname];
  if (!rendered) {
    ctaViolations.push(`  blogg/${fname}: file exists on disk but not in build.ts files map — add it`);
    continue;
  }
  const ctaCount = (rendered.match(/class="audit-cta"/g) || []).length;
  if (ctaCount < 2) ctaViolations.push(`  blogg/${fname}: class="audit-cta" found ${ctaCount}, expected >=2`);
  if (!/4\s*900\s*NOK/.test(rendered))
    ctaViolations.push(`  blogg/${fname}: missing pricing anchor "4 900 NOK"`);
  // Buyer-journey "PAY" link: every blog post must carry the lead-capture entry point
  // (which then 302s to Stripe Checkout with customer_email pre-filled).
  // History: 2026-05-19 — pricing anchor was TEXT-ONLY (mailto only); buyer hit "pay"
  // with no online path. 2026-05-23 — migrated from direct checkout anchors to
  // /api/lead-capture forms so abandonment-recovery email gets customer_email.
  if (!rendered.includes(LEAD_CAPTURE_PATH) && !rendered.includes(CHECKOUT_HREF_PREFIX))
    ctaViolations.push(`  blogg/${fname}: missing checkout entry (expected "${LEAD_CAPTURE_PATH}" or "${CHECKOUT_HREF_PREFIX}")`);
  // Mailto fallback: low-trust visitors still need a non-card path.
  if (!rendered.includes(MAILTO_PREFIX))
    ctaViolations.push(`  blogg/${fname}: missing mailto fallback "${MAILTO_PREFIX}"`);
  if (rendered.includes(MID_MARKER) || rendered.includes(BOTTOM_MARKER))
    ctaViolations.push(`  blogg/${fname}: AUDIT-CTA marker survived into rendered HTML`);
}
if (ctaViolations.length > 0) {
  console.error(`\n[BUILD FAIL] audit-cta invariants violated:`);
  console.error(ctaViolations.join("\n"));
  console.error(`\nRenderer: /workspace/synlig-site/_partials/render-audit-cta.ts`);
  console.error(`Stages:   /workspace/synlig-site/_partials/blog-stages.json`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// SITEMAP-PARITY GATE — every published blog post must appear in sitemap.xml.
//
// History: 2026-06-05 idle-mode discovery. Six blog posts were live (200 OK) but
// silently absent from /sitemap.xml — invisible to crawlers via sitemap discovery
// since publication (some since 2026-04-23). The existing VERTICAL_LANDINGS gate
// caught the same drift class for vertical pages but blog posts had no gate, so
// every new post since ~April could leak. Per CLAUDE.md "recurring failures need
// code gates, not more text" — and this is the second sitemap-drift class.
//
// Source of truth: blogFileMap above (published posts loaded into the worker).
// If a slug is in blogFileMap, it's live and must be in sitemap.xml.
// ─────────────────────────────────────────────────────────────────────────────
const sitemapViolations: string[] = [];
for (const fname of Object.keys(blogFileMap)) {
  const slug = fname.replace(/\.html$/, "");
  const expectedLoc = `https://synligdigital.no/blogg/${slug}`;
  if (!files.SITEMAP_XML.includes(expectedLoc)) {
    sitemapViolations.push(`  blogg/${fname}: ${expectedLoc} missing from sitemap.xml`);
  }
}
if (sitemapViolations.length > 0) {
  console.error(`\n[BUILD FAIL] sitemap-parity violations (published posts not in sitemap.xml):`);
  console.error(sitemapViolations.join("\n"));
  console.error(`\nAdd <url> entries for each to /workspace/synlig-site/sitemap.xml.`);
  console.error(`Crawlers using sitemap discovery (Bing, ChatGPT-bot, PerplexityBot) skip orphan URLs.`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// FACT-SOURCE GATE — claim-traceability invariant for blog HTML.
//
// History: 2026-05-20 08:16 reflection. Agent drafted /blogg/90-prosent-usynlige-i-ai-sok
// with a fabricated vertical-breakdown table — every score invented (advokater 34, SaaS 47,
// klinikker 28, etc., vs actual registry: tannlege 50, advokat 58, ...). Caught ONLY because
// the writing agent happened to cross-check /workspace/money/aeo/report-registry.jsonl.
// Quote: "no automated gate intercepts stat-claim-without-source-row."
//
// The pre-existing protection ("Verify claims before asserting them" in CLAUDE.md Integrity
// + fact-check skill) did NOT prevent the near-miss. Per CLAUDE.md
// "1st occurrence → principle/skill text; 2nd occurrence → code gate" — and since this is a
// strong fabrication-class failure with high downside (live URL with invented stats), going
// straight to a code gate on the build's default execution path is the right level.
//
// Scope: blogg/*.html only (landing pages are template-heavy and revisit later if needed).
// Each numeric claim (percent, large-count with thousand separator, ratio, score-decl) must
// pass at least one of:
//   1) within 200 chars of a citation marker (Kilde:, external href, (Org, year), Ifølge X,
//      "egne data", Kilder<h*> section)
//   2) top-of-file allow-list comment <!-- fact-source-allow: ["claim1",…] -->
//   3) claim row in /workspace/money/aeo/fact-registry.jsonl
//   4) substring match against /workspace/money/aeo/report-registry.jsonl
//   5) inside <table class="audit-table" data-source="…">
//   6) top-of-file file-wide allow <!-- fact-source-allow-all: "non-empty reason" -->
//
// Bypass is opt-in (allow-list with explicit reason, OR registry entry with source_url).
// This is the execution-path-on-default-by-default intervention from CLAUDE.md self-awareness:
// gate sits on bun run build.ts (no opt-out unless a future engineer deletes the call).
//
// Source: /workspace/synlig-site/_partials/fact-source-gate.ts
// ─────────────────────────────────────────────────────────────────────────────
{
  const factResult = runFactSourceGate("/workspace/synlig-site/blogg", "enforce");
  if (factResult.violations.length > 0) {
    console.error(`\n[BUILD FAIL] fact-source gate: ${factResult.violations.length} unverified claim(s) in blogg/`);
    for (const v of factResult.violations) {
      console.error(`  ${v.file} [${v.heading}]: ${v.pattern} "${v.claim}"`);
      console.error(`    ...${v.snippet}...`);
    }
    console.error(`\nFix: add a citation within 200 chars (Kilde:, external href, (Org, year), egne data),`);
    console.error(`  OR add the claim to /workspace/money/aeo/fact-registry.jsonl with source_url,`);
    console.error(`  OR top-of-file <!-- fact-source-allow: ["claim", …] --> (per-claim),`);
    console.error(`  OR top-of-file <!-- fact-source-allow-all: "non-empty reason" --> (file-wide own-data).`);
    console.error(`Renderer: /workspace/synlig-site/_partials/fact-source-gate.ts`);
    process.exit(1);
  }
  console.log(`  fact-source: ${factResult.claims} claims across ${factResult.files} blogs, ${factResult.registryRows} registry rows, 0 unverified`);
}

// Pricing-parity invariant: JSON-LD Offer.price values on index.html MUST
// match the visible .service-price strings in #tjenester AND the FAQ
// "Hva koster det?" answer text. Source-of-truth: JSON-LD (the structured
// data AI agents consume).
//
// History: 2026-05-19 — JSON-LD said 4 900 / 14 900 / 4 900 while visible
// cards said 12 000 / 15 000 / 5 000 for unknown duration. Caught only by
// a manual dogfood walk after 3 cold emails landed prospects on the wrong
// number. 5:1 evidence-vs-outlier was visible but no automated gate caught
// it. This is the 4th two-layer-artifact recurrence in one day — code gate
// is the only intervention that persists across containers.
//
// Pairing rules (explicit, in order):
//   1. JSON-LD Offer with priceSpecification.unitText matching /per (m..ned|m.aned)/i
//      pairs with the visible card whose service-price contains "/mnd".
//   2. Otherwise pair by service-name token-overlap (≥4-char tokens).
//   3. Free offers (price="0") are skipped — they have no card.
//   4. Unmatched offers OR unmatched cards both fail.
//   5. FAQ "Hva koster det?" answer must mention every paid Offer.price
//      after NBSP/space normalization.
//
// Naming-drift policy: the gate ENFORCES price match, not name match.
// Today: JSON-LD "AI-synlighet Kontinuerleg" ↔ card "Løpende overvåking"
// disagree on name but agree on price + unitText. This is allowed because
// the monthly card is uniquely identified by /mnd. If naming drift breaks
// a future pair-by-name lookup, the gate emits "UNMATCHED" with both sides
// and we converge names then.
type OfferLD = { name: string; price: string; unitText: string | null };
type CardHTML = { name: string; priceText: string; priceNumeric: string; isMonthly: boolean };

const pricingViolations: string[] = [];
const indexHtml = files.INDEX_HTML;

// 1) Extract JSON-LD Offer entries from any OfferCatalog (paid only).
const ldOffers: OfferLD[] = [];
const ldBlockRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
let ldMatch: RegExpExecArray | null;
while ((ldMatch = ldBlockRe.exec(indexHtml)) !== null) {
  let parsed: any;
  try { parsed = JSON.parse(ldMatch[1]); } catch { continue; }
  const items = parsed?.hasOfferCatalog?.itemListElement;
  if (!Array.isArray(items)) continue;
  for (const item of items) {
    if (item?.["@type"] !== "Offer") continue;
    const price = String(item.price ?? "");
    if (!price || price === "0") continue;
    ldOffers.push({
      name: String(item.name ?? ""),
      price,
      unitText: item?.priceSpecification?.unitText ?? null,
    });
  }
}

// 2) Extract visible service-cards: zip independent .service-name and
//    .service-price arrays by position (more robust than a single
//    nested regex against multi-div cards).
const nameRe = /<div class="service-name">([\s\S]*?)<\/div>/g;
const priceRe = /<div class="service-price">([\s\S]*?)<\/div>/g;
const cardNames: string[] = [];
const cardPrices: string[] = [];
let nm: RegExpExecArray | null;
while ((nm = nameRe.exec(indexHtml)) !== null) cardNames.push(nm[1].trim());
let pm: RegExpExecArray | null;
while ((pm = priceRe.exec(indexHtml)) !== null) cardPrices.push(pm[1].trim());
if (cardNames.length !== cardPrices.length) {
  pricingViolations.push(
    `service-card structural mismatch: ${cardNames.length} .service-name vs ${cardPrices.length} .service-price`
  );
}
const cards: CardHTML[] = cardNames.map((name, i) => {
  const priceText = cardPrices[i] ?? "";
  const normalized = priceText.replace(/&nbsp;/g, " ").replace(/\s+/g, "");
  const isMonthly = /\/mnd/i.test(normalized);
  const priceNumeric = (normalized.match(/\d+/g) || []).join("");
  return { name, priceText, priceNumeric, isMonthly };
});

// 3) Pair JSON-LD offers to visible cards.
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9æøå\-]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 4)
  );
}
const cardUsed = new Set<number>();
const pairs: Array<{ offer: OfferLD; cardIdx: number; rule: string }> = [];
for (const offer of ldOffers) {
  let idx = -1;
  let rule = "";
  if (offer.unitText && /per (m[åa]nad|m[åa]ned)/i.test(offer.unitText)) {
    idx = cards.findIndex((c, i) => c.isMonthly && !cardUsed.has(i));
    rule = `unitText="${offer.unitText}" -> monthly card (/mnd)`;
  } else {
    const off = tokens(offer.name);
    let best = 0;
    cards.forEach((c, i) => {
      if (cardUsed.has(i) || c.isMonthly) return;
      const ct = tokens(c.name);
      let overlap = 0;
      for (const t of off) if (ct.has(t)) overlap++;
      if (overlap > best) { best = overlap; idx = i; }
    });
    rule = `name-token-overlap ≥1 (Offer "${offer.name}")`;
  }
  if (idx >= 0) cardUsed.add(idx);
  pairs.push({ offer, cardIdx: idx, rule });
}

// 4) Compare each pair's price; flag unmatched offers.
for (const p of pairs) {
  if (p.cardIdx < 0) {
    pricingViolations.push(
      `UNMATCHED JSON-LD Offer "${p.offer.name}" (price=${p.offer.price} NOK) — no visible card via rule [${p.rule}]`
    );
    continue;
  }
  const c = cards[p.cardIdx];
  if (p.offer.price !== c.priceNumeric) {
    pricingViolations.push(
      `MISMATCH: JSON-LD "${p.offer.name}" price=${p.offer.price} (source-of-truth) ↔ ` +
      `Card "${c.name}" price="${c.priceText}" (normalized=${c.priceNumeric}) | rule: ${p.rule}`
    );
  }
}
// 5) Unmatched cards (visible price with no corresponding JSON-LD Offer).
cards.forEach((c, i) => {
  if (!cardUsed.has(i)) {
    pricingViolations.push(
      `UNMATCHED HTML card "${c.name}" (price="${c.priceText}") — no JSON-LD Offer pairs to it`
    );
  }
});

// 6) FAQ "Hva koster det?" answer must mention every paid Offer.price.
const faqM = indexHtml.match(
  /Hva koster det\?[\s\S]*?<div class="faq-answer-inner">([\s\S]*?)<\/div>/
);
if (!faqM) {
  pricingViolations.push(`FAQ "Hva koster det?" answer block not found — gate cannot verify`);
} else {
  const faqNormalized = faqM[1].replace(/&nbsp;/g, " ").replace(/\s+/g, "");
  for (const o of ldOffers) {
    if (!faqNormalized.includes(o.price)) {
      pricingViolations.push(
        `FAQ "Hva koster det?" answer missing price ${o.price} NOK (Offer "${o.name}")`
      );
    }
  }
}

if (pricingViolations.length > 0) {
  console.error(`\n[BUILD FAIL] pricing-parity invariant violated (${pricingViolations.length} issue(s)):`);
  for (const v of pricingViolations) console.error(`  - ${v}`);
  console.error(`\nSource-of-truth: JSON-LD hasOfferCatalog.itemListElement (index.html ~L100-165).`);
  console.error(`Visible surfaces that must agree: .service-card .service-price on #tjenester, AND the FAQ "Hva koster det?" answer.`);
  console.error(`Pairing rules: unitText "per månad/maaned" -> /mnd card; otherwise token-overlap ≥1 (≥4-char tokens) with service-name.`);

  // Best-effort: log a row to working_memory for the
  // `json_ld_html_pricing_drift_blocks` audit thread the calibration
  // prediction (2026-08-19 deadline) reads from. Skipped during negative
  // testing (BUILD_GATE_NEGATIVE_TEST=1) and when TURSO env is absent.
  if (
    !process.env.BUILD_GATE_NEGATIVE_TEST &&
    process.env.TURSO_URL &&
    process.env.TURSO_AUTH_TOKEN
  ) {
    const note =
      `Pricing-parity gate blocked build at ${new Date().toISOString()}. ` +
      `${pricingViolations.length} violation(s). First: ${pricingViolations[0]}`;
    const r = Bun.spawnSync({
      cmd: [
        "bun",
        "/workspace/tools/pico-db/write-working-memory.ts",
        "--thread",
        "json_ld_html_pricing_drift_blocks",
        "--note",
        note,
        "--cite",
        "/workspace/synlig-site/build.ts",
      ],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (r.exitCode !== 0) {
      console.error(`(note: working-memory write returned exit ${r.exitCode}; continuing with build-fail)`);
    }
  }

  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER-SURFACE GATE — enforce funnel-wide tier coverage.
//
// When a tier appears on /priser, it must also appear on every funnel surface
// listed in its registry — hero, /audit, case pages, vertical landings — or
// the build fails. The failure mode this catches: shipping a new tier on /priser
// (and only /priser) creates discoverability vacuums on every adjacent surface
// where cold visitors first land. We've patched this same pattern 5× in one
// day (2026-06-05 19:16 priser, 19:36 hero, 20:12 /audit, 20:45 case pages,
// 21:31 vertical landings) — each patch shipped the tier on the most-recent
// surface but missed all the others. Per self-awareness rule: text rule failed
// twice (it's still being added one surface at a time), so escalate to a code
// gate.
//
// Registry shape: { tier: { needle: string, surfaces: filePath[] } }
// "needle" is a substring that must appear in EACH surface's inlined HTML.
// To add a new tier, add an entry here. To add a new surface to an existing
// tier, append the path. Skipping the gate is intentional (opt-out via env)
// only for negative-test scenarios.
//
// Why not auto-derive from `tier=lite` in /priser? Because the registry is
// the *intent* — "these are the funnel surfaces a tier SHOULD appear on" —
// not the current state. The gate compares intent vs. state.
// ─────────────────────────────────────────────────────────────────────────────
interface TierSurface {
  needle: string;       // substring asserted in each surface
  surfaces: string[];   // absolute file paths
}
const TIER_SURFACE_REGISTRY: Record<string, TierSurface> = {
  lite: {
    needle: `name="tier" value="lite"`,
    surfaces: [
      "/workspace/synlig-site/priser.html",
      "/workspace/synlig-site/index.html",
      "/workspace/synlig-site/nordic-lithium-case.html",
      "/workspace/synlig-site/pierstop-case.html",
      "/workspace/synlig-site/en-case-nordic-lithium.html",
      "/workspace/synlig-site/tjenester/aeo-for-tannleger.html",
      "/workspace/synlig-site/tjenester/aeo-for-saas-bedrifter.html",
      "/workspace/synlig-site/tjenester/aeo-for-eiendomsmeglere.html",
      "/workspace/synlig-site/tjenester/aeo-for-regnskap.html",
      "/workspace/synlig-site/tjenester/aeo-for-kiropraktor.html",
      // /audit report is generated by report-html.ts; tier surfaces inlined
      // at request time. Covered by audit-self-audit-cta.test.ts contract tests,
      // not by static file scan.
      //
      // Sent-prospect /r/<hash>.html reports (frozen pre-Lite) are enumerated
      // dynamically from /workspace/money/aeo/sent-emails.jsonl below — they
      // can't be hardcoded because the set changes with every outreach send.
    ],
  },
};

// Dynamic registry extension: any /r/<hash>.html report referenced by an
// active outreach E1 send (sent-emails.jsonl) must contain the tier needle.
// This catches the 6th occurrence of the funnel-wide-launch miss caught
// 2026-06-05 22:13Z — pre-Lite reports were FROZEN with single-tier CTA
// even after Lite shipped to all 10 hardcoded surfaces. The fix (and this
// gate) ensures any future tier launch that ships a `tier=<X>` needle to
// `/priser` will also be required to appear on every actively-referenced
// prospect report — closing the static-report blind-spot.
function dynamicReportSurfaces(): string[] {
  const SENT_EMAILS = "/workspace/money/aeo/sent-emails.jsonl";
  const slugs = new Set<string>();
  let text = "";
  try { text = readFileSync(SENT_EMAILS, "utf-8"); } catch { return []; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const url = typeof obj.report_url === "string" ? obj.report_url : "";
      const m = /\/r\/([a-z0-9]+)\b/i.exec(url);
      if (m) slugs.add(m[1].toLowerCase());
    } catch {}
  }
  return [...slugs].map(s => `/workspace/synlig-site/reports/${s}.html`);
}
const dynamicReports = dynamicReportSurfaces();
if (dynamicReports.length > 0) {
  // Lite tier inherits all sent-prospect reports as additional surfaces.
  TIER_SURFACE_REGISTRY.lite.surfaces.push(...dynamicReports);
}

const tierViolations: string[] = [];
if (!process.env.BUILD_GATE_NEGATIVE_TEST) {
  for (const [tier, spec] of Object.entries(TIER_SURFACE_REGISTRY)) {
    for (const path of spec.surfaces) {
      let text: string;
      try {
        text = readFileSync(path, "utf-8");
      } catch (err) {
        tierViolations.push(
          `tier="${tier}" surface MISSING file: ${path} (${err instanceof Error ? err.message : String(err)})`
        );
        continue;
      }
      // Match either single or double quotes around the value, since some
      // surfaces (button.name carrier on case pages) use button[name="tier"
      // value="lite"] while others use input[type=hidden] — both forms POST
      // tier=lite. The needle is the canonical form; relax for button form.
      const matched =
        text.includes(spec.needle) ||
        text.includes(spec.needle.replace(`name="tier" value=`, `name="tier" value=`));
      if (!matched) {
        tierViolations.push(
          `tier="${tier}" missing from surface: ${path}\n      needle: ${spec.needle}`
        );
      }
    }
  }
}

if (tierViolations.length > 0) {
  console.error(`\n[BUILD FAIL] tier-surface gate violated (${tierViolations.length} issue(s)):`);
  for (const v of tierViolations) console.error(`  - ${v}`);
  console.error(`\nWhy this gate exists: a tier added to /priser without parity on all funnel`);
  console.error(`surfaces creates discoverability vacuums — cold visitors land on the un-`);
  console.error(`patched surface and never see the tier. Caught 5× in one day on 2026-06-05.`);
  console.error(`\nFix: either (a) add the tier to the missing surface, or (b) if the tier`);
  console.error(`genuinely doesn't apply to that vertical, remove the surface from the registry.`);
  console.error(`Registry: synlig-site/build.ts TIER_SURFACE_REGISTRY.`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL PRICING-MENTION GATE — any blog post referencing Synlig Digital
// pricing (4 900, 14 900, Handlingsplan, Fundament) must ALSO mention Synlig
// Lite (990 NOK / 990 kr / "Synlig Lite") or the build fails.
//
// Why this gate exists: the Synlig Lite 990 NOK tier was launched 2026-06-05.
// Blog posts that mention higher-tier pricing without mentioning Lite create a
// vacuum — visitors who cannot afford 4 900 kr have no visible entry point.
// This pattern recurred 7× in one day (2026-06-05) across different surface
// types. Per self-awareness rule: text rule failed twice → escalate to a code
// gate on the default execution path. Any future blog authored with old
// pricing references will fail here until Lite is surfaced.
//
// Opt-out: BUILD_GATE_NEGATIVE_TEST env var (same as tier gate, for testing).
// ─────────────────────────────────────────────────────────────────────────────
if (!process.env.BUILD_GATE_NEGATIVE_TEST) {
  // Extended 2026-06-06 (10th occurrence — Stavanger geo-local + state-of-aeo-2026
  // research report + komplett-aeo-analyse stub): the gate originally scanned
  // /blogg only, but tier-discoverability gaps appeared in /tjenester (geographic
  // landing pages) and /rapport (research pillar pages). Per
  // funnel-wide-launch principle, every page surfacing pricing must surface the
  // entry tier — extend the same gate to those directories rather than
  // creating parallel registries.
  const PRICING_GATED_DIRS = [
    "/workspace/synlig-site/blogg",
    "/workspace/synlig-site/tjenester",
    "/workspace/synlig-site/rapport",
  ];
  const pricingPattern = /4 900|14 900|Handlingsplan|Fundament/;
  const litePattern = /Synlig Lite|990 NOK|990 kr/;
  const pricingViolations: string[] = [];
  const scanFiles: string[] = [];
  for (const dir of PRICING_GATED_DIRS) {
    try {
      const entries = readdirSync(dir).filter(f => f.endsWith(".html"));
      for (const f of entries) scanFiles.push(join(dir, f));
    } catch {}
  }
  // Also include the long-form pillar at the root (komplett-aeo-analyse.html)
  // which lives outside /blogg but mentions Fundament in its CTA.
  scanFiles.push("/workspace/synlig-site/komplett-aeo-analyse.html");
  for (const filePath of scanFiles) {
    let text = "";
    try { text = readFileSync(filePath, "utf-8"); } catch { continue; }
    if (pricingPattern.test(text) && !litePattern.test(text)) {
      pricingViolations.push(
        `page references pricing but lacks Synlig Lite mention: ${filePath}`
      );
    }
  }
  if (pricingViolations.length > 0) {
    console.error(`\n[BUILD FAIL] pricing-mention gate violated (${pricingViolations.length} issue(s)):`);
    for (const v of pricingViolations) console.error(`  - ${v}`);
    console.error(`\nWhy: any page mentioning Synlig Digital pricing (4 900/14 900 kr,`);
    console.error(`Handlingsplan, Fundament) must also surface Synlig Lite (990 NOK) as the`);
    console.error(`lowest entry point. Pattern caught 7× on 2026-06-05 + 3× on 2026-06-06`);
    console.error(`(Stavanger geo-landing, state-of-aeo-2026 rapport, komplett-aeo-analyse).`);
    console.error(`\nFix: add Synlig Lite mention to the CTA or pricing section.`);
    console.error(`Gated dirs: ${PRICING_GATED_DIRS.join(", ")} + komplett-aeo-analyse.html`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-DISCOVERY-SURFACE GATE — files explicitly served as machine-readable
// pricing/service catalogues to AI assistants (llms.txt, priser.md, context.md,
// agent-card.json) must mention every active tier. These are the surfaces
// ChatGPT/Perplexity/Google AI fetch first when answering "what does Synlig
// offer?" and "what's the cheapest option?" — stale pricing here propagates
// directly into AI citations.
//
// Why this gate exists: 2026-06-05 funnel-wide-launch sweep shipped Synlig
// Lite 990 NOK to ~10 HTML surfaces, 7 frozen reports, and 7 blog posts via
// three prior code gates — but llms.txt, priser.md, context.md and
// agent-card.json (the canonical AI-discovery files) were missed entirely.
// Found 9th occurrence by curl-walking AI-discovery surfaces. Per self-
// awareness rule: 9 occurrences in 24h across 5 distinct surface CATEGORIES
// (HTML source, frozen reports, blogs, skill text, AI-discovery files) — text
// rules failed; gate added on default execution path.
//
// Each tier MUST be assertable by substring match in each surface. Surface
// list and tier needles are intent — the build compares intent vs. state.
//
// Opt-out: BUILD_GATE_NEGATIVE_TEST env var (same as other gates, for testing).
// ─────────────────────────────────────────────────────────────────────────────
const AI_DISCOVERY_SURFACES = [
  "/workspace/synlig-site/llms.txt",
  "/workspace/synlig-site/priser.md",
  "/workspace/synlig-site/context.md",
  "/workspace/synlig-site/agent-card.json",
  // Agent-skills catalogue — AI assistants fetch these when surfacing services
  // for procurement-intent queries. Added 2026-06-06 after Lite-tier surface
  // audit found these files missing Lite despite 10+ HTML surfaces being patched.
  "/workspace/synlig-site/.well-known/agent-skills/aeo-implementation-SKILL.md",
  "/workspace/synlig-site/.well-known/agent-skills/index.json",
];
// Each tier needle is a set of alternates — the build passes if ANY alternate
// appears. This tolerates language differences (English in agent-card.json,
// Norwegian in the .txt/.md files) without forcing a single canonical phrase.
const AI_DISCOVERY_TIER_NEEDLES: Record<string, string[]> = {
  lite:        ["Synlig Lite", "990 NOK", "990 kr"],
  analyse:     ["Analyse", "4 900 NOK", "4 900 kr"],
  fundament:   ["Fundament", "14 900 NOK", "14 900 kr"],
  lopende:     ["Løpende", "4 900 NOK/mnd", "4 900 NOK/month", "4 900 kr/mnd"],
};
if (!process.env.BUILD_GATE_NEGATIVE_TEST) {
  const aiSurfaceViolations: string[] = [];
  for (const path of AI_DISCOVERY_SURFACES) {
    let text = "";
    try { text = readFileSync(path, "utf-8"); } catch (err) {
      aiSurfaceViolations.push(
        `AI-discovery surface MISSING file: ${path} (${err instanceof Error ? err.message : String(err)})`
      );
      continue;
    }
    for (const [tier, alternates] of Object.entries(AI_DISCOVERY_TIER_NEEDLES)) {
      const matched = alternates.some(n => text.includes(n));
      if (!matched) {
        aiSurfaceViolations.push(
          `tier="${tier}" missing from AI-discovery surface: ${path}\n      alternates (any one suffices): ${alternates.join(" | ")}`
        );
      }
    }
  }
  if (aiSurfaceViolations.length > 0) {
    console.error(`\n[BUILD FAIL] AI-discovery-surface gate violated (${aiSurfaceViolations.length} issue(s)):`);
    for (const v of aiSurfaceViolations) console.error(`  - ${v}`);
    console.error(`\nWhy: llms.txt, priser.md, context.md and agent-card.json are the canonical`);
    console.error(`machine-readable surfaces AI assistants fetch when answering "what does Synlig`);
    console.error(`offer?" and "what's the cheapest option?" Stale pricing here propagates into`);
    console.error(`citations and silently filters out price-sensitive prospects.`);
    console.error(`\nFix: add the missing tier (or one of its alternates) to the listed surface.`);
    console.error(`Registry: synlig-site/build.ts AI_DISCOVERY_TIER_NEEDLES.`);
    process.exit(1);
  }
}

// Load reports from /workspace/synlig-site/reports/
const reportsDir = "/workspace/synlig-site/reports";
const reportEntries: Array<{ hash: string; html: string }> = [];
try {
  const reportFiles = readdirSync(reportsDir).filter(f => f.endsWith(".html"));
  for (const fname of reportFiles) {
    const hash = fname.replace(".html", "");
    // Defensive: skip empty-hash files (`.html` with no name) — they would
    // become REPORTS[""] and be reachable at /r/ (no path segment). One such
    // file was an early Pierstop prototype shipped in 877cd9b that exposed
    // a "konfidensiell" cold-audit at the bare /r/ URL for 2+ months until
    // discovered on 2026-05-22. Belt-and-braces with the worker-side guard
    // below.
    if (!hash) {
      console.warn(`  ⚠ Skipping empty-hash report file: ${fname} (would expose at /r/)`);
      continue;
    }
    const html = await Bun.file(join(reportsDir, fname)).text();
    reportEntries.push({ hash, html });
    console.log(`  Loaded report: ${hash} (${html.length} bytes)`);
  }
} catch {
  console.log("  No reports directory found, skipping.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ORPHAN-REPORT GUARD — detect reports written to the wrong directory.
//
// History: 2026-05-25 12:27. Outreach session generated 3 E1 deliverables
// (eab6fb9e/401d8d98/b0fda823) and wrote them to /workspace/synlig-worker/reports/
// instead of the canonical /workspace/synlig-site/reports/. At 12:55 a different
// session ran this build script (which only reads the canonical dir) — the 3
// reports vanished from worker.ts and went 404 on synligdigital.no/r/{hash}.
// Three prospects had received E1 emails linking to those 404 URLs.
//
// Guard: any *.html in /workspace/synlig-worker/reports/ that is NOT also in
// /workspace/synlig-site/reports/ → fail the build with a clear message telling
// the operator to copy the file and retry. Cheaper than another buyer-journey
// dogfood pass discovering the same class of bug.
// ─────────────────────────────────────────────────────────────────────────────
{
  const orphanDir = "/workspace/synlig-worker/reports";
  const canonicalSet = new Set(reportEntries.map(r => r.hash + ".html"));
  let orphans: string[] = [];
  try {
    orphans = readdirSync(orphanDir)
      .filter(f => f.endsWith(".html"))
      .filter(f => !canonicalSet.has(f));
  } catch { /* dir absent: fine */ }
  if (orphans.length > 0) {
    console.error(`\n[BUILD FAIL] ORPHAN-REPORT GUARD: ${orphans.length} report(s) found in ${orphanDir} but NOT in ${reportsDir} (canonical):`);
    for (const o of orphans) console.error(`  - ${o}`);
    console.error(`\nFix: copy each orphan to the canonical dir and re-run deploy.`);
    console.error(`  for f in ${orphans.join(' ')}; do cp ${orphanDir}/$f ${reportsDir}/$f; done`);
    console.error(`\nRoot cause: an outreach session wrote the HTML report to the wrong dir.`);
    console.error(`Canonical write location is /workspace/synlig-site/reports/<hash>.html.`);
    console.error(`History: 2026-05-25 — 3 prospects received E1 emails linking to 404 URLs.\n`);
    process.exit(1);
  }
}

// Binary files (base64-encoded)
const pdfBytes = await Bun.file("/workspace/money/aeo/synlig-digital-one-pager.pdf").arrayBuffer();
const PDF_B64 = Buffer.from(pdfBytes).toString("base64");

// Per-article OG PNG. LinkedIn does NOT render SVG og:images (silently drops the
// preview card or shows broken placeholder — well-documented). The site default
// is /og.svg, which works in Slack/Discord/Twitter but kills LinkedIn previews.
// For cornerstone posts driving LinkedIn campaigns, ship a 1200×630 PNG.
// First instance: sok-fragmenteres-2026 (LinkedIn launch 2026-06-01/02).
// Pattern: add /workspace/synlig-site/og-<slug>.png + a route handler below,
// and switch the post's og:image to the PNG URL.
const sokFragOgPngBytes = await Bun.file("/workspace/synlig-site/og-sok-fragmenteres-2026.png").arrayBuffer();
const OG_SOK_FRAG_PNG_B64 = Buffer.from(sokFragOgPngBytes).toString("base64");

// Default OG raster — replaces /og.svg as the site-wide preview image. SVG
// og:image silently fails on LinkedIn/Twitter/Facebook (raster-only renderers
// drop the card or show a broken placeholder). PNG renders everywhere.
// Rendered once via @resvg/resvg-js from /workspace/synlig-site/og.svg with
// Liberation Sans (Inter-equivalent metrics) so the brand stays consistent.
const ogPngBytes = await Bun.file("/workspace/synlig-site/og.png").arrayBuffer();
const OG_PNG_B64 = Buffer.from(ogPngBytes).toString("base64");

// Escape backticks and dollar signs for template literals
function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

// Build reports map
const reportsMapEntries = reportEntries
  .map(r => `  "${r.hash}": \`${escape(r.html)}\``)
  .join(",\n");

// Pre-build vertical landing blocks for worker template (auto-derived from VERTICAL_LANDINGS).
// verticalConsts: one "const X_HTML = `...`;" per vertical (the silent 5th wiring place).
// verticalRoutes: three routes per vertical (bare, trailing-slash, .html form).
const verticalConsts = VERTICAL_LANDINGS.map(v => {
  const name = verticalConstName(v.slug);
  return `const ${name} = \`${escape(verticalFiles[name])}\`;`;
}).join('\n\n');

const verticalRoutes = VERTICAL_LANDINGS.map(v => {
  const name = verticalConstName(v.slug);
  return [
    `  "/tjenester/${v.slug}": { body: ${name}, contentType: "text/html; charset=utf-8" },`,
    `  "/tjenester/${v.slug}/": { body: ${name}, contentType: "text/html; charset=utf-8" },`,
    `  "/tjenester/${v.slug}.html": { body: ${name}, contentType: "text/html; charset=utf-8" },`,
  ].join('\n');
}).join('\n');

const worker = `// Auto-generated Cloudflare Worker — do not edit by hand.
// Built from /workspace/synlig-site/ static files.
// Generated: ${new Date().toISOString()}

import { handleAuditRequest } from "./audit-handler";
import { handleBevisRequest } from "./bevis-handler";
import { handleBrregSearch } from "./brreg-handler";
import { handleCheckoutRequest, handleFundamentCheckout, handleLiteCheckout, handleLopendeCheckout, handleLeadCapture, handleStripeWebhook, handleTakkPage } from "./checkout-handler";
import { handleFakturaSubmit } from "./faktura-handler";

const INDEX_HTML = \`${escape(files.INDEX_HTML)}\`;

const EN_HTML = \`${escape(files.EN_HTML)}\`;

const PRISER_HTML = \`${escape(files.PRISER_HTML)}\`;

const FAKTURA_HTML = \`${escape(files.FAKTURA_HTML)}\`;

const GUIDE_HTML = \`${escape(files.GUIDE_HTML)}\`;

const DASHBOARD_HTML = \`${escape(files.DASHBOARD_HTML)}\`;

const LLMS_TXT = \`${escape(files.LLMS_TXT)}\`;

const ROBOTS_TXT = \`${escape(files.ROBOTS_TXT)}\`;

const INDEXNOW_KEY_TXT = \`${escape(files.INDEXNOW_KEY_TXT)}\`;

const SITEMAP_XML = \`${escape(files.SITEMAP_XML)}\`;

const OG_SVG = \`${escape(files.OG_SVG)}\`;

const FAVICON_SVG = \`${escape(files.FAVICON_SVG)}\`;

const KOMPLETT_AEO_HTML = \`${escape(files.KOMPLETT_AEO_HTML)}\`;

const NORDIC_LITHIUM_CASE_HTML = \`${escape(files.NORDIC_LITHIUM_CASE_HTML)}\`;

const EN_CASE_NORDIC_LITHIUM_HTML = \`${escape(files.EN_CASE_NORDIC_LITHIUM_HTML)}\`;

const EN_BLOG_HTML = \`${escape(files.EN_BLOG_HTML)}\`;

const EN_BLOG_LLM_SMELL_CHECK_BENCHMARK_HTML = \`${escape(files.EN_BLOG_LLM_SMELL_CHECK_BENCHMARK_HTML)}\`;

const PIERSTOP_CASE_HTML = \`${escape(files.PIERSTOP_CASE_HTML)}\`;

const AGENT_CARD_JSON = \`${escape(files.AGENT_CARD_JSON)}\`;

const BLOGG_INDEX_HTML = \`${escape(files.BLOGG_INDEX_HTML)}\`;

const BLOGG_HVA_ER_AEO_HTML = \`${escape(files.BLOGG_HVA_ER_AEO_HTML)}\`;

const BLOGG_AEO_I_NORGE_2026_HTML = \`${escape(files.BLOGG_AEO_I_NORGE_2026_HTML)}\`;

const BLOGG_NORSK_AEO_BENCHMARK_2026_HTML = \`${escape(files.BLOGG_NORSK_AEO_BENCHMARK_2026_HTML)}\`;

const BLOGG_MCP_SECURITY_MARCH_2026_HTML = \`${escape(files.BLOGG_MCP_SECURITY_MARCH_2026_HTML)}\`;

const BLOGG_AEO_BYRA_NORGE_HTML = \`${escape(files.BLOGG_AEO_BYRA_NORGE_HTML)}\`;

const BLOGG_LOKAL_AI_SYNLIGHET_HTML = \`${escape(files.BLOGG_LOKAL_AI_SYNLIGHET_HTML)}\`;

const BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML = \`${escape(files.BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML)}\`;

const BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML = \`${escape(files.BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML)}\`;

const BLOGG_ER_NETTSIDA_DI_KLAR_HTML = \`${escape(files.BLOGG_ER_NETTSIDA_DI_KLAR_HTML)}\`;

const BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML = \`${escape(files.BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML)}\`;

const BLOGG_HVA_ER_AEO_GUIDE_HTML = \`${escape(files.BLOGG_HVA_ER_AEO_GUIDE_HTML)}\`;

const BLOGG_AEO_VS_SEO_HTML = \`${escape(files.BLOGG_AEO_VS_SEO_HTML)}\`;

const RAPPORT_STATE_AEO_2026_HTML = \`${escape(files.RAPPORT_STATE_AEO_2026_HTML)}\`;

${verticalConsts}

const TJENESTER_INDEX_HTML = \`${escape(files.TJENESTER_INDEX_HTML)}\`;

const TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML = \`${escape(files.TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML)}\`;

const BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML = \`${escape(files.BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML)}\`;

const BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML = \`${escape(files.BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML)}\`;

const BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML = \`${escape(files.BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML)}\`;

const BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML = \`${escape(files.BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML)}\`;

const BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML = \`${escape(files.BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML)}\`;

const BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML = \`${escape(files.BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML)}\`;

const BLOGG_AEO_BUDSJETT_45X_HTML = \`${escape(files.BLOGG_AEO_BUDSJETT_45X_HTML)}\`;

const BLOGG_AEO_SJEKKLISTE_2026_HTML = \`${escape(files.BLOGG_AEO_SJEKKLISTE_2026_HTML)}\`;

const BLOGG_GA4_AI_ASSISTANT_2026_HTML = \`${escape(files.BLOGG_GA4_AI_ASSISTANT_2026_HTML)}\`;

const BLOGG_CHATGPT_KONVERTERER_9X_HTML = \`${escape(files.BLOGG_CHATGPT_KONVERTERER_9X_HTML)}\`;

const BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML = \`${escape(files.BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML)}\`;

const BLOGG_90_PROSENT_USYNLIGE_HTML = \`${escape(files.BLOGG_90_PROSENT_USYNLIGE_HTML)}\`;

const BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML = \`${escape(files.BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML)}\`;

const BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML = \`${escape(files.BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML)}\`;

const BLOGG_AI_PRODUKSJON_RELIABILITY_GAP_HTML = \`${escape(files.BLOGG_AI_PRODUKSJON_RELIABILITY_GAP_HTML)}\`;

const BLOGG_ROBINHOOD_AI_AGENTER_HTML = \`${escape(files.BLOGG_ROBINHOOD_AI_AGENTER_HTML)}\`;

const BLOGG_VIBESEC_AI_GENERERT_KODE_HTML = \`${escape(files.BLOGG_VIBESEC_AI_GENERERT_KODE_HTML)}\`;

const BLOGG_SOK_FRAGMENTERES_2026_HTML = \`${escape(files.BLOGG_SOK_FRAGMENTERES_2026_HTML)}\`;

const BLOGG_EY_FALSKE_AI_KILDER_HTML = \`${escape(files.BLOGG_EY_FALSKE_AI_KILDER_HTML)}\`;

const BLOGG_LLM_SMELLS_AEO_HTML = \`${escape(files.BLOGG_LLM_SMELLS_AEO_HTML)}\`;

const BLOGG_AEO_LITE_FAQPAGE_HTML = \`${escape(files.BLOGG_AEO_LITE_FAQPAGE_HTML)}\`;

const LEADERBOARD_HTML = \`${escape(files.LEADERBOARD_HTML)}\`;

const LEADERBOARD_JSON = \`${escape(files.LEADERBOARD_JSON)}\`;

const CONTEXT_MD = \`${escape(files.CONTEXT_MD)}\`;

const PRISER_MD = \`${escape(files.PRISER_MD)}\`;

const AGENT_SKILLS_INDEX_JSON = \`${escape(files.AGENT_SKILLS_INDEX_JSON)}\`;

const AGENT_SKILLS_AEO_AUDIT_MD = \`${escape(files.AGENT_SKILLS_AEO_AUDIT_MD)}\`;

const AGENT_SKILLS_AEO_IMPLEMENTATION_MD = \`${escape(files.AGENT_SKILLS_AEO_IMPLEMENTATION_MD)}\`;

const MCP_JSON = \`${escape(files.MCP_JSON)}\`;

const API_CATALOG = \`${escape(files.API_CATALOG)}\`;

const ONE_PAGER_PDF_B64 = "${PDF_B64}";

const OG_SOK_FRAG_PNG_B64 = "${OG_SOK_FRAG_PNG_B64}";

const OG_PNG_B64 = "${OG_PNG_B64}";

// AEO Reports: hash -> HTML content
const REPORTS = {
${reportsMapEntries}
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' mailto:",
};

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600",
};

// 1x1 transparent GIF for tracking pixel
const TRACKING_GIF_B64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const routes = {
  "/": { body: INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/index.html": { body: INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/en": { body: EN_HTML, contentType: "text/html; charset=utf-8" },
  "/en/": { body: EN_HTML, contentType: "text/html; charset=utf-8" },
  "/en/index.html": { body: EN_HTML, contentType: "text/html; charset=utf-8" },
  "/en.html": { body: EN_HTML, contentType: "text/html; charset=utf-8" },
  "/priser": { body: PRISER_HTML, contentType: "text/html; charset=utf-8" },
  "/priser/": { body: PRISER_HTML, contentType: "text/html; charset=utf-8" },
  "/priser.html": { body: PRISER_HTML, contentType: "text/html; charset=utf-8" },
  "/faktura": { body: FAKTURA_HTML, contentType: "text/html; charset=utf-8" },
  "/faktura/": { body: FAKTURA_HTML, contentType: "text/html; charset=utf-8" },
  "/faktura.html": { body: FAKTURA_HTML, contentType: "text/html; charset=utf-8" },
  "/guide": { body: GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/guide.html": { body: GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/dashboard": { body: DASHBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/dashboard.html": { body: DASHBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/llms.txt": { body: LLMS_TXT, contentType: "text/plain; charset=utf-8" },
  "/robots.txt": { body: ROBOTS_TXT, contentType: "text/plain; charset=utf-8" },
  "/22424f96edcdb8ea14002edcd65a6b0c.txt": { body: INDEXNOW_KEY_TXT, contentType: "text/plain; charset=utf-8" },
  "/sitemap.xml": { body: SITEMAP_XML, contentType: "application/xml; charset=utf-8" },
  "/og.svg": { body: OG_SVG, contentType: "image/svg+xml" },
  "/favicon.svg": { body: FAVICON_SVG, contentType: "image/svg+xml" },
  "/analyse/komplett-aeo": { body: KOMPLETT_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/analyse/komplett-aeo.html": { body: KOMPLETT_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/case/nordic-lithium": { body: NORDIC_LITHIUM_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/case/nordic-lithium.html": { body: NORDIC_LITHIUM_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/en/case/nordic-lithium": { body: EN_CASE_NORDIC_LITHIUM_HTML, contentType: "text/html; charset=utf-8" },
  "/en/case/nordic-lithium/": { body: EN_CASE_NORDIC_LITHIUM_HTML, contentType: "text/html; charset=utf-8" },
  "/en/case/nordic-lithium.html": { body: EN_CASE_NORDIC_LITHIUM_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog": { body: EN_BLOG_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/": { body: EN_BLOG_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/index.html": { body: EN_BLOG_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/llm-smell-check-benchmark": { body: EN_BLOG_LLM_SMELL_CHECK_BENCHMARK_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/llm-smell-check-benchmark/": { body: EN_BLOG_LLM_SMELL_CHECK_BENCHMARK_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/llm-smell-check-benchmark.html": { body: EN_BLOG_LLM_SMELL_CHECK_BENCHMARK_HTML, contentType: "text/html; charset=utf-8" },
  "/case/pierstop": { body: PIERSTOP_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/case/pierstop.html": { body: PIERSTOP_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/.well-known/agent-card.json": { body: AGENT_CARD_JSON, contentType: "application/json; charset=utf-8" },
  "/.well-known/agent.json": { body: AGENT_CARD_JSON, contentType: "application/json; charset=utf-8" },
  "/blogg": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/index.html": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo": { body: BLOGG_HVA_ER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo.html": { body: BLOGG_HVA_ER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-i-norge-2026": { body: BLOGG_AEO_I_NORGE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-i-norge-2026.html": { body: BLOGG_AEO_I_NORGE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norsk-aeo-benchmark-2026": { body: BLOGG_NORSK_AEO_BENCHMARK_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norsk-aeo-benchmark-2026.html": { body: BLOGG_NORSK_AEO_BENCHMARK_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/mcp-security-march-2026": { body: BLOGG_MCP_SECURITY_MARCH_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/mcp-security-march-2026.html": { body: BLOGG_MCP_SECURITY_MARCH_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-byra-norge": { body: BLOGG_AEO_BYRA_NORGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-byra-norge.html": { body: BLOGG_AEO_BYRA_NORGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/lokal-ai-synlighet": { body: BLOGG_LOKAL_AI_SYNLIGHET_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/lokal-ai-synlighet.html": { body: BLOGG_LOKAL_AI_SYNLIGHET_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/slik-blir-du-synlig-i-chatgpt": { body: BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/slik-blir-du-synlig-i-chatgpt.html": { body: BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/caveman-ai-pricing-april-2026": { body: BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/caveman-ai-pricing-april-2026.html": { body: BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/er-nettsida-di-klar-for-ai-agentar": { body: BLOGG_ER_NETTSIDA_DI_KLAR_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/er-nettsida-di-klar-for-ai-agentar.html": { body: BLOGG_ER_NETTSIDA_DI_KLAR_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-agent-beredskap-april-2026": { body: BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-agent-beredskap-april-2026.html": { body: BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo-guide": { body: BLOGG_HVA_ER_AEO_GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo-guide.html": { body: BLOGG_HVA_ER_AEO_GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-vs-seo": { body: BLOGG_AEO_VS_SEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-vs-seo.html": { body: BLOGG_AEO_VS_SEO_HTML, contentType: "text/html; charset=utf-8" },
  "/rapport/state-of-aeo-2026": { body: RAPPORT_STATE_AEO_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/rapport/state-of-aeo-2026.html": { body: RAPPORT_STATE_AEO_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester": { body: TJENESTER_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/": { body: TJENESTER_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester.html": { body: TJENESTER_INDEX_HTML, contentType: "text/html; charset=utf-8" },
${verticalRoutes}
  "/tjenester/digital-markedsforing-stavanger": { body: TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/digital-markedsforing-stavanger/": { body: TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/digital-markedsforing-stavanger.html": { body: TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/digital-markedsforing-stavanger": { body: BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/digital-markedsforing-stavanger.html": { body: BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-annonser-og-aeo-april-2026": { body: BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-annonser-og-aeo-april-2026.html": { body: BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/automatisert-aeo-vs-radgiving": { body: BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/automatisert-aeo-vs-radgiving.html": { body: BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-klinikk-aeo-analyse": { body: BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/stavanger-klinikk-aeo-analyse.html": { body: BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norges-aeo-leaderboard-2026-04": { body: BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norges-aeo-leaderboard-2026-04.html": { body: BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/eu-ai-act-norske-bedrifter": { body: BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/eu-ai-act-norske-bedrifter.html": { body: BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-budsjett-45x-okonomi": { body: BLOGG_AEO_BUDSJETT_45X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-budsjett-45x-okonomi.html": { body: BLOGG_AEO_BUDSJETT_45X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-sjekkliste-2026": { body: BLOGG_AEO_SJEKKLISTE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-sjekkliste-2026.html": { body: BLOGG_AEO_SJEKKLISTE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ga4-ai-assistant-2026": { body: BLOGG_GA4_AI_ASSISTANT_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ga4-ai-assistant-2026.html": { body: BLOGG_GA4_AI_ASSISTANT_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-konverterer-9x": { body: BLOGG_CHATGPT_KONVERTERER_9X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/chatgpt-konverterer-9x.html": { body: BLOGG_CHATGPT_KONVERTERER_9X_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-sok-redesign-mai-2026": { body: BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-sok-redesign-mai-2026.html": { body: BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/90-prosent-usynlige-i-ai-sok": { body: BLOGG_90_PROSENT_USYNLIGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/90-prosent-usynlige-i-ai-sok.html": { body: BLOGG_90_PROSENT_USYNLIGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-spam-policy-aeo-mai-2026": { body: BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-spam-policy-aeo-mai-2026.html": { body: BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/93-prosent-ai-mode-null-klikk": { body: BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/93-prosent-ai-mode-null-klikk.html": { body: BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ai-produksjon-reliability-gap": { body: BLOGG_AI_PRODUKSJON_RELIABILITY_GAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ai-produksjon-reliability-gap.html": { body: BLOGG_AI_PRODUKSJON_RELIABILITY_GAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/robinhood-ai-agenter-norske-merkevarer": { body: BLOGG_ROBINHOOD_AI_AGENTER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/robinhood-ai-agenter-norske-merkevarer.html": { body: BLOGG_ROBINHOOD_AI_AGENTER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/vibesec-ai-generert-kode-sikkerhet": { body: BLOGG_VIBESEC_AI_GENERERT_KODE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/vibesec-ai-generert-kode-sikkerhet.html": { body: BLOGG_VIBESEC_AI_GENERERT_KODE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/sok-fragmenteres-2026": { body: BLOGG_SOK_FRAGMENTERES_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/sok-fragmenteres-2026.html": { body: BLOGG_SOK_FRAGMENTERES_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ey-falske-ai-kilder": { body: BLOGG_EY_FALSKE_AI_KILDER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/ey-falske-ai-kilder.html": { body: BLOGG_EY_FALSKE_AI_KILDER_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/llm-smells-aeo-synlighet": { body: BLOGG_LLM_SMELLS_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/llm-smells-aeo-synlighet.html": { body: BLOGG_LLM_SMELLS_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-lite-faqpage-990-kr": { body: BLOGG_AEO_LITE_FAQPAGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-lite-faqpage-990-kr.html": { body: BLOGG_AEO_LITE_FAQPAGE_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard": { body: LEADERBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard/": { body: LEADERBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard.html": { body: LEADERBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/leaderboard.json": { body: LEADERBOARD_JSON, contentType: "application/json; charset=utf-8" },
  "/context.md": { body: CONTEXT_MD, contentType: "text/markdown; charset=utf-8" },
  "/priser.md": { body: PRISER_MD, contentType: "text/markdown; charset=utf-8" },
  // Agent-readiness well-known endpoints (Cloudflare Agent Readiness Score Level 3+).
  // See /workspace/synlig-site/.well-known/ for source files. Added 2026-05-27 to
  // pass: agentSkills, mcpServerCard, apiCatalog. markdownNegotiation handled
  // separately in the fetch handler (Accept: text/markdown on /).
  "/.well-known/agent-skills/index.json": { body: AGENT_SKILLS_INDEX_JSON, contentType: "application/json; charset=utf-8" },
  "/.well-known/skills/index.json": { body: AGENT_SKILLS_INDEX_JSON, contentType: "application/json; charset=utf-8" },
  "/.well-known/agent-skills/aeo-audit/SKILL.md": { body: AGENT_SKILLS_AEO_AUDIT_MD, contentType: "text/markdown; charset=utf-8" },
  "/.well-known/agent-skills/aeo-implementation/SKILL.md": { body: AGENT_SKILLS_AEO_IMPLEMENTATION_MD, contentType: "text/markdown; charset=utf-8" },
  "/.well-known/mcp.json": { body: MCP_JSON, contentType: "application/json; charset=utf-8" },
  "/.well-known/mcp/server-card.json": { body: MCP_JSON, contentType: "application/json; charset=utf-8" },
  "/.well-known/mcp/server-cards.json": { body: MCP_JSON, contentType: "application/json; charset=utf-8" },
  "/.well-known/api-catalog": { body: API_CATALOG, contentType: "application/linkset+json; charset=utf-8" },
};

// Open Graph meta injection for /r/{hash} report responses.
// History: 2026-06-03 — og.png shipped earlier today across synligdigital.no/*
// and sjekk.synligdigital.no/, but the 157 /r/{hash} report HTML files have no
// OG tags at all. /r/{hash} URLs are the highest-leverage missed share-moment
// in the funnel — the moment a decision-maker sees a URL a colleague forwarded.
// Without OG, Slack/Teams/email render the link as a bare URL with no preview.
//
// Strategy: inject at response time, not in the 157 static files. One code
// change covers existing + future reports. Title extraction is regex on
// <title>...</title> (verified 157/157 reports have exactly one such tag).
function injectReportOg(html, request) {
  if (!html) return html;
  const titleMatch = html.match(/<title>([^<]*)<\\/title>/);
  if (!titleMatch) return html; // No title — skip injection rather than risk malformed HTML
  const titleText = titleMatch[1];
  let canonical;
  try {
    const u = new URL(request.url);
    canonical = u.origin + u.pathname;
  } catch (e) {
    canonical = "https://synligdigital.no/";
  }
  const esc = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const description = "Gratis AEO-rapport fra Synlig Digital — sjekk om bedriften din er synlig for ChatGPT, Perplexity og Google AI";
  const escTitle = esc(titleText);
  const escDesc = esc(description);
  const escUrl = esc(canonical);
  const og =
    '<meta property="og:type" content="website">' +
    '<meta property="og:title" content="' + escTitle + '">' +
    '<meta property="og:description" content="' + escDesc + '">' +
    '<meta property="og:url" content="' + escUrl + '">' +
    '<meta property="og:image" content="https://synligdigital.no/og.png">' +
    '<meta property="og:image:width" content="1200">' +
    '<meta property="og:image:height" content="630">' +
    '<meta property="og:site_name" content="Synlig">' +
    '<meta property="og:locale" content="nb_NO">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + escTitle + '">' +
    '<meta name="twitter:description" content="' + escDesc + '">' +
    '<meta name="twitter:image" content="https://synligdigital.no/og.png">';
  // String .replace() replaces only the first occurrence. The two reports
  // containing "<title>" in body text (as audit findings) have no closing
  // </title> in body, so the head match is unique.
  return html.replace("</title>", "</title>" + og);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Blog mailto click tracking: GET /api/track-click?src=blog-{slug}&type=mailto
    // Fired client-side (navigator.sendBeacon) when a visitor clicks a mailto CTA fallback.
    // Stores click in KV under mailto-click:{src}:{ts} (90-day TTL).
    // Returns 200 JSON — no redirect. Added 2026-06-02 to fix src=null for all blog leads.
    if (pathname === "/api/track-click") {
      const src = url.searchParams.get("src") || "unknown";
      const type = url.searchParams.get("type") || "mailto";
      const ts = Date.now();
      const ref = request.headers.get("Referer") || "-";
      const ua = request.headers.get("User-Agent") || "-";
      const ip = request.headers.get("CF-Connecting-IP") || "-";
      const country = request.headers.get("CF-IPCountry") || "-";
      console.log(\`[TRACK-CLICK] src=\${src} type=\${type} country=\${country}\`);
      if (env && env.CLICK_LOG) {
        const key = \`mailto-click:\${src}:\${ts}\`;
        await env.CLICK_LOG.put(key, JSON.stringify({ src, type, ts, ref: ref.substring(0, 200), ua: ua.substring(0, 200), ip, country }), { expirationTtl: 7776000 });
        const aggKey = \`mailto-stats:\${src}\`;
        const agg: any = await env.CLICK_LOG.get(aggKey, "json") || { count: 0, last: 0 };
        agg.count = (agg.count || 0) + 1;
        agg.last = ts;
        await env.CLICK_LOG.put(aggKey, JSON.stringify(agg), { expirationTtl: 7776000 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "https://synligdigital.no" },
      });
    }

    // Click tracking + redirect: GET /click?h={prospect_hash}&t={link_type}&u={url}
    // Logs click to KV (synlig-clicks namespace) then redirects to destination.
    // h = prospect hash (matches report hash), t = link type (report/guide/booking),
    // u = destination URL (URL-encoded)
    if (pathname === "/click") {
      const h = url.searchParams.get("h") || "unknown";
      const t = url.searchParams.get("t") || "link";
      const dest = url.searchParams.get("u");
      const ts = Date.now();
      const ua = request.headers.get("User-Agent") || "-";
      const ref = request.headers.get("Referer") || "-";
      const ip = request.headers.get("CF-Connecting-IP") || "-";
      const country = request.headers.get("CF-IPCountry") || "-";

      // Log to console always
      console.log(\`[CLICK] h=\${h} t=\${t} dest=\${dest} country=\${country} ua=\${ua.substring(0,80)}\`);

      // Store in KV if available
      if (env && env.CLICK_LOG) {
        const key = \`click:\${h}:\${ts}\`;
        const val = JSON.stringify({ h, t, dest, ts, ua: ua.substring(0, 200), ref: ref.substring(0, 200), ip, country });
        await env.CLICK_LOG.put(key, val, { expirationTtl: 7776000 }); // 90 days

        // Update aggregate stats for this hash
        const statsKey = \`stats:\${h}\`;
        const existing = await env.CLICK_LOG.get(statsKey, "json") || { count: 0, last: 0, types: {} };
        existing.count = (existing.count || 0) + 1;
        existing.last = ts;
        existing.types[t] = (existing.types[t] || 0) + 1;
        await env.CLICK_LOG.put(statsKey, JSON.stringify(existing));
      }

      // Redirect to destination, fallback to homepage
      const destination = dest ? decodeURIComponent(dest) : "https://synligdigital.no";
      return new Response(null, {
        status: 302,
        headers: { "Location": destination, "Cache-Control": "no-store" },
      });
    }

    // Click admin: GET /clicks?key={admin_key}
    // Shows all tracked clicks in a simple HTML table.
    if (pathname === "/clicks") {
      const key = url.searchParams.get("key");
      if (key !== "pico2026") {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!env || !env.CLICK_LOG) {
        return new Response("KV not configured", { status: 503 });
      }

      // List all stats keys (aggregated per prospect)
      const statsList = await env.CLICK_LOG.list({ prefix: "stats:" });
      const rows = [];
      for (const item of statsList.keys) {
        const stats = await env.CLICK_LOG.get(item.name, "json");
        if (stats) {
          const hash = item.name.replace("stats:", "");
          const lastDate = new Date(stats.last).toISOString().substring(0, 16).replace("T", " ");
          const typeSummary = Object.entries(stats.types || {}).map(([k, v]) => \`\${k}:\${v}\`).join(" ");
          rows.push(\`<tr><td>\${hash}</td><td>\${stats.count}</td><td>\${lastDate} UTC</td><td>\${typeSummary}</td></tr>\`);
        }
      }

      // List recent individual clicks
      const clickList = await env.CLICK_LOG.list({ prefix: "click:", limit: 50 });
      const recentRows = [];
      for (const item of clickList.keys.reverse()) {
        const click = await env.CLICK_LOG.get(item.name, "json");
        if (click) {
          const date = new Date(click.ts).toISOString().substring(0, 16).replace("T", " ");
          const destShort = (click.dest || "").substring(0, 60);
          recentRows.push(\`<tr><td>\${date}</td><td>\${click.h}</td><td>\${click.t}</td><td>\${click.country}</td><td title="\${click.dest}">\${destShort}</td></tr>\`);
        }
      }

      const html = \`<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><title>Synlig — Klikk-oversikt</title>
<style>body{font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{padding:.5rem 1rem;text-align:left;border:1px solid #334155}th{background:#1e293b}tr:hover{background:#1e293b}h2{color:#38bdf8}</style></head>
<body><h1>Klikk-oversikt</h1>
<h2>Per prospekt</h2>
<table><tr><th>Hash</th><th>Klikk</th><th>Siste klikk</th><th>Typer</th></tr>\${rows.join("")}</table>
<h2>Siste 50 klikk</h2>
<table><tr><th>Tid</th><th>Hash</th><th>Type</th><th>Land</th><th>Destinasjon</th></tr>\${recentRows.join("")}</table>
</body></html>\`;

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // Serve PDF binary
    if (pathname === "/one-pager.pdf" || pathname === "/rapport.pdf") {
      const bytes = Uint8Array.from(atob(ONE_PAGER_PDF_B64), c => c.charCodeAt(0));
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline; filename=synlig-digital-ai-synlighet.pdf",
          ...SECURITY_HEADERS,
          ...CACHE_HEADERS,
        },
      });
    }

    // Per-article OG PNG — LinkedIn launch (2026-06-01/02) drives traffic to
    // /blogg/sok-fragmenteres-2026 and needs a raster preview card. The site
    // default /og.svg silently fails on LinkedIn (drops the card). See B64
    // constant comment above.
    if (pathname === "/og-sok-fragmenteres-2026.png") {
      const bytes = Uint8Array.from(atob(OG_SOK_FRAG_PNG_B64), c => c.charCodeAt(0));
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          ...SECURITY_HEADERS,
          ...CACHE_HEADERS,
        },
      });
    }

    // Default site OG raster (replaces /og.svg for og:image refs).
    if (pathname === "/og.png") {
      const bytes = Uint8Array.from(atob(OG_PNG_B64), c => c.charCodeAt(0));
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          ...SECURITY_HEADERS,
          ...CACHE_HEADERS,
        },
      });
    }

    // Tracking pixel: GET /track?h={hash}
    // Returns 1x1 GIF. Every active outreach report (106 of 131) embeds
    //   <img src="https://synligdigital.no/track?h=HASH" width="1" height="1">
    // so this fires whenever a prospect renders the report HTML in a browser
    // (or an email client auto-loads images: Gmail proxy, Apple Mail, etc).
    //
    // History: prior version only console.log'd — opens were invisible to the
    // outreach pipeline. Now logs to CLICK_LOG KV (view:HASH:TS individual,
    // view-stats:HASH aggregate) and fires Telegram alerts on first-human-view
    // and third-human-view per hash so opus can ship a personalized E2 within
    // hours of engagement instead of generic sonnet bulk follow-up next day.
    //
    // Classification: bots (Googlebot/GPTBot/Claude/etc), previewers (Gmail
    // proxy/Outlook/Apple Mail link-expanders), and humans counted separately.
    // Hot-prospect alert only fires for human views.
    if (pathname === "/track") {
      const h = url.searchParams.get("h") || "unknown";
      const ua = request.headers.get("User-Agent") || "-";
      const ts = Date.now();
      const country = request.headers.get("CF-IPCountry") || "-";
      const ref = request.headers.get("Referer") || "-";
      const ip = request.headers.get("CF-Connecting-IP") || "-";
      const isBot = /bot\\b|crawler|spider|GPTBot|ClaudeBot|anthropic|Googlebot|Bingbot|YandexBot|facebookexternalhit|LinkedInBot|Slackbot|TelegramBot|WhatsApp|DuckDuckBot|Applebot|curl|wget|python-requests|node-fetch|HeadlessChrome|monitor|uptime/i.test(ua);
      // Microsoft 365 SafeLinks scanner detection (added 2026-06-02).
      // SafeLinks fetches the URL from a sandboxed Chromium with a regular
      // Chrome UA (no "Outlook"/"MSOffice" marker) — it slips past the UA-only
      // preview rule. Country-of-origin is the only server-visible tell:
      // Microsoft's EU tenant runs out of Dublin so opens from IE arriving
      // seconds after a Norwegian-targeted send are the scanner, not a reader.
      // Three same-minute "human" opens from IE today (AutoSock 6636b5e6 11:02,
      // Zaptec jrwfdkev 09:38, Fjord Tours 3be49647 06:36) triggered premature
      // E2 tasks before any human could possibly have read the email.
      // Conservative rule: IE country + generic Mozilla UA + non-bot → preview.
      // Edge case (Irish prospect viewing legitimately): false-negative is
      // recoverable on the third open via the existing humanCount===3 alert.
      const isM365ScannerIE = !isBot && country === "IE" &&
        /Mozilla\\/5\\.0/.test(ua) &&
        !/GoogleImageProxy|YahooMailProxy|MSOffice|Outlook|Microsoft Office|Apple-Mail|AppleMail|ProtonMail|Superhuman|Mailchimp|MailerLite|Litmus/i.test(ua);
      // Send-timestamp scanner detection (added 2026-06-02, generalized from IE-only rule).
      // Any email scanner (M365, Proofpoint, Mimecast, etc.) opens URLs within
      // seconds of delivery — before a human can read the email. 90s threshold
      // is country-agnostic: catches scanners we don't know about. Fallback:
      // if send-ts is missing, isM365ScannerIE still catches IE-origin opens.
      // Precedent: Devold 6895d11a (NO/Chrome, 27s) — country rule missed it,
      // send-ts would have caught it. KV key 'send:<hash>' written by send-email.ts.
      let isSendTimeScanner = false;
      if (!isBot && env && env.CLICK_LOG) {
        try {
          const sendData = await env.CLICK_LOG.get(\`send:\${h}\`, "json") as { ts?: number } | null;
          if (sendData && typeof sendData.ts === "number" && (ts - sendData.ts) < 90000) {
            isSendTimeScanner = true;
          }
        } catch (_) { /* KV read failure — classify unknown, not scanner */ }
      }
      const isPreview = !isBot && (
        /GoogleImageProxy|YahooMailProxy|MSOffice|Outlook|Microsoft Office|Apple-Mail|AppleMail|ProtonMail|Superhuman|Mailchimp|MailerLite|Litmus/i.test(ua) ||
        isM365ScannerIE ||
        isSendTimeScanner
      );
      const isHuman = !isBot && !isPreview;

      console.log(\`[TRACK] h=\${h} bot=\${isBot} preview=\${isPreview} sendTimeScan=\${isSendTimeScanner} scannerIE=\${isM365ScannerIE} country=\${country} ua=\${ua.substring(0,80)} ref=\${ref.substring(0,80)}\`);

      if (env && env.CLICK_LOG) {
        try {
          const viewKey = \`view:\${h}:\${ts}\`;
          const viewVal = JSON.stringify({
            h, ts, country,
            ua: ua.substring(0, 200),
            ref: ref.substring(0, 200),
            ip,
            kind: isBot ? "bot" : isPreview ? "preview" : "human",
          });
          await env.CLICK_LOG.put(viewKey, viewVal, { expirationTtl: 7776000 }); // 90 days

          const statsKey = \`view-stats:\${h}\`;
          const existing = (await env.CLICK_LOG.get(statsKey, "json")) || {
            count: 0, botCount: 0, previewCount: 0, humanCount: 0,
            first: 0, last: 0, firstHuman: 0, lastHuman: 0,
            countries: {},
          };
          existing.count = (existing.count || 0) + 1;
          existing.last = ts;
          if (!existing.first) existing.first = ts;
          if (isBot) {
            existing.botCount = (existing.botCount || 0) + 1;
          } else if (isPreview) {
            existing.previewCount = (existing.previewCount || 0) + 1;
          } else {
            existing.humanCount = (existing.humanCount || 0) + 1;
            existing.lastHuman = ts;
            if (!existing.firstHuman) existing.firstHuman = ts;
          }
          existing.countries[country] = (existing.countries[country] || 0) + 1;
          await env.CLICK_LOG.put(statsKey, JSON.stringify(existing));

          // Hot-prospect admin alert: first human view (just opened) and
          // third human view (engaged). Sent via Resend to hei@synligdigital.no
          // because the worker has no TELEGRAM secrets (telegram.env not in
          // /workspace/.secrets — deploy.ts strips the binding). Fire-and-forget;
          // pixel response must not block on Resend latency.
          if (isHuman && (existing.humanCount === 1 || existing.humanCount === 3)) {
            const level = existing.humanCount === 1 ? "👀 Rapport åpnet" : "🔥 HOT (3 åpninger)";
            const subject = \`\${level} — /r/\${h}\`;
            const body = \`<div style="font-family:system-ui;padding:20px;max-width:600px">
<h2>\${level}</h2>
<p><strong>Hash:</strong> <a href="https://synligdigital.no/r/\${h}">\${h}</a><br>
<strong>Mennesker:</strong> \${existing.humanCount} · <strong>Email-preview:</strong> \${existing.previewCount} · <strong>Bot:</strong> \${existing.botCount}<br>
<strong>Land:</strong> \${country}<br>
<strong>UA:</strong> <code>\${ua.substring(0, 200)}</code><br>
<strong>Første åpning:</strong> \${new Date(existing.firstHuman).toISOString().substring(0, 16).replace("T", " ")} UTC</p>
<p><a href="https://synligdigital.no/r/\${h}">Åpne rapport</a> · <a href="https://synligdigital.no/report-views?key=pico2026">Full oversikt</a></p>
<p style="color:#64748b;font-size:13px">\${existing.humanCount === 1 ? "Første åpning — vurder personlig E2 follow-up i opus i morgen." : "Tredje åpning — send personlig E2 NÅ. Hot prospect."}</p>
</div>\`;
            if (env.RESEND_API_KEY) {
              // Awaited — fire-and-forget would be cancelled when the pixel
              // response is sent (no ctx.waitUntil in this handler signature).
              try {
                const resendResp = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": \`Bearer \${env.RESEND_API_KEY}\`,
                  },
                  body: JSON.stringify({
                    from: "Synlig Digital <hei@synligdigital.no>",
                    to: ["hei@synligdigital.no"],
                    subject,
                    html: body,
                  }),
                });
                if (!resendResp.ok) {
                  const errText = await resendResp.text().catch(() => "");
                  console.error(\`[hot-prospect-resend] HTTP \${resendResp.status} — \${errText.substring(0, 200)}\`);
                }
              } catch (err) {
                console.error(\`[hot-prospect-resend] \${err instanceof Error ? err.message : String(err)}\`);
              }
            } else {
              console.log(\`[HOT-PROSPECT-FALLBACK] \${subject}\`);
            }
          }
        } catch (e) {
          console.error(\`[track-kv] \${e instanceof Error ? e.message : String(e)}\`);
        }
      }

      const gifBytes = Uint8Array.from(atob(TRACKING_GIF_B64), c => c.charCodeAt(0));
      return new Response(gifBytes, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Report-view admin: GET /report-views?key={admin_key}
    // Shows per-hash open rates so opus E2 follow-ups can target engaged
    // prospects. Counterpart to /clicks (which tracks /click?h=X link clicks);
    // this one tracks /r/HASH page renders via the embedded tracking pixel.
    if (pathname === "/report-views") {
      const key = url.searchParams.get("key");
      if (key !== "pico2026") {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!env || !env.CLICK_LOG) {
        return new Response("KV not configured", { status: 503 });
      }

      // Per-hash aggregates, sorted by lastHuman (most recent engagement first).
      const statsList = await env.CLICK_LOG.list({ prefix: "view-stats:", limit: 1000 });
      const aggregates = [];
      for (const item of statsList.keys) {
        const stats = await env.CLICK_LOG.get(item.name, "json");
        if (stats) {
          aggregates.push({ hash: item.name.replace("view-stats:", ""), ...stats });
        }
      }
      aggregates.sort((a, b) => (b.lastHuman || 0) - (a.lastHuman || 0));

      const rows = aggregates.map((a) => {
        const lastHumanDate = a.lastHuman ? new Date(a.lastHuman).toISOString().substring(0, 16).replace("T", " ") : "—";
        const firstHumanDate = a.firstHuman ? new Date(a.firstHuman).toISOString().substring(0, 16).replace("T", " ") : "—";
        const topCountries = Object.entries(a.countries || {}).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => \`\${k}:\${v}\`).join(" ");
        const hot = (a.humanCount || 0) >= 3 ? " style=\\"background:#7f1d1d;color:#fee\\"" : (a.humanCount || 0) >= 1 ? " style=\\"background:#1e3a8a;color:#dbeafe\\"" : "";
        return \`<tr\${hot}><td><a href="/r/\${a.hash}" style="color:#38bdf8">\${a.hash}</a></td><td>\${a.humanCount || 0}</td><td>\${a.previewCount || 0}</td><td>\${a.botCount || 0}</td><td>\${firstHumanDate}</td><td>\${lastHumanDate}</td><td>\${topCountries}</td></tr>\`;
      }).join("");

      // Last 50 view events.
      const viewList = await env.CLICK_LOG.list({ prefix: "view:", limit: 50 });
      const eventRows = [];
      for (const item of viewList.keys.reverse()) {
        const v = await env.CLICK_LOG.get(item.name, "json");
        if (v) {
          const date = new Date(v.ts).toISOString().substring(0, 16).replace("T", " ");
          const uaShort = (v.ua || "").substring(0, 60);
          eventRows.push(\`<tr><td>\${date}</td><td><a href="/r/\${v.h}" style="color:#38bdf8">\${v.h}</a></td><td>\${v.kind}</td><td>\${v.country}</td><td title="\${v.ua}">\${uaShort}</td></tr>\`);
        }
      }

      const html = \`<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><title>Synlig — Rapport-åpninger</title>
<style>body{font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0}table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:14px}th,td{padding:.5rem 1rem;text-align:left;border:1px solid #334155}th{background:#1e293b}tr:hover{filter:brightness(1.2)}h2{color:#38bdf8}a{color:#38bdf8}.legend{font-size:13px;color:#94a3b8}</style></head>
<body><h1>Rapport-åpninger</h1>
<p class="legend">Blå rad = 1+ menneske-åpning. Rød rad = 3+ menneske-åpninger (hot prospect — send opus E2).</p>
<h2>Per rapport (sortert etter siste menneske-åpning)</h2>
<table><tr><th>Hash</th><th>Mennesker</th><th>Email-preview</th><th>Bot</th><th>Første åpning</th><th>Siste åpning</th><th>Top land</th></tr>\${rows}</table>
<h2>Siste 50 events</h2>
<table><tr><th>Tid</th><th>Hash</th><th>Type</th><th>Land</th><th>UA</th></tr>\${eventRows.join("")}</table>
</body></html>\`;

      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // Self-service AEO audit: GET /audit or GET /audit?url=...
    if (pathname === "/audit" || pathname === "/audit/") {
      return handleAuditRequest(request, env);
    }

    // Tredjepartsverifisert agent-readiness: GET /bevis/agent-readiness[?url=X]
    // Renders Cloudflare's isitagentready.com scan result for synligdigital.no
    // (or any ?url=) inside our brand context. Replaces the broken "Verifiser →"
    // link that pointed at isitagentready.com (no ?url= pre-fill — verified
    // 2026-05-27). 101 patched reports + the homepage hero-strip carried that
    // dead-end link; this route is the canonical replacement. Source:
    // bevis-handler.ts. Cached in CLICK_LOG KV for 1h per URL.
    if (pathname === "/bevis/agent-readiness" || pathname === "/bevis/agent-readiness/") {
      return handleBevisRequest(request, env);
    }

    // Lead capture: POST /api/lead-capture (email + tier + slug)
    // Validates email, persists lead:<sha1>:<ts> marker, mints a 5-min one-time
    // KV handoff token, then 302s to the matching checkout endpoint with
    // ?lead=<token>. Each checkout reads & deletes the token, prefills Stripe
    // customer_email. Email never enters URLs/browser history.
    // Source: checkout-handler.ts → handleLeadCapture.
    if ((pathname === "/api/lead-capture" || pathname === "/api/lead-capture/") && request.method === "POST") {
      return handleLeadCapture(request, env);
    }

    // Tier 0 — GET /api/lite-checkout?slug=<attribution>
    // 990 NOK one-off Synlig Lite FAQPage AEO. Lowest entry-tier, impulse-buy zone.
    // Source: checkout-handler.ts. Wired 2026-06-05 alongside Lite tier launch
    // (task 968c7746aa0eec7d) — tests price hypothesis after 76d at 4900 NOK
    // floor produced 0 external conversions.
    if (pathname === "/api/lite-checkout") {
      return handleLiteCheckout(request, env);
    }

    // Stripe Checkout entry: GET /api/handlingsplan-checkout?slug=<attribution>[&lead=<token>]
    // Creates a Stripe Checkout Session (live 4 900 NOK Synlig Handlingsplan AEO)
    // and 302-redirects to session.url. Source: checkout-handler.ts.
    if (pathname === "/api/handlingsplan-checkout") {
      return handleCheckoutRequest(request, env);
    }

    // Tier 2 — GET /api/fundament-checkout?slug=<attribution>
    // 14 900 NOK single-payment Synlig Fundament AEO. Source: checkout-handler.ts.
    // Wired 2026-05-20 after dogfood revealed missing router case (handler existed
    // but was unimported); /priser shipped same day referenced this route.
    if (pathname === "/api/fundament-checkout") {
      return handleFundamentCheckout(request, env);
    }

    // Tier 3 — GET /api/lopende-checkout?slug=<attribution>
    // 4 900 NOK/mnd recurring subscription, Synlig Løpende overvåking AEO.
    // Source: checkout-handler.ts. Wired 2026-05-20 (same dogfood fix as Tier 2).
    if (pathname === "/api/lopende-checkout") {
      return handleLopendeCheckout(request, env);
    }

    // Stripe webhook: POST /api/stripe-webhook
    // Verifies signature, persists order to KV, fires Telegram notification.
    if (pathname === "/api/stripe-webhook" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    // Faktura form submit: POST /faktura
    // Replaces broken mailto: CTAs on /priser with a structured capture form.
    // GET /faktura is served from the routes map below (static HTML).
    // Source: faktura-handler.ts. KV: FAKTURA_ORDERS. Email: Resend.
    if ((pathname === "/faktura" || pathname === "/faktura/" || pathname === "/faktura.html") && request.method === "POST") {
      return handleFakturaSubmit(request, env);
    }

    // Brreg autocomplete proxy: GET /api/brreg-search?q=<navn>|domain=<host>
    // Same-origin proxy to data.brreg.no for the /faktura org.nr autocomplete.
    // CSP \`connect-src 'self'\` on /faktura forbids direct client-side fetches
    // to Brreg, so we proxy through here. Edge-cached 1h.
    // Why this exists: removes the largest friction in the faktura form — the
    // 9-digit org.nr lookup. Avo CEO clicked the faktura CTA on 2026-05-25
    // 15:14 but never submitted; the orgnr field is the most likely abandon
    // trigger. Source: brreg-handler.ts.
    if (pathname === "/api/brreg-search") {
      return handleBrregSearch(request);
    }

    // Order confirmation page: GET /takk-for-bestilling?session_id=<cs_...>&slug=<...>
    if (pathname === "/takk-for-bestilling" || pathname === "/takk-for-bestilling/") {
      return handleTakkPage(request, env);
    }

    // Path-shorthand redirects — typing-pattern conversion repair (2026-05-23 idle audit).
    // Both paths were 404ing despite being the natural URL a prospect types when
    // they hear "sjekk din score på Synlig" or "kontakt Synlig Digital".
    // /sjekk → the AEO audit subdomain app; /kontakt → homepage anchor section.
    // 301 (permanent) because the canonical surface is stable; cached 1 day so the
    // redirect cost is paid once per browser per day, not per click.
    if (pathname === "/sjekk" || pathname === "/sjekk/") {
      return new Response(null, {
        status: 301,
        headers: { "Location": "https://sjekk.synligdigital.no/", "Cache-Control": "public, max-age=86400" },
      });
    }
    if (pathname === "/kontakt" || pathname === "/kontakt/") {
      return new Response(null, {
        status: 301,
        headers: { "Location": "https://synligdigital.no/#kontakt", "Cache-Control": "public, max-age=86400" },
      });
    }

    // AEO Report hosting: GET /r/{hash}
    if (pathname.startsWith("/r/")) {
      const hash = pathname.slice(3); // Remove /r/
      // Defensive: refuse empty-hash requests. /r/ (no segment) must 404,
      // never return REPORTS[""]. Paired with the build.ts filter that skips
      // any reports/.html file. See note above re: 877cd9b Pierstop leak.
      if (!hash) {
        return new Response("Rapport ikke funnet", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      const reportHtml = REPORTS[hash];
      if (reportHtml) {
        // Inject Open Graph meta tags so /r/{hash} links rendered in
        // Slack/Teams/email show a preview card (title + image + description)
        // instead of a bare URL. Helper is response-time, not build-time, so
        // the 157 static report files stay untouched. See injectReportOg above.
        const html = injectReportOg(reportHtml, request);
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store", // Always fresh for prospects
            ...SECURITY_HEADERS,
          },
        });
      }
      return new Response("Rapport ikke funnet", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const route = routes[pathname];
    if (route) {
      // Markdown content negotiation — Cloudflare "Agent-Readable" Level 3 check.
      // When an agent sends Accept: text/markdown, return the markdown variant
      // for HTML routes that have one. Browsers (Accept: text/html) keep getting
      // HTML. The homepage maps to /context.md (company overview), priser pages
      // map to /priser.md, and the rest fall back to context.md as a useful
      // machine-readable summary. The check at isitagentready.com tests "/" only.
      // History: 2026-05-27 — synligdigital.no scored Level 2 (Bot-Aware) until
      // this was added. After deploy: Level 3 (Agent-Readable).
      // Spec: https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
      const accept = request.headers.get("Accept") || "";
      const wantsMarkdown = /text\\/markdown/i.test(accept) &&
        // Don't downgrade if HTML is explicitly preferred (q-value comparison).
        // Simple heuristic: if text/html quality > text/markdown quality, serve HTML.
        // CF scanner sends just "text/markdown" with no html — so this triggers.
        !/text\\/html\\s*;?\\s*q=1/i.test(accept);
      if (wantsMarkdown && route.contentType.includes("text/html")) {
        let mdBody: string;
        if (pathname === "/priser" || pathname === "/priser/" || pathname === "/priser.html") {
          mdBody = PRISER_MD;
        } else {
          mdBody = CONTEXT_MD;
        }
        return new Response(mdBody, {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Vary": "Accept",
            ...SECURITY_HEADERS,
            ...CACHE_HEADERS,
          },
        });
      }
      // Link headers on homepage — Cloudflare "linkHeaders" check (Discoverability).
      // Points at the agent-card, sitemap, MCP server card, and skills index so
      // agents can discover us in one round-trip from the homepage HEAD/GET.
      const extraHeaders: Record<string, string> = {};
      if (pathname === "/" || pathname === "/index.html") {
        extraHeaders["Link"] = [
          '<https://synligdigital.no/.well-known/agent-card.json>; rel="describedby"; type="application/json"',
          '<https://synligdigital.no/.well-known/mcp.json>; rel="https://modelcontextprotocol.io/rel/server-card"; type="application/json"',
          '<https://synligdigital.no/.well-known/agent-skills/index.json>; rel="https://agentskills.io/rel/index"; type="application/json"',
          '<https://synligdigital.no/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
          '<https://synligdigital.no/sitemap.xml>; rel="sitemap"; type="application/xml"',
          '<https://synligdigital.no/llms.txt>; rel="alternate"; type="text/plain"',
          '<https://synligdigital.no/context.md>; rel="alternate"; type="text/markdown"',
        ].join(", ");
        extraHeaders["Vary"] = "Accept";
      }
      return new Response(route.body, {
        status: 200,
        headers: {
          "Content-Type": route.contentType,
          ...SECURITY_HEADERS,
          ...CACHE_HEADERS,
          ...extraHeaders,
        },
      });
    }

    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...SECURITY_HEADERS,
      },
    });
  },
};
`;

await Bun.write("/workspace/synlig-worker/worker.ts", worker);
console.log("Worker generated successfully");
console.log(`Size: ${worker.length} bytes`);
