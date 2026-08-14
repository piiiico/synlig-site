// Reads static files from /workspace/synlig-site/ and generates
// /workspace/synlig-worker/worker.ts with embedded content.
// Also loads AEO reports from /workspace/synlig-site/reports/ for /r/{hash} routing.
//
// CANONICAL SOURCE for /workspace/synlig-worker/worker.ts. Single-writer
// invariant enforced below ("DUPLICATE-WRITER GUARD"). If you need to add
// a route, edit this file — do NOT create a second build script.

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, basename, resolve } from "path";
import { applyMarkers, MID_MARKER, BOTTOM_MARKER, LEAD_CAPTURE_PATH, CHECKOUT_HREF_PREFIX, MAILTO_PREFIX, LIVE_PRICE_ANCHORS, type Stage } from "./_partials/render-audit-cta";
import { runFactSourceGate } from "./_partials/fact-source-gate";
import { runMetodeMeasureGate } from "./_partials/metode-measure-gate";
import { runEnPriceCorpusGate, faktura_EN_SURFACE, fakturaConfirmation_EN_SURFACE } from "./_partials/en-price-gate";
import { runNamingProofGate } from "./_partials/naming-proof";
import { checkEnCitedHowTo } from "./_partials/en-cited-howto";
import { stripHtmlComments, STRIP_KEEP_PREFIXES } from "./_partials/strip-html-comments";
import { injectLegalIdentity, hasFooter, LEGAL_MARKER, LEGAL, DEAD_POSTAL_CODES } from "./_partials/legal-identity";

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

// applyBlogCta: load a blog post from the ASTRO ARTIFACT, replace AUDIT-CTA
// markers with rendered partial HTML (stage-aware). Fails the build if markers
// are missing or stage is unmapped.
//
// fase 3 (2026-08-09): the source moved to src/content/blogg/<slug>.html (an
// Astro content collection) and the page that ships is dist/blogg/<slug>/
// index.html. The markers live in the collection fragment and survive the
// Astro render untouched, so the substitution still happens here — after
// astro build, before every gate. Reading src/ instead would ship a page with
// no chrome; reading dist/ is reading the artifact that actually goes out.
function distBlogPath(slug: string): string {
  return `/workspace/synlig-site/dist/blogg/${slug}/index.html`;
}
async function applyBlogCta(slug: string): Promise<string> {
  const absPath = distBlogPath(slug);
  const f = Bun.file(absPath);
  if (!(await f.exists())) {
    console.error(`\n[BUILD FAIL] astro did not emit ${absPath}.`);
    console.error(`Source should be /workspace/synlig-site/src/content/blogg/${slug}.html`);
    console.error(`Route:  /workspace/synlig-site/src/pages/blogg/[slug].astro`);
    process.exit(1);
  }
  const raw = await f.text();

  const stage = STAGES[slug];
  if (!stage) {
    console.error(`\n[BUILD FAIL] No stage classified for blog post slug "${slug}".`);
    console.error(`Add it to /workspace/synlig-site/_partials/blog-stages.json under "stages".`);
    process.exit(1);
  }
  const { html, errors } = applyMarkers(slug, raw, stage);
  if (errors.length > 0) {
    console.error(`\n[BUILD FAIL] audit-cta markers invalid in blogg/${slug}:`);
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

// ─────────────────────────────────────────────────────────────────────────────
// ASTRO STEP — the front page is built from src/pages/index.astro (fase 2 of
// the redesign, 2026-08-08). It runs HERE, inside the single canonical build,
// rather than as a separate command someone has to remember: dist/ is
// gitignored and skipped by the stale-bundle checker, so a "run astro first"
// convention would re-open exactly the stale-artifact bug this repo already
// ate twice (2026-05-20, 2026-06-15).
//
// Astro writes ONLY to synlig-site/dist/. It never touches worker.ts — the
// DUPLICATE-WRITER GUARD above still holds.
// ─────────────────────────────────────────────────────────────────────────────
{
  const t0 = Date.now();
  const astro = Bun.spawnSync({
    cmd: ["bunx", "astro", "build"],
    cwd: "/workspace/synlig-site",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (astro.exitCode !== 0) {
    console.error(`\n[BUILD FAIL] astro build exited ${astro.exitCode}.`);
    console.error(astro.stdout.toString());
    console.error(astro.stderr.toString());
    console.error(`\nFront page source: /workspace/synlig-site/src/pages/index.astro`);
    console.error(`Fix: cd /workspace/synlig-site && bun install && bunx astro build`);
    process.exit(1);
  }
  console.log(`  astro: dist/ rebuilt in ${Date.now() - t0}ms (front page + 36 blog posts + /blogg + 3 case pages)`);
}

const files = {
  // Front page: Astro output. The hand-written root index.html was deleted
  // 2026-08-08 so "/" has exactly one source of truth.
  INDEX_HTML: await Bun.file("/workspace/synlig-site/dist/index.html").text(),
  // /metode — Astro-side, lagt til 2026-08-09 (redesign-planen §5, prioritet 3):
  // protokoll + «hva vi ikke påstår», for kjøperen som skal si nei på faglig
  // grunnlag. Fire wiring-steder for enhver ny side, alle må gjøres samtidig:
  // (1) denne fil-lastingen, (2) const-deklen i den genererte workeren,
  // (3) routes-oppføringene, (4) sitemap.xml.
  METODE_HTML: await Bun.file("/workspace/synlig-site/dist/metode/index.html").text(),
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
  KOMPLETT_AEO_HTML: await Bun.file("/workspace/synlig-site/dist/case/komplett-aeo/index.html").text(),
  NORDIC_LITHIUM_CASE_HTML: await Bun.file("/workspace/synlig-site/dist/case/nordic-lithium/index.html").text(),
  EN_CASE_NORDIC_LITHIUM_HTML: await Bun.file("/workspace/synlig-site/en-case-nordic-lithium.html").text(),
  EN_BLOG_HTML: await Bun.file("/workspace/synlig-site/en-blog.html").text(),
  EN_BLOG_LLM_SMELL_CHECK_BENCHMARK_HTML: await Bun.file("/workspace/synlig-site/en-blog-llm-smell-check-benchmark.html").text(),
  EN_BLOG_AEO_DIGITAL_ASSETS_HTML: await Bun.file("/workspace/synlig-site/en-blog-aeo-digital-assets.html").text(),
  EN_BLOG_AEO_AGENCY_NORWAY_HTML: await Bun.file("/workspace/synlig-site/en-blog-aeo-agency-norway.html").text(),
  EN_BLOG_VISIBILITY_PARADOX_HTML: await Bun.file("/workspace/synlig-site/en-blog-visibility-paradox.html").text(),
  EN_BLOG_AGENTJACKING_AI_TRUST_HTML: await Bun.file("/workspace/synlig-site/en-blog-agentjacking-and-ai-trust.html").text(),
  PIERSTOP_CASE_HTML: await Bun.file("/workspace/synlig-site/dist/case/pierstop/index.html").text(),
  PICO_PAGE_HTML: await Bun.file("/workspace/synlig-site/pico.html").text(),
  AGENT_CARD_JSON: await Bun.file("/workspace/synlig-site/agent-card.json").text(),
  BLOGG_INDEX_HTML: await Bun.file("/workspace/synlig-site/dist/blogg/index.html").text(),
  BLOGG_HVA_ER_AEO_HTML: await applyBlogCta("hva-er-aeo"),
  BLOGG_AEO_I_NORGE_2026_HTML: await applyBlogCta("aeo-i-norge-2026"),
  BLOGG_NORSK_AEO_BENCHMARK_2026_HTML: await applyBlogCta("norsk-aeo-benchmark-2026"),
  BLOGG_MCP_SECURITY_MARCH_2026_HTML: await applyBlogCta("mcp-security-march-2026"),
  BLOGG_AEO_BYRA_NORGE_HTML: await applyBlogCta("aeo-byra-norge"),
  BLOGG_LOKAL_AI_SYNLIGHET_HTML: await applyBlogCta("lokal-ai-synlighet"),
  BLOGG_SLIK_BLIR_DU_SYNLIG_I_CHATGPT_HTML: await applyBlogCta("slik-blir-du-synlig-i-chatgpt"),
  BLOGG_CAVEMAN_AI_PRICING_APRIL_2026_HTML: await applyBlogCta("caveman-ai-pricing-april-2026"),
  BLOGG_ER_NETTSIDA_DI_KLAR_HTML: await applyBlogCta("er-nettsida-di-klar-for-ai-agentar"),
  BLOGG_STAVANGER_AGENT_BEREDSKAP_HTML: await applyBlogCta("stavanger-agent-beredskap-april-2026"),
  BLOGG_HVA_ER_AEO_GUIDE_HTML: await applyBlogCta("hva-er-aeo-guide"),
  BLOGG_AEO_VS_SEO_HTML: await applyBlogCta("aeo-vs-seo"),
  RAPPORT_STATE_AEO_2026_HTML: await Bun.file("/workspace/synlig-site/rapport/state-of-aeo-2026.html").text(),
  // Note: /tjenester/aeo-for-* verticals are loaded via VERTICAL_LANDINGS registry above (verticalFiles).
  TJENESTER_INDEX_HTML: await Bun.file("/workspace/synlig-site/tjenester/index.html").text(),
  TJENESTER_AEO_HTML: await Bun.file("/workspace/synlig-site/tjenester/aeo.html").text(),
  TJENESTER_DIGITAL_MARKEDSFORING_STAVANGER_HTML: await Bun.file("/workspace/synlig-site/tjenester/digital-markedsforing-stavanger.html").text(),
  BLOGG_DIGITAL_MARKEDSFORING_STAVANGER_HTML: await applyBlogCta("digital-markedsforing-stavanger"),
  BLOGG_CHATGPT_ANNONSER_OG_AEO_HTML: await applyBlogCta("chatgpt-annonser-og-aeo-april-2026"),
  BLOGG_AUTOMATISERT_AEO_VS_RADGIVING_HTML: await applyBlogCta("automatisert-aeo-vs-radgiving"),
  BLOGG_STAVANGER_KLINIKK_AEO_ANALYSE_HTML: await applyBlogCta("stavanger-klinikk-aeo-analyse"),
  BLOGG_NORGES_AEO_LEADERBOARD_2026_04_HTML: await applyBlogCta("norges-aeo-leaderboard-2026-04"),
  BLOGG_EU_AI_ACT_NORSKE_BEDRIFTER_HTML: await applyBlogCta("eu-ai-act-norske-bedrifter"),
  BLOGG_AEO_BUDSJETT_45X_HTML: await applyBlogCta("aeo-budsjett-45x-okonomi"),
  BLOGG_AEO_SJEKKLISTE_2026_HTML: await applyBlogCta("aeo-sjekkliste-2026"),
  BLOGG_GA4_AI_ASSISTANT_2026_HTML: await applyBlogCta("ga4-ai-assistant-2026"),
  BLOGG_CHATGPT_KONVERTERER_9X_HTML: await applyBlogCta("chatgpt-konverterer-9x"),
  BLOGG_GOOGLE_SOK_REDESIGN_MAI_2026_HTML: await applyBlogCta("google-sok-redesign-mai-2026"),
  BLOGG_90_PROSENT_USYNLIGE_HTML: await applyBlogCta("90-prosent-usynlige-i-ai-sok"),
  BLOGG_GOOGLE_SPAM_POLICY_AEO_HTML: await applyBlogCta("google-spam-policy-aeo-mai-2026"),
  BLOGG_93_PROSENT_AI_MODE_NULL_KLIKK_HTML: await applyBlogCta("93-prosent-ai-mode-null-klikk"),
  BLOGG_AI_PRODUKSJON_RELIABILITY_GAP_HTML: await applyBlogCta("ai-produksjon-reliability-gap"),
  BLOGG_ROBINHOOD_AI_AGENTER_HTML: await applyBlogCta("robinhood-ai-agenter-norske-merkevarer"),
  BLOGG_VIBESEC_AI_GENERERT_KODE_HTML: await applyBlogCta("vibesec-ai-generert-kode-sikkerhet"),
  BLOGG_SOK_FRAGMENTERES_2026_HTML: await applyBlogCta("sok-fragmenteres-2026"),
  BLOGG_EY_FALSKE_AI_KILDER_HTML: await applyBlogCta("ey-falske-ai-kilder"),
  BLOGG_LLM_SMELLS_AEO_HTML: await applyBlogCta("llm-smells-aeo-synlighet"),
  BLOGG_CHECKOUT_AGENTIC_COMMERCE_TILLIT_GAP_HTML: await applyBlogCta("checkout-agentic-commerce-tillit-gap-2026"),
  BLOGG_GOOGLE_SEARCH_PROFILES_61_HTML: await Bun.file("/workspace/synlig-site/dist/blogg/google-search-profiles-61-prosent-ctr-fall/index.html").text(),
  BLOGG_AEO_LITE_FAQPAGE_HTML: await Bun.file("/workspace/synlig-site/dist/blogg/aeo-lite-faqpage-990-kr/index.html").text(),
  BLOGG_B2B_FINTECH_AGENT_HTML: await Bun.file("/workspace/synlig-site/dist/blogg/b2b-fintech-agent-discoverability/index.html").text(),
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

// ─────────────────────────────────────────────────────────────────────────────
// First-party visit beacon — site-wide injection.
//
// Why this block exists
// ─────────────────────
// 2026-05-24 → 2026-06-10: Cloudflare Web Analytics produced zero data
// account-wide. POST /cdn-cgi/rum returned 404 on the live beacon for both
// getcommit.dev AND synligdigital.no — 17 days of silent zero. The 09:18Z
// replacement on poc-backend (POST /api/v1/visit + GET /api/v1/visits/stats
// + pageviews D1 table) closed the gap for getcommit.dev only; synligdigital.no
// was named in the incident note but never wired up. Symptom: the outreach
// machine sends 30+ E2/E3/E4 messages per day but the operator has zero
// visibility into which prospects land, which UTM campaigns convert, or
// which pages convince. That blindness compounds — pricing-friction-v1
// 30-day measurement (task 05b4b20aa57ddd09) is due 2026-06-20 and would
// have produced "0 visits" for half the traffic the operator cares about.
//
// What this does
// ──────────────
// Walk every *_HTML entry in `files`, find `</head>`, inject the same
// fire-and-forget beacon used in commit-landing-v2/src/layouts/Layout.astro.
// Single injection point covers every static surface (homepage, priser,
// faktura, blog, case pages, vertical landings, tjenester) — adding a new
// page requires no per-page wiring.
//
// Symmetry contract
// ─────────────────
// Beacon shape mirrors getcommit.dev's beacon exactly: same endpoint, same
// payload, same sendBeacon/fetch fallback, same text/plain content-type
// (sidesteps headless-chromium CORS preflight glitch 2026-06-10). Keep
// these in sync — drift here means /api/v1/visits/stats reads two slightly
// different datasets for one operator.
// ─────────────────────────────────────────────────────────────────────────────
const VISIT_BEACON_SCRIPT = `<script>
(function(){
  try {
    var url = new URL(window.location.href);
    var params = url.searchParams;
    var payload = {
      path: url.pathname,
      referrer: document.referrer || "",
      utm_source: params.get("utm_source") || undefined,
      utm_medium: params.get("utm_medium") || undefined,
      utm_campaign: params.get("utm_campaign") || undefined,
      utm_content: params.get("utm_content") || undefined,
      utm_term: params.get("utm_term") || undefined
    };
    Object.keys(payload).forEach(function(k){ if (payload[k] === undefined) delete payload[k]; });
    var endpoint = "https://poc-backend.amdal-dev.workers.dev/api/v1/visit";
    var body = JSON.stringify(payload);
    var blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) return;
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: body, keepalive: true, credentials: "omit" }).catch(function(){});
  } catch (e) {}
})();
</script>
`;

/**
 * Index of the `</head>` that actually terminates the <head> element.
 *
 * `src.replace("</head>", …)` hits the FIRST literal occurrence, and on this
 * site that is not always the real one: /blogg/aeo-lite-faqpage-990-kr sells
 * FAQPage markup, so one of its FAQ answers reads "limer du inn koden mellom
 * <head>...</head>" — inside a <script type="application/ld+json"> string, in
 * the head, ABOVE the real close. The beacon was therefore spliced into the
 * middle of the JSON, truncating it. Measured live 2026-08-09: that page served
 * an unterminated JSON-LD block, so its FAQPage — 7 Questions, 7 Answers, the
 * entire product the page sells — parsed as nothing for every crawler and
 * assistant. Found by pairing live JSON-LD against the new dist artifacts.
 *
 * Fix at the anchor rather than by escaping the prose: any future page that
 * quotes </head> (likely — we teach people to paste JSON-LD into their head)
 * would re-break otherwise. Script and style bodies are blanked length-
 * preservingly first, so offsets in the blanked copy are valid in the original.
 */
function headCloseIndex(html: string): number {
  const blanked = html
    .replace(/<script[\s\S]*?<\/script>/gi, (m) => " ".repeat(m.length))
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => " ".repeat(m.length));
  return blanked.indexOf("</head>");
}

function injectBeacon(record: Record<string, string>, predicate: (k: string) => boolean): { hit: number; skip: number } {
  let hit = 0, skip = 0;
  for (const key of Object.keys(record)) {
    if (!predicate(key)) continue;
    const src = record[key];
    // Idempotency guard — protects against build re-runs that don't reload from
    // disk (none currently exist, but cheap insurance against future regressions).
    if (src.includes("/api/v1/visit")) { skip++; continue; }
    // Require </head> — admin/utility pages without it (dashboard, etc.) are
    // tracked or not based on whether they're real user surfaces.
    const at = headCloseIndex(src);
    if (at === -1) { skip++; continue; }
    record[key] = src.slice(0, at) + VISIT_BEACON_SCRIPT + src.slice(at);
    hit++;
  }
  return { hit, skip };
}

const staticHit = injectBeacon(files as Record<string, string>, (k) => k.endsWith("_HTML"));
// Vertical landings live in their own map — same _HTML naming convention.
const verticalHit = injectBeacon(verticalFiles, (k) => k.endsWith("_HTML"));
console.log(`[build] visit-beacon injected into ${staticHit.hit + verticalHit.hit} HTML surface(s) (static=${staticHit.hit}/skip=${staticHit.skip}, vertical=${verticalHit.hit}/skip=${verticalHit.skip}).`);

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD PARSE GATE — every <script type="application/ld+json"> on every
// surface must be valid JSON, checked AFTER all injection steps.
//
// Why after: the structured data is correct in src/ and correct in dist/. It
// was the beacon injection that broke it, by splicing a <script> into the
// middle of a JSON string on the one page that quotes "</head>" in prose.
// A gate that ran on the source would have been green for the 60+ days that
// page shipped an unparseable FAQPage. Measure the artifact that ships.
//
// This is the whole point of the migration: JSON-LD is the citation surface.
// A block that does not parse is not degraded, it is absent — the assistant
// sees no FAQPage at all.
// ─────────────────────────────────────────────────────────────────────────────
{
  const LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const bad: string[] = [];
  let blocks = 0, surfaces = 0;
  for (const record of [files as Record<string, string>, verticalFiles]) {
    for (const [key, src] of Object.entries(record)) {
      if (!key.endsWith("_HTML") || typeof src !== "string") continue;
      surfaces++;
      LD_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LD_RE.exec(src)) !== null) {
        blocks++;
        try {
          JSON.parse(m[1]);
        } catch (e) {
          bad.push(`${key}: ${String(e).split("\n")[0]} — starts ${JSON.stringify(m[1].slice(0, 90))}`);
        }
      }
    }
  }
  // Minimum-expected-input floor: a regex that stops matching would report
  // "0 invalid" and pass. 39 migrated pages plus the front page and verticals
  // carried 100+ blocks at the time of the fase-3 port.
  if (blocks < 60) {
    console.error(`\n[BUILD FAIL] JSON-LD parse gate found only ${blocks} blocks across ${surfaces} surfaces (floor 60).`);
    console.error(`The extractor stopped matching — the gate is blind, not the site clean.`);
    process.exit(1);
  }
  if (bad.length > 0) {
    console.error(`\n[BUILD FAIL] ${bad.length} unparseable JSON-LD block(s) in the shipped artifact:`);
    for (const b of bad) console.error(`  - ${b}`);
    console.error(`\nMost likely cause: an injection step anchored on a literal string that also`);
    console.error(`appears inside JSON-LD prose (e.g. "</head>"). Fix the anchor, not the prose.`);
    process.exit(1);
  }
  console.log(`  ✅ JSON-LD parse gate: ${blocks} blocks across ${surfaces} surfaces, all valid.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PÅSTAND-MOT-PRIMÆRKILDE-PORT for måletabellen på /metode.
//
// Tredje gang samme klasse ryker på nøyaktig disse tallene, så dette er en
// kodeport, ikke enda et avsnitt prosa: 2026-08-06 sto case-sidens
// title/H1/lead igjen med den tilbaketrukne februar-påstanden; 2026-08-06/07
// ble ett-utvalgs-tallet «sitert i 3 av 5» sitert to ganger eksternt; og
// 2026-08-12 sto /metode med overskriften «To av fem svar holdt. Tre svingte.»
// rett over sin egen tabell der TRE rader var merket «Holdt i hver eneste
// kjøring». Porten leser de SERVERTE bytene og regner om fra primærkilden.
// Renderer: /workspace/synlig-site/_partials/metode-measure-gate.ts
// ─────────────────────────────────────────────────────────────────────────────
{
  const g = runMetodeMeasureGate(files.METODE_HTML, "dist/metode/index.html");
  if (g.violations.length > 0) {
    console.error(`\n[BUILD FAIL] /metode måletall stemmer ikke med primærkilden (${g.violations.length} avvik):`);
    for (const v of g.violations) console.error(`  - ${v}`);
    console.error(`\nPrimærkilde: /workspace/money/aeo/leaderboard-score-vs-citation-2026-08-08.json`);
    console.error(`Rader og overskrift REGNES UT i _partials/metode-measurements.ts — retter du et`);
    console.error(`tall i src/pages/metode.astro for hånd, er det feilen, ikke porten.`);
    process.exit(1);
  }
  console.log(`  ✅ /metode måletall-port: ${g.rows} rader avstemt mot primærkilden.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EN-PRISPORT — ett tall per produkt på flaten utenlandske kjøpere leser.
// 2026-08-13 ble kryss-grense-skinnen tatt i bruk utad (Ondo-E1: «USD 1,100»)
// mens /en/ kvoterte «NOK 9,900» ti steder — samme produkt, to tall, samme
// leser — og TIERS.lite.usd sto på 110 mot vår egen Stripe-skinne på 92.
// Porten regner tillatte strenger ut fra TIERS og feiler bygget på gaffel.
// Renderer: /workspace/synlig-site/_partials/en-price-gate.ts
// ─────────────────────────────────────────────────────────────────────────────
{
  // Omfanget utledes av NØKLENE i `files`, ikke av en håndholdt liste: hver
  // EN_*_HTML er en flate worker-en serverer, så en ny EN-side kommer inn i
  // porten i samme øyeblikk den kobles på. Porten globber i tillegg disk selv
  // og feiler hvis det finnes flere en*.html enn den fikk servert.
  //
  // MERK: dette kjører ETTER injectBeacon, altså på de bytene som faktisk
  // sendes til kjøperen — ikke på fila på disk. Forskjellen er ~750 byte per
  // side, og en port som leser disk sertifiserer noe ingen serverer.
  const served: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    if (/^EN_[A-Z0-9_]*HTML$/.test(k) && typeof v === "string") served[k] = v;
  }
  // /faktura er ikke en en*.html, men det er DER en utenlandsk kjøper faktisk
  // bestiller. 2026-08-14: hele en*.html-korpuset var grønt og deployet mens
  // ordresiden CTA-en peker på fortsatt svarte «NOK 9,900 excl. VAT». Én
  // bilingval fil, så bare de engelske blokkene sendes inn.
  served["faktura?lang=en"] = faktura_EN_SURFACE(files.FAKTURA_HTML);
  // ...og BEKREFTELSES-E-POSTEN. Tredje engelske pristabell, den ingen så på:
  // EN_PACKAGES i synlig-worker/faktura-handler.ts er kontraktsteksten kjøperen
  // får tilsendt ETTER at han har bestilt. Den kan ikke importere porten (fila
  // bundles inn i Cloudflare-workeren, porten leser node:fs), så kollapsen går
  // andre veien: porten leser tabellen og avstemmer den mot TIERS.
  served["faktura-bekreftelse?lang=en"] = fakturaConfirmation_EN_SURFACE(
    readFileSync("/workspace/synlig-worker/faktura-handler.ts", "utf-8"),
  );
  const g = runEnPriceCorpusGate(served);
  if (g.violations.length > 0) {
    console.error(`\n[BUILD FAIL] EN-flatens priser har gaflet seg fra TIERS (${g.violations.length} avvik):`);
    for (const v of g.violations) console.error(`  - ${v}`);
    console.error(`\nPrimærkilde: /workspace/bin/cross-border-invoice.ts → TIERS.`);
    console.error(`Retter du et tall i en HTML-fil for hånd uten å flytte TIERS, er det feilen, ikke porten.`);
    process.exit(1);
  }
  console.log(`  ✅ EN-prisport: ${g.prices} prisforekomster over ${g.files} flater avstemt mot TIERS.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EN-PRODUKTPORT — hva /en/ FORTELLER svarmotorene at vi selger.
//
// Prisporten over avstemmer TALLET. 2026-08-14 viste at det ikke er nok: da
// USD 1400 var rettet til 1100, beskrev den SAMME HowTo-noden fortsatt det
// nedlagte fire-stegs programmet (Implementation + Continuous monitoring,
// totalTime P14D) — altså en retainer vi ikke selger, matet til nøyaktig de
// motorene vi tar betalt for å bli sitert riktig i. Riktig pris, feil produkt.
// Kilde, invariant og begrunnelse: _partials/en-cited-howto.ts.
// Kjører på files.EN_HTML, altså etter injectBeacon — de bytene kjøperen får.
// ─────────────────────────────────────────────────────────────────────────────
{
  const v = checkEnCitedHowTo(files.EN_HTML, "/en/ (servert)");
  if (v.length > 0) {
    console.error(`\n[BUILD FAIL] EN-flatens HowTo beskriver ikke produktet vi selger (${v.length} avvik):`);
    for (const x of v) console.error(`  - ${x}`);
    console.error(`\nPrimærkilde: /workspace/synlig-site/_partials/en-cited-howto.ts`);
    process.exit(1);
  }
  console.log(`  ✅ EN-produktport: HowTo-noden på /en/ er identisk med _partials/en-cited-howto.ts.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVNGIVINGSPORT — 2026-08-14
//
// 28/28 og 20/28 ble publisert om morgenen og var innen kvelden håndskrevet på
// seks flater (forsidens hero, /tjenester#navngitt, blogg-CTA-en, patcheren for
// 193 rapportsider, /priser, og kommentarene i to av dem). To av flatene bar en
// kommentar som sa «endrer du tallet her, endrer du det der» — koplingen fantes
// bare som en beskjed til neste menneske. Det er den nøyaktige formen på
// /metode-saken 08-12 (åtte håndholdte påstandssteder → én utledet kilde) og på
// Komplett-saken, der overskriftslaget sto igjen med et tilbaketrukket tall.
//
// Kilden er nå _partials/naming-proof.ts. Porten fant sitt eget mønster ved å
// TELLE mot korpuset før den ble skrevet: ankerordet alene traff 208 av 305
// filer (base rate, ikke defekt), motornavnet i samme vindu tok det til 189
// med én falsk positiv (leaderboard.html, en robots.txt-linje), og merkenavnet
// som tredje ledd ga 188 og null falske. Hele målingen står i fila.
//
// MERK at denne kommentaren med vilje IKKE staver ut tallparet sammen med de
// tre ankerordene: da ville build.ts selv blitt talt som en bevisflate, og en
// historisk merknad om hva som ble målt i august ville feilet porten den dagen
// tallet med rette endrer seg. En port skal lese produktet, ikke sin egen logg.
// ─────────────────────────────────────────────────────────────────────────────
{
  const n = runNamingProofGate();
  if (n.violations.length > 0) {
    console.error(`\n[BUILD FAIL] navngivingsbeviset har gaflet seg (${n.violations.length} avvik):`);
    for (const v of n.violations) console.error(`  - ${v.file}: ${v.claim || v.why}`);
    console.error(`\nPrimærkilde: /workspace/synlig-site/_partials/naming-proof.ts → NAMING_PROOF.`);
    console.error(`Endre tallet DER, kjør bygget, og porten viser deg hver flate som henger igjen.`);
    console.error(`Kjøpsreisens tre flater (forside, /priser, /tjenester#navngitt) MÅ bære beviset.`);
    process.exit(1);
  }
  console.log(`  ✅ Navngivingsport: ${n.claimFiles} bevisflater av ${n.scanned} filer enige med NAMING_PROOF.`);
}

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
//   2. Every blog post must surface at least one LIVE paid-price anchor.
//      History: 2026-05-19 — blog layer surfaced only free-audit CTA; pricing
//      anchor lived only at /sjekk thank-you + cold emails. Buyers researching
//      on the blog never saw a buy path. This gate enforces blog-layer parity.
//      2026-08-12 — the gate hard-coded "4 900 NOK", so when that tier was
//      discontinued the gate demanded the dead price on all 36 posts: it had
//      stopped enforcing "a buyer sees a price" and started enforcing "a buyer
//      sees THIS price". Anchors now come from LIVE_PRICE_ANCHORS in the
//      renderer — the single writer of the copy being checked — and the list
//      is itself checked against that file's source below.
//   3. Markers must NOT survive into rendered output (would indicate render failure).
// fase 3: the blog SOURCE is the content collection. Both the CTA-coverage
// gate (which files must exist in the files map) and the fact-source gate read
// from here; the rendered artifact they check is still dist/.
const bloggDir = "/workspace/synlig-site/src/content/blogg";
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
  "checkout-agentic-commerce-tillit-gap-2026.html": files.BLOGG_CHECKOUT_AGENTIC_COMMERCE_TILLIT_GAP_HTML,
  "google-search-profiles-61-prosent-ctr-fall.html": files.BLOGG_GOOGLE_SEARCH_PROFILES_61_HTML,
  "aeo-lite-faqpage-990-kr.html": files.BLOGG_AEO_LITE_FAQPAGE_HTML,
  "b2b-fintech-agent-discoverability.html": files.BLOGG_B2B_FINTECH_AGENT_HTML,
};
// Self-check the gate's own vocabulary before trusting it. If a price is
// renamed in render-audit-cta.ts and LIVE_PRICE_ANCHORS is not updated, every
// anchor stops matching anything and the loop below would fail 36 posts with
// a misleading message — or, if the check were "≥0", pass all of them while
// checking nothing. Fail here instead, naming the real cause.
{
  const rendererSrc = readFileSync("/workspace/synlig-site/_partials/render-audit-cta.ts", "utf8");
  const stale = LIVE_PRICE_ANCHORS.filter(([re]) => !re.test(rendererSrc));
  if (stale.length > 0) {
    console.error(`\n[BUILD FAIL] LIVE_PRICE_ANCHORS is out of sync with the renderer it describes:`);
    for (const [re, label] of stale) console.error(`  ${label} — ${re} matches nothing in render-audit-cta.ts`);
    console.error(`\nA price was changed without updating LIVE_PRICE_ANCHORS in that same file.`);
    process.exit(1);
  }
}
const allBlogFiles = readdirSync(bloggDir).filter(f => f.endsWith(".html"));
for (const fname of allBlogFiles) {
  const rendered = blogFileMap[fname];
  if (!rendered) {
    ctaViolations.push(`  blogg/${fname}: file exists on disk but not in build.ts files map — add it`);
    continue;
  }
  const ctaCount = (rendered.match(/class="audit-cta"/g) || []).length;
  if (ctaCount < 2) ctaViolations.push(`  blogg/${fname}: class="audit-cta" found ${ctaCount}, expected >=2`);
  if (!LIVE_PRICE_ANCHORS.some(([re]) => re.test(rendered)))
    ctaViolations.push(
      `  blogg/${fname}: no live paid-price anchor (expected one of: ${LIVE_PRICE_ANCHORS.map(([, l]) => l).join(", ")})`,
    );
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
  const factResult = runFactSourceGate("/workspace/synlig-site/src/content/blogg", "enforce");
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
      // Front page is Astro-built (2026-08-08). Point at the ARTIFACT that
      // ships, not at src/pages/index.astro: the needle must survive the
      // build, and only dist/ proves that.
      "/workspace/synlig-site/dist/index.html",
      "/workspace/synlig-site/dist/case/nordic-lithium/index.html",
      "/workspace/synlig-site/dist/case/pierstop/index.html",
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
// DEAD-TIER GATE — no content surface may quote a discontinued price tier.
// Live offer set: Sitert-måling 9 900 kr (invoiced) + Synlig Lite 990 kr.
// Analyse/Handlingsplan (4 900), Fundament (14 900) and Løpende (4 900/mnd)
// were discontinued 2026-08-08 on measured zeros.
//
// The predecessor gate (2026-06-05 → 2026-08-12) enforced the opposite: a page
// quoting the ladder had to ALSO offer Lite, so nobody met a price they could
// not pay. That invariant died with the ladder.
//
// Opt-out: BUILD_GATE_NEGATIVE_TEST env var (same as tier gate, for testing).
// ─────────────────────────────────────────────────────────────────────────────
// Shared by the HTML-dir gate below AND the AI-discovery-surface gate further
// down. One writer: a tier retired here is retired on both, so the two gates
// can never again demand opposite things about the same string — they did, for
// four days: llms.txt was REQUIRED to advertise 4 900 while src/content BANNED
// it, because the 08-12 flip rewrote one gate and not its sibling in this file.
const DEAD_TIER_PATTERNS: Array<[RegExp, string]> = [
  [/4[  ]900/, "Analyse/Handlingsplan 4 900 — discontinued 2026-08-08"],
  [/14[  ]900/, "Fundament 14 900 — discontinued 2026-08-08"],
  [/\$1,400|\$460/, "Foundation/Analysis USD mirror — discontinued 2026-08-08"],
  [/value="(handlingsplan|fundament|lopende)"/, "checkout button for a discontinued tier"],
  // 2026-08-13 — SECOND escape of the same class, so it graduates to a pattern.
  // The four rules above match how WE write the numbers (thin space, dollar
  // sign). Two live prospect reports and two EN blog posts wrote the SAME dead
  // tiers as "NOK 4,900", "USD 460" and "NOK 14,900" — comma-grouped and
  // currency-prefixed — and every one of them read CLEAN through the gate for
  // five days while carrying a working order link. A price is a claim, not a
  // string: match the amount in the separator forms we actually publish.
  [/\b4[,. ]900\b/, "Analyse/Handlingsplan 4,900 (comma/period form) — discontinued 2026-08-08"],
  [/\b14[,. ]900\b/, "Fundament 14,900 (comma/period form) — discontinued 2026-08-08"],
  // Currency approximations of the same dead amounts. USD was the form I
  // expected; three live cold-reports had been quoting "~€420" the whole time,
  // and the USD rule read them CLEAN. The load-bearing defense stays the NOK
  // rule above — every paraphrase so far printed the NOK number beside it —
  // so this rule lists only forms we have actually published, no invented ranges.
  [/\b(USD|EUR)[  ]?(460|420|1,?400)\b|€[  ]?420\b/, "Foundation/Analysis foreign-currency paraphrase — discontinued 2026-08-08"],
  // The tier NAMES, not just their prices: "full Analysis in 5" sold the dead
  // tier in the EN report template for five days without printing any number.
  [/full Analysis\b|\(Foundation\b/, "discontinued tier named in prose (Analysis/Foundation)"],
];
if (!process.env.BUILD_GATE_NEGATIVE_TEST) {
  // Extended 2026-06-06 (10th occurrence — Stavanger geo-local + state-of-aeo-2026
  // research report + komplett-aeo-analyse stub): the gate originally scanned
  // /blogg only, but tier-discoverability gaps appeared in /tjenester (geographic
  // landing pages) and /rapport (research pillar pages). Per
  // funnel-wide-launch principle, every page surfacing pricing must surface the
  // entry tier — extend the same gate to those directories rather than
  // creating parallel registries.
  //
  // fase 3 (2026-08-09): /blogg and the three case pages became Astro content
  // collections, so the authored surface moved to src/content/{blogg,case}.
  // The komplett-aeo-analyse.html push below moved with it — that pillar is now
  // src/content/case/komplett-aeo.html and is covered by the case dir.
  // Parity measured before the switch: OLD 56 files / 22 pricing-mentioning / 0
  // violations, NEW 57 / 24 / 0. The two extra are pierstop + nordic-lithium,
  // which the old root-file push never reached; blogg/index.html dropped out and
  // never tripped pricingPattern in the first place.
  const PRICING_GATED_DIRS = [
    "/workspace/synlig-site/src/content/blogg",
    "/workspace/synlig-site/src/content/case",
    "/workspace/synlig-site/tjenester",
    "/workspace/synlig-site/rapport",
    // 2026-08-12: reports/ added AFTER it was cleaned. This dir was outside
    // every pricing gate for the whole life of the gate, and that is exactly
    // where the damage was: 192 of 193 prospect reports still advertised 4 900,
    // and 133 shipped a WORKING Stripe checkout button for handlingsplan — four
    // days after the tier was discontinued. Each of these pages is generated for
    // one named prospect and emailed to them, so this was the highest-intent
    // surface we own, taking card payment for a product we no longer deliver.
    // The gate scanned 57 files and reported "all clear" the entire time.
    // Lesson (this is the generalisable part): the gate's SCOPE is a claim that
    // needs verifying, not a given. A clean gate over the wrong file set is
    // false-CLEAN by construction — same class as a guard that passes on absent
    // input. When adding a pricing surface, add it here in the same commit.
    "/workspace/synlig-site/reports",
  ];
  // Minimum expected files per dir. `catch {}` below turns a renamed or deleted
  // directory into a silent zero-file scan and the gate would still print
  // nothing and pass — the exact false-CLEAN-on-absent-input failure the
  // fact-source gate hit the same day. Floors are the count at the time of the
  // fase-3 port minus nothing: these dirs only grow.
  const PRICING_DIR_FLOOR: Record<string, number> = {
    "/workspace/synlig-site/src/content/blogg": 36,
    "/workspace/synlig-site/src/content/case": 3,
    "/workspace/synlig-site/tjenester": 11,
    "/workspace/synlig-site/rapport": 7,
    // 193 reports exist today; floor at 180 leaves room for deliberate pruning
    // while still failing loudly if the dir is emptied or the path rots.
    "/workspace/synlig-site/reports": 180,
  };
  // Per-file exemptions inside a BAN dir. Dated, counterparty-specific PROPOSAL
  // documents: their prices record what we actually quoted, embedded in argument
  // ("…ikke en 14 900 kr Fundament"). Rewriting them would falsify a document
  // the counterparty holds. Neither carries a checkout button, so neither can
  // take money for a dead tier — the reason a ban is inappropriate here is
  // honesty about the past, not convenience. Keep this set SMALL and dated; an
  // exemption is how a gate goes quietly blind.
  const DEAD_TIER_FILE_EXEMPT = new Set([
    "visionmedia-northug-week1.html", // Visionmedia pilot proposal, 2026-06
    "visionmedia-pilot.html",         // Visionmedia pilot proposal, 2026-06
  ]);
  // 2026-08-14: EXEMPTION NÅ BETINGET, ikke gratis. Begge filene svarer 200 på
  // /r/ og har gjort det siden juni; fram til i dag betydde unntaket at to live
  // sider annonserte en nedlagt prisstige uten at noe sa fra. Prisen for
  // unntaket er et datert utgått-banner: står banneret, er dokumentet ærlig om
  // fortiden; slettes banneret, faller unntaket og bygget stopper. Et unntak
  // uten positiv kontroll er nøyaktig måten en port går stille blind på —
  // formulert i kommentaren over, men ikke håndhevet før nå.
  const SUPERSEDED_MARKER = "Historisk dokument — bevart uendret.";
  {
    const missing: string[] = [];
    for (const base of DEAD_TIER_FILE_EXEMPT) {
      let found = 0;
      for (const dir of PRICING_GATED_DIRS) {
        const p = join(dir, base);
        if (!existsSync(p)) continue;
        found++;
        let t = "";
        try { t = readFileSync(p, "utf-8"); } catch {
          missing.push(`${p}: uleselig — et unntak kan ikke hvile på en fil vi ikke får lest`);
          continue;
        }
        if (!t.includes(SUPERSEDED_MARKER)) {
          missing.push(`${p}: unntatt fra dead-tier-porten, men mangler utgått-banneret («${SUPERSEDED_MARKER}»)`);
        }
      }
      // Gulv: en oppføring uten fil er en stale konfigurasjon, ikke «ingen avvik».
      if (found === 0) {
        missing.push(`${base}: står i DEAD_TIER_FILE_EXEMPT, men finnes ikke i noen gated dir — fjern oppføringen`);
      }
    }
    if (missing.length > 0) {
      console.error(`\n[BUILD FAIL] dead-tier-unntak uten utgått-banner (${missing.length}):`);
      for (const m of missing) console.error(`  - ${m}`);
      console.error(`\nEt unntatt dokument får beholde de døde prisene fordi det er et datert tilbud.`);
      console.error(`Prisen for det er at leseren ser at tilbudet er utgått, øverst på siden.`);
      process.exit(1);
    }
    console.log(`  ✅ Dead-tier-unntak: ${DEAD_TIER_FILE_EXEMPT.size} filer, alle med datert utgått-banner.`);
  }
  // 2026-08-12 — THE INVARIANT FLIPPED, and that is the whole point of this
  // rewrite. Handlingsplan/Analyse (4 900), Fundament (14 900) and Løpende
  // (4 900/mnd) were discontinued 2026-08-08 on measured zeros. "A page quoting
  // this ladder must also offer Lite" protected nothing after that date — the
  // ladder itself became the defect, and it kept shipping for four more days on
  // 21 blog posts, both case pages, and their FAQPage JSON-LD answers (the
  // strings assistants quote verbatim; we are the most-cited host in this
  // category, so the machine layer is the product).
  //
  // Two regimes, because the surfaces are in two different states:
  //   BAN     — Astro-authored dirs. Any dead tier fails the build.
  //   RATCHET — legacy dirs not yet migrated. The count of offending files may
  //             only shrink. A ratchet cannot rot the way a hard-coded number
  //             can: it never asserts today's value is correct, only that we
  //             do not go backwards.
  const BAN_DIRS = new Set([
    "/workspace/synlig-site/src/content/blogg",
    "/workspace/synlig-site/src/content/case",
    // reports/ is BAN, not RATCHET, because it is now clean (1 475 replacements
    // across 190 files, patch-reports-one-price.ts, 2026-08-12) and because it
    // is the surface where a dead price costs the most: a prospect who was
    // emailed this exact page clicking a checkout for a product we retired.
    "/workspace/synlig-site/reports",
  ]);
  // Baseline measured 2026-08-12 with the same patterns, after the Astro sweep.
  // Lower it when a legacy dir is cleaned; never raise it.
  // 2026-08-13: both dirs cleared, so the ratchet closes to 0. It had been
  // sitting at 10 while only 2 files offended — eight silent slots a future
  // session could have filled without the build ever complaining. A ratchet
  // that is not re-tightened when you clear the directory is a gate that only
  // looks strict. The two remaining offenders were FAQPage JSON-LD on live
  // /tjenester pages: an AEO company feeding answer engines a price list where
  // three of four tiers had been discontinued for five days.
  const DEAD_TIER_RATCHET: Record<string, number> = {
    "/workspace/synlig-site/tjenester": 0,
    "/workspace/synlig-site/rapport": 0,
  };
  const deadTierViolations: string[] = [];
  const ratchetCounts: Record<string, number> = {};
  let scanned = 0;
  for (const dir of PRICING_GATED_DIRS) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).filter(f => f.endsWith(".html"));
    } catch {
      console.error(`\n[BUILD FAIL] dead-tier gate cannot read ${dir}.`);
      console.error(`A gated directory that disappears makes this gate pass by scanning nothing.`);
      process.exit(1);
    }
    const floor = PRICING_DIR_FLOOR[dir] ?? 1;
    if (entries.length < floor) {
      console.error(`\n[BUILD FAIL] dead-tier gate: ${dir} has ${entries.length} HTML files, floor is ${floor}.`);
      console.error(`Either pages were deleted (update the floor deliberately) or the gate just went blind.`);
      process.exit(1);
    }
    let offenders = 0;
    scanned += entries.length;
    for (const f of entries) {
      if (DEAD_TIER_FILE_EXEMPT.has(f)) continue;
      const filePath = join(dir, f);
      let text = "";
      try { text = readFileSync(filePath, "utf-8"); } catch { continue; }
      const hits = DEAD_TIER_PATTERNS.filter(([re]) => re.test(text));
      if (hits.length === 0) continue;
      offenders++;
      if (BAN_DIRS.has(dir)) {
        for (const [, why] of hits) deadTierViolations.push(`${filePath}: ${why}`);
      }
    }
    ratchetCounts[dir] = offenders;
    if (!BAN_DIRS.has(dir)) {
      const allowed = DEAD_TIER_RATCHET[dir];
      if (allowed === undefined) {
        console.error(`\n[BUILD FAIL] dead-tier gate: ${dir} is gated but has no ratchet baseline.`);
        process.exit(1);
      }
      if (offenders > allowed) {
        deadTierViolations.push(
          `${dir}: ${offenders} files quote a discontinued tier, ratchet allows ${allowed} — a new one was added`
        );
      }
    }
  }
  if (deadTierViolations.length > 0) {
    console.error(`\n[BUILD FAIL] dead-tier gate violated (${deadTierViolations.length} issue(s)):`);
    for (const v of deadTierViolations) console.error(`  - ${v}`);
    console.error(`\nWhy: Analyse (4 900), Fundament (14 900) and Løpende (4 900/mnd) were`);
    console.error(`discontinued 2026-08-08. A page quoting one advertises a product we do not`);
    console.error(`deliver, and a checkout button for one takes money for it. Live offer set:`);
    console.error(`Sitert-måling 9 900 kr (invoiced) + Synlig Lite 990 kr (Stripe/faktura).`);
    console.error(`\nFix: rewrite the copy. (The 2026-08-12 one-shot sweeps that used to be`);
    console.error(`recommended here were deleted 2026-08-13: they hard-coded the offer of`);
    console.error(`their day, so re-running one would have re-injected 271 mailto order rails`);
    console.error(`the reposition had just removed. A one-shot that outlives its offer is a`);
    console.error(`loaded gun pointing at the next fix.)`);
    process.exit(1);
  }
  const ratchetLine = Object.entries(ratchetCounts)
    .map(([d, n]) => `${d.split("/").pop()}=${n}`)
    .join(" ");
  console.log(`  dead-tier gate: ${scanned} files scanned, legacy remainder ${ratchetLine}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-DISCOVERY-SURFACE GATE — the machine-readable catalogues (llms.txt,
// priser.md, context.md, agent-card.json, agent-skills) must name every LIVE
// offer and no discontinued one. These are the files ChatGPT/Perplexity/Google
// AI fetch first when answering "what does Synlig offer?" and "what does it
// cost?", and we are the most-cited host in this category — the machine layer
// is the product, not decoration. Stale pricing here becomes the citation.
//
// Why this gate exists, twice over:
//   2026-06-05 — a funnel-wide launch reached ~10 HTML surfaces, 7 reports and
//   7 blog posts but missed these six files entirely (9th occurrence in 24h
//   across 5 surface CATEGORIES; text rules had failed, so it became a gate).
//   2026-08-12 — the gate itself rotted. It was pinned to the four-tier INSTANCE
//   ("lite/analyse/fundament/lopende must each appear"), so after the ladder was
//   discontinued 2026-08-08 it FORCED six machine surfaces to keep advertising
//   990/4 900/14 900 and to never mention the 9 900 sitert-måling that every
//   HTML page had been selling for four days. Measured live 2026-08-12:
//   llms.txt/priser.md/context.md/agent-skills carried 0 hits of "Sitert-måling"
//   and 0 of "9 900". The needles below are now the INVARIANT — the live offer
//   set — and dead tiers are banned via the shared DEAD_TIER_PATTERNS.
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
// Each offer needle is a set of alternates — the build passes if ANY alternate
// appears. This tolerates language differences (English in agent-card.json,
// Norwegian in the .txt/.md files) without forcing a single canonical phrase.
const AI_DISCOVERY_TIER_NEEDLES: Record<string, string[]> = {
  // Renamed 2026-08-13 with the offer reposition: we sell the CHANGES plus a
  // re-measurement, not the report. The old name ("Sitert-måling") named a
  // deliverable we now give away, so it is NOT an accepted alternate — a
  // surface still carrying only that string is advertising the retired sale.
  "sitert-pakken": ["Sitert-pakken", "sitert-pakken"],
  lite:             ["Synlig Lite", "990 NOK", "990 kr"],
};
if (!process.env.BUILD_GATE_NEGATIVE_TEST) {
  const aiSurfaceViolations: string[] = [];
  // Floor: an empty or unreadable surface list makes this gate pass by checking
  // nothing — the false-CLEAN-on-absent-input failure the sibling gate above
  // already guards against with PRICING_DIR_FLOOR.
  if (AI_DISCOVERY_SURFACES.length < 6) {
    console.error(`\n[BUILD FAIL] AI-discovery gate: ${AI_DISCOVERY_SURFACES.length} surfaces registered, floor is 6.`);
    console.error(`A shrunken surface list makes this gate blind rather than green.`);
    process.exit(1);
  }
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
          `live offer "${tier}" missing from AI-discovery surface: ${path}\n      alternates (any one suffices): ${alternates.join(" | ")}`
        );
      }
    }
    for (const [re, why] of DEAD_TIER_PATTERNS) {
      if (re.test(text)) aiSurfaceViolations.push(`${path} advertises a discontinued tier: ${why}`);
    }
  }
  if (aiSurfaceViolations.length > 0) {
    console.error(`\n[BUILD FAIL] AI-discovery-surface gate violated (${aiSurfaceViolations.length} issue(s)):`);
    for (const v of aiSurfaceViolations) console.error(`  - ${v}`);
    console.error(`\nWhy: llms.txt, priser.md, context.md, agent-card.json and the agent-skills`);
    console.error(`catalogue are what AI assistants fetch when answering "what does Synlig offer?"`);
    console.error(`and "what does it cost?" We are the most-cited host in this category, so what`);
    console.error(`stands here is what gets quoted back. Live offer set: Sitert-pakken 9 900 kr`);
    console.error(`(måling + endringene + ny måling, invoiced via /faktura?slug=priser-sitert)`);
    console.error(`+ Synlig Lite 990 kr.`);
    console.error(`\nFix: name the missing live offer, or delete the discontinued one.`);
    console.error(`Registries: build.ts AI_DISCOVERY_TIER_NEEDLES + DEAD_TIER_PATTERNS.`);
    process.exit(1);
  }
  console.log(`  AI-discovery gate: ${AI_DISCOVERY_SURFACES.length} surfaces carry the live offer set, 0 dead tiers`);
}

// ─────────────────────────────────────────────────────────────────────────────
// REFUSED-SALE GATE — 2026-08-13
//
// Measured: 4 567 landing impressions, 195 /priser visits, 375 cold emails,
// 37 replies, 0 purchases, 153 days since the last payment. The free audit
// created demand for the fix and every buy surface then declined to sell it —
// the flagship was orderable only by writing us an email, and the pricing page
// said in as many words that we do not do the implementation.
//
// Two shapes, both banned:
//   (a) any sentence refusing the implementation work
//   (b) ordering the FLAGSHIP through a mailto: — a rail no funnel stage can
//       observe, no agent acting for a buyer can complete, and which needs a
//       human at our end before anything happens. (Support/contact mailtos are
//       untouched; the pattern requires the flagship in the link.)
//
// Written as claims, not as one string: the refusal survived a previous sweep
// on this site in paraphrase ("Vi selger ikke implementeringsarbeidet etterpå").
// ─────────────────────────────────────────────────────────────────────────────
const REFUSED_SALE_PATTERNS: Array<[RegExp, string]> = [
  [/selger m[åa]lingen,? ikke implementering/i, "refuses the implementation sale"],
  [/selger ikke implementeringsarbeidet/i, "refuses the implementation sale (paraphrase)"],
  [/sell the measurement,? not the implementation/i, "refuses the implementation sale (EN)"],
  [/mailto:[^"'\s]*(?:[Ss]itert-(?:m%C3%A5ling|m[åa]ling|pakke)|Citation%20measurement)/i, "flagship ordered by mailto instead of a structural rail"],
];
if (!process.env.BUILD_GATE_NEGATIVE_TEST) {
  const refusalDirs = [
    // Root: every hand-written page the worker ships lives here, including the
    // whole en-*.html surface. Hand-listing files here is what made the gate
    // false-CLEAN on the day it was written: the pattern for the English
    // refusal sentence was correct, the file carrying it (en-case-nordic-
    // lithium.html) was simply never in the target list. Scan the directory.
    "/workspace/synlig-site",
    "/workspace/synlig-site/src/content/blogg",
    "/workspace/synlig-site/src/content/case",
    "/workspace/synlig-site/tjenester",
    "/workspace/synlig-site/rapport",
    "/workspace/synlig-site/reports",
  ];
  const refusalFiles = [
    "/workspace/synlig-site/src/pages/index.astro",
    "/workspace/synlig-site/src/data/homepage-jsonld.ts",
    // GENERATORS, not just their output. leaderboard.html is regenerated by a
    // cron; patching the artifact and leaving the template holding the dead
    // rail means the next run silently re-ships it — which is exactly what
    // happened at 09:44 today, minutes after a green build.
    "/workspace/tools/synlig-leaderboard-html.ts",
    "/workspace/tools/aeo-audit/src/report-html.ts",
    ...AI_DISCOVERY_SURFACES,
  ];
  const targets: string[] = [...refusalFiles];
  for (const dir of refusalDirs) {
    let entries: string[] = [];
    try {
      // withFileTypes, not a bare name filter: the site root contains a
      // DIRECTORY called `.astro`, whose name matches the extension regex.
      // A bare filter fed it to readFileSync, which threw EISDIR and turned
      // a clean site into a build failure.
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && /\.(html|astro|md|txt|json)$/.test(d.name))
        .map((d) => d.name);
    } catch { entries = []; }
    for (const f of entries) targets.push(join(dir, f));
  }
  // Floor: an empty target list makes this gate pass by scanning nothing.
  if (targets.length < 250) {
    console.error(`\n[BUILD FAIL] refused-sale gate: ${targets.length} targets, floor is 250.`);
    process.exit(1);
  }
  const refusalViolations: string[] = [];
  for (const p of targets) {
    let text = "";
    try { text = readFileSync(p, "utf-8"); } catch { refusalViolations.push(`unreadable target: ${p}`); continue; }
    for (const [re, why] of REFUSED_SALE_PATTERNS) if (re.test(text)) refusalViolations.push(`${p}: ${why}`);
  }
  if (refusalViolations.length > 0) {
    console.error(`\n[BUILD FAIL] refused-sale gate (${refusalViolations.length} issue(s)):`);
    for (const v of refusalViolations) console.error(`  - ${v}`);
    console.error(`\nThe free audit exists to create demand for the fix. A surface that refuses`);
    console.error(`the fix, or sells it through a mailto, converts that demand into nothing.`);
    console.error(`Order the flagship at /faktura?slug=priser-sitert. Registry: build.ts`);
    console.error(`REFUSED_SALE_PATTERNS.`);
    process.exit(1);
  }
  console.log(`  Refused-sale gate: ${targets.length} surfaces, 0 refusals, 0 mailto-only flagship rails`);
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
    let html = await Bun.file(join(reportsDir, fname)).text();
    // Inject visit beacon — reports (/r/{hash}) are the highest-value tracking
    // surface in the outreach funnel. A lead opening their own audit report is
    // the strongest engagement signal between "received cold email" and "started
    // checkout", and previously invisible to the operator.
    if (!html.includes("/api/v1/visit")) {
      const at = headCloseIndex(html);
      if (at !== -1) html = html.slice(0, at) + VISIT_BEACON_SCRIPT + html.slice(at);
    }
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

// Self-hosted DM Sans (fase 2 redesign, 2026-08-08). The old page pulled Inter
// from fonts.googleapis.com in the critical render path — two extra handshakes
// before first paint, on a page whose entire product claim is that machines can
// read it fast. Weights: 400 body, 500 UI, 700 headings. Served with immutable
// 1-year cache (filenames are content-stable; a weight swap gets a new name).
const FONT_FILES = ["DMSans-Regular", "DMSans-Medium", "DMSans-Bold"] as const;
const FONTS_B64: Record<string, string> = {};
for (const name of FONT_FILES) {
  const p = `/workspace/synlig-site/public/fonts/dm-sans/${name}.ttf`;
  const bytes = await Bun.file(p).arrayBuffer();
  if (bytes.byteLength < 10_000) {
    console.error(`\n[BUILD FAIL] font ${p} is ${bytes.byteLength} bytes — truncated or missing.`);
    process.exit(1);
  }
  FONTS_B64[name] = Buffer.from(bytes).toString("base64");
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT-STRIP — source comments stay in src/, they do not ship.
//
// Found 2026-08-08 by reading the DEPLOYED page's source instead of the repo's.
// Every HTML comment we write for the next maintainer was being served to the
// public, and four of them were internal notes:
//   • "/priser": «Tests price hypothesis after 76d at 4900 NOK» — our pricing
//     experiment log, on the pricing page, readable by any competitor.
//   • "/": «...leses av deploy.ts sin live-rute-gate», «build.ts
//     TIER_SURFACE_REGISTRY», «et prissett vi hadde lagt ned» — names our
//     internal gates and narrates an abandoned strategy.
//   • "/leaderboard": an OG post-mortem dated today.
//   • "/r/<hash>": «TOP CTA — primary conversion surface at peak attention…»
//     and similar internal CTA strategy — visible to the cold prospect
//     the report was written for (2026-08-09: verified live on 193 reports).
//   • "/tjenester/*": «Pricing — 4 tiers with Synlig Lite as entry point» —
//     a dead pricing tier narrated publicly (2026-08-09: 8 verticals).
// Second cost: comments plant dead strings inside the production artifact, so
// future defect-sweep greps false-positive on pages that are genuinely clean.
//
// This runs AFTER every gate and BEFORE embedding. The fact-source gate reads
// `<!-- fact-source-allow: [...] -->` markers from blog HTMLs BEFORE this
// stripping runs — gates analyse source, the worker ships the artifact.
//
// Reports: deploy.ts scaffold gate keys on `<!-- DIAGNOSIS: WHY NOT MENTIONED -->`
// to find scaffold fill-in problems. That marker is preserved via keepPrefixes.
//
// <script>/<style> bodies pass through verbatim: a `<!--` inside JS or CSS is
// not an HTML comment and cutting there would corrupt the page.
//
// Shared implementation: _partials/strip-html-comments.ts (importable by tests).
// ─────────────────────────────────────────────────────────────────────────────
{
  // Gather ALL html surfaces into one flat array so the floor and loop cover
  // every registry. Adding a new registry: push into allSurfaces here.
  type Surface = { key: string; html: string; keepPrefixes?: string[] };
  const allSurfaces: Surface[] = [];

  // 1) Main files object — 59 *_HTML keys
  for (const key of Object.keys(files).filter(k => k.endsWith("_HTML"))) {
    allSurfaces.push({ key, html: (files as Record<string, string>)[key] });
  }
  // 2) verticalFiles — 8 /tjenester/* pages
  for (const key of Object.keys(verticalFiles)) {
    allSurfaces.push({ key, html: verticalFiles[key] });
  }
  // 3) reportEntries — 193 /r/<hash> pages; preserve DIAGNOSIS marker for deploy gate
  for (const r of reportEntries) {
    allSurfaces.push({ key: `REPORT_${r.hash}`, html: r.html, keepPrefixes: [STRIP_KEEP_PREFIXES.DIAGNOSIS] });
  }

  // Empty-input floor: covers ALL registries, not just `files`.
  // Minimum = 59 files + 8 verticals + 193 reports = 260. Floor set to 250.
  if (allSurfaces.length < 250) {
    console.error(`\n[BUILD FAIL] comment-strip: only ${allSurfaces.length} surfaces (expected ≥250 — did a registry stop loading?).`);
    process.exit(1);
  }

  let removedBytes = 0;
  let footersInjected = 0;
  const footerless: string[] = [];
  for (const surface of allSurfaces) {
    const before = surface.html;
    const after = stripHtmlComments(before, surface.keepPrefixes ?? []);
    // Invariant: stripping may only DELETE, never touch executable/style content.
    const countTags = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    for (const [label, re] of [
      ["<script", /<script\b/gi],
      ["</script>", /<\/script>/gi],
      ["<style", /<style\b/gi],
      ["ld+json", /application\/ld\+json/gi],
    ] as const) {
      if (countTags(before, re) !== countTags(after, re)) {
        console.error(`\n[BUILD FAIL] comment-strip changed ${label} count in ${surface.key}.`);
        process.exit(1);
      }
    }
    if (after.length > before.length) {
      console.error(`\n[BUILD FAIL] comment-strip grew ${surface.key} — the regex is wrong.`);
      process.exit(1);
    }
    removedBytes += before.length - after.length;

    // ── LEGAL-IDENTITY INJECTION (2026-08-14, fase 4) ───────────────────────
    // Runs in this loop on purpose: allSurfaces is the ONLY place that has
    // every shipped registry in one array behind one empty-input floor. A
    // separate pass over `files` alone would have missed the 193 reports and
    // 8 verticals — which is the exact shape of the 2026-08-08 pricing-gate
    // failure (gate scanned 57 files, reports/ was not one of them).
    // Injection AFTER the strip, so the marker cannot be eaten as a comment.
    const shipped = injectLegalIdentity(after);
    if (hasFooter(after) && !shipped.includes(LEGAL_MARKER)) {
      console.error(`\n[BUILD FAIL] legal-identity: ${surface.key} has a <footer> but injection produced no marker.`);
      console.error(`Source: /workspace/synlig-site/_partials/legal-identity.ts`);
      process.exit(1);
    }
    if (hasFooter(after)) footersInjected++;
    else footerless.push(surface.key);

    // ── DEAD POSTAL CODE BAN ────────────────────────────────────────────────
    // Same surface set, same loop — so this can never be "clean over the wrong
    // fileset" the way the pricing gate was for four days. Ban, not swap: 4006
    // lived in prose, FAQ answer text, three LocalBusiness schema blocks and
    // two hand-written footers, and a string swept once comes back.
    for (const dead of DEAD_POSTAL_CODES) {
      if (shipped.includes(dead)) {
        console.error(`\n[BUILD FAIL] dead postal code "${dead}" in ${surface.key}.`);
        console.error(`Brreg-registrert postnummer er ${LEGAL.postalCode}. Kilde: _partials/legal-identity.ts.`);
        process.exit(1);
      }
    }

    // Write back to the respective registry
    if (surface.key.startsWith("REPORT_")) {
      const hash = surface.key.slice("REPORT_".length);
      const entry = reportEntries.find(r => r.hash === hash);
      if (entry) entry.html = shipped;
    } else if (surface.key in verticalFiles) {
      verticalFiles[surface.key] = shipped;
    } else {
      (files as Record<string, string>)[surface.key] = shipped;
    }
  }
  const filesCount = allSurfaces.filter(s => !s.key.startsWith("REPORT_") && !(s.key in verticalFiles) && s.key.endsWith("_HTML")).length;
  console.log(`  ✅ Comment-strip: ${allSurfaces.length} surfaces (${filesCount} files + ${Object.keys(verticalFiles).length} verticals + ${reportEntries.length} reports), ${removedBytes} bytes withheld.`);

  // Empty-input floor for the legal-identity pass itself. Without this, a
  // future refactor that stops matching footers would report "0 injected" as
  // success — false-CLEAN on absent input, the recurring gate failure mode.
  // 250 surfaces exist; ~30 legacy pages + 193 reports + 1 Astro layout carry
  // a footer, so anything under 200 means the matcher broke, not that the
  // pages changed.
  if (footersInjected < 200) {
    console.error(`\n[BUILD FAIL] legal-identity: only ${footersInjected} surfaces got the org.nr block (expected ≥200).`);
    console.error(`Footerless surfaces (${footerless.length}): ${footerless.slice(0, 12).join(", ")}${footerless.length > 12 ? " …" : ""}`);
    process.exit(1);
  }
  console.log(`  ✅ Legal identity: ${LEGAL.entity} (org.nr ${LEGAL.orgnrPlain}) in ${footersInjected} footers; ${footerless.length} surfaces have no <footer>.`);
}

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
import { handleLiteCheckout, handleLeadCapture, handleStripeWebhook, handleTakkPage } from "./checkout-handler";
import { handleFakturaSubmit } from "./faktura-handler";

const INDEX_HTML = \`${escape(files.INDEX_HTML)}\`;

const METODE_HTML = \`${escape(files.METODE_HTML)}\`;

const EN_HTML = \`${escape(files.EN_HTML)}\`;

const PRISER_HTML = \`${escape(files.PRISER_HTML)}\`;

const FAKTURA_HTML = \`${escape(files.FAKTURA_HTML)}\`;

// English-localized initial-paint variant of FAKTURA_HTML for /faktura?lang=en.
// Why: 2026-06-27 buyer-journey dogfood (en-home-lite Stripe cancel → recovery
// banner → /faktura?lang=en) revealed that the JS lang-flip in FAKTURA_HTML
// only runs AFTER DOMContentLoaded. Crawlers/AI agents that index the page,
// and the first ∼100ms of paint for any English buyer, all see <html lang="nb">
// plus a Norwegian <title> and <meta>. For someone who already abandoned Stripe
// once at $92, the title bar flickering "Bestill med faktura" at the recovery
// surface is a second credibility break — they bail again. Mirror surfaces:
// /en/, /takk-for-bestilling?lang=en and Stripe checkout already render English
// at the byte level; /faktura was the only English-funnel surface still serving
// Norwegian-first. Pre-compute the EN variant at module init (six surgical
// head replaces); the static-route handler selects it when ?lang=en is present.
// Body strings keep their Norwegian — the existing client-side JS swap covers
// them — so this stays a head-only fix and adds no duplicate ≈70KB to bundle.
const FAKTURA_EN_HTML = FAKTURA_HTML
  .replace('<html lang="nb">', '<html lang="en">')
  .replace(
    "<title>Bestill med faktura — Synlig Digital</title>",
    "<title>Order with invoice — Synlig Digital</title>",
  )
  .replace(
    '<meta name="description" content="Bestill AEO-pakke fra Synlig Digital med faktura. Vi sender faktura innen 24 timer — du betaler etter mottak. Arbeidet starter når fakturaen er signert.">',
    '<meta name="description" content="Order an AEO package from Synlig Digital by invoice. Invoice sent within 24 hours — you pay after receipt. Work starts when the invoice is signed.">',
  )
  .replace(
    '<meta property="og:title" content="Bestill med faktura — Synlig Digital">',
    '<meta property="og:title" content="Order with invoice — Synlig Digital">',
  )
  .replace(
    '<meta property="og:description" content="Bestill AEO-pakke med faktura. Vi sender faktura innen 24 timer.">',
    '<meta property="og:description" content="Order an AEO package by invoice. Invoice sent within 24 hours.">',
  )
  .replace(
    '<meta property="og:locale" content="nb_NO">',
    '<meta property="og:locale" content="en_US">',
  );

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

const EN_BLOG_AEO_DIGITAL_ASSETS_HTML = \`${escape(files.EN_BLOG_AEO_DIGITAL_ASSETS_HTML)}\`;

const EN_BLOG_AEO_AGENCY_NORWAY_HTML = \`${escape(files.EN_BLOG_AEO_AGENCY_NORWAY_HTML)}\`;

const EN_BLOG_VISIBILITY_PARADOX_HTML = \`${escape(files.EN_BLOG_VISIBILITY_PARADOX_HTML)}\`;

const EN_BLOG_AGENTJACKING_AI_TRUST_HTML = \`${escape(files.EN_BLOG_AGENTJACKING_AI_TRUST_HTML)}\`;

const PIERSTOP_CASE_HTML = \`${escape(files.PIERSTOP_CASE_HTML)}\`;

const PICO_PAGE_HTML = \`${escape(files.PICO_PAGE_HTML)}\`;

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

const TJENESTER_AEO_HTML = \`${escape(files.TJENESTER_AEO_HTML)}\`;

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

const BLOGG_CHECKOUT_AGENTIC_COMMERCE_TILLIT_GAP_HTML = \`${escape(files.BLOGG_CHECKOUT_AGENTIC_COMMERCE_TILLIT_GAP_HTML)}\`;

const BLOGG_GOOGLE_SEARCH_PROFILES_61_HTML = \`${escape(files.BLOGG_GOOGLE_SEARCH_PROFILES_61_HTML)}\`;

const BLOGG_AEO_LITE_FAQPAGE_HTML = \`${escape(files.BLOGG_AEO_LITE_FAQPAGE_HTML)}\`;

const BLOGG_B2B_FINTECH_AGENT_HTML = \`${escape(files.BLOGG_B2B_FINTECH_AGENT_HTML)}\`;

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

const FONTS_B64 = ${JSON.stringify(FONTS_B64)};

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
  // connect-src includes poc-backend.amdal-dev.workers.dev so the first-party
  // visit beacon (POST /api/v1/visit, injected site-wide by build.ts) is
  // actually able to reach the backend. Without it, the beacon JS runs but
  // the cross-origin fetch is silently blocked by CSP — exactly the same
  // "operator can't diagnose what they can't see" failure that the CF Web
  // Analytics replacement was supposed to end. (Caught 2026-06-10 13:30Z
  // during dogfood verification after initial deploy.)
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://poc-backend.amdal-dev.workers.dev; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' mailto:",
};

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600",
};

// 1x1 transparent GIF for tracking pixel
const TRACKING_GIF_B64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const routes = {
  "/": { body: INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/index.html": { body: INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/metode": { body: METODE_HTML, contentType: "text/html; charset=utf-8" },
  "/metode/": { body: METODE_HTML, contentType: "text/html; charset=utf-8" },
  "/metode.html": { body: METODE_HTML, contentType: "text/html; charset=utf-8" },
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
  "/en/blog/aeo-for-digital-asset-companies": { body: EN_BLOG_AEO_DIGITAL_ASSETS_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/aeo-for-digital-asset-companies/": { body: EN_BLOG_AEO_DIGITAL_ASSETS_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/aeo-for-digital-asset-companies.html": { body: EN_BLOG_AEO_DIGITAL_ASSETS_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/aeo-agency-norway": { body: EN_BLOG_AEO_AGENCY_NORWAY_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/aeo-agency-norway/": { body: EN_BLOG_AEO_AGENCY_NORWAY_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/aeo-agency-norway.html": { body: EN_BLOG_AEO_AGENCY_NORWAY_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/visibility-paradox-b2b-saas": { body: EN_BLOG_VISIBILITY_PARADOX_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/visibility-paradox-b2b-saas/": { body: EN_BLOG_VISIBILITY_PARADOX_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/visibility-paradox-b2b-saas.html": { body: EN_BLOG_VISIBILITY_PARADOX_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/agentjacking-and-ai-trust": { body: EN_BLOG_AGENTJACKING_AI_TRUST_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/agentjacking-and-ai-trust/": { body: EN_BLOG_AGENTJACKING_AI_TRUST_HTML, contentType: "text/html; charset=utf-8" },
  "/en/blog/agentjacking-and-ai-trust.html": { body: EN_BLOG_AGENTJACKING_AI_TRUST_HTML, contentType: "text/html; charset=utf-8" },
  "/case/pierstop": { body: PIERSTOP_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/case/pierstop.html": { body: PIERSTOP_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/pico": { body: PICO_PAGE_HTML, contentType: "text/html; charset=utf-8" },
  "/pico/": { body: PICO_PAGE_HTML, contentType: "text/html; charset=utf-8" },
  "/pico.html": { body: PICO_PAGE_HTML, contentType: "text/html; charset=utf-8" },
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

  "/tjenester/aeo": { body: TJENESTER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/aeo/": { body: TJENESTER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/aeo.html": { body: TJENESTER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/aeo-optimalisering": { body: TJENESTER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/tjenester/aeo-optimalisering/": { body: TJENESTER_AEO_HTML, contentType: "text/html; charset=utf-8" },
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
  "/blogg/checkout-agentic-commerce-tillit-gap-2026": { body: BLOGG_CHECKOUT_AGENTIC_COMMERCE_TILLIT_GAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/checkout-agentic-commerce-tillit-gap-2026.html": { body: BLOGG_CHECKOUT_AGENTIC_COMMERCE_TILLIT_GAP_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-search-profiles-61-prosent-ctr-fall": { body: BLOGG_GOOGLE_SEARCH_PROFILES_61_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/google-search-profiles-61-prosent-ctr-fall.html": { body: BLOGG_GOOGLE_SEARCH_PROFILES_61_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-lite-faqpage-990-kr": { body: BLOGG_AEO_LITE_FAQPAGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-lite-faqpage-990-kr.html": { body: BLOGG_AEO_LITE_FAQPAGE_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/b2b-fintech-agent-discoverability": { body: BLOGG_B2B_FINTECH_AGENT_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/b2b-fintech-agent-discoverability.html": { body: BLOGG_B2B_FINTECH_AGENT_HTML, contentType: "text/html; charset=utf-8" },
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
    '<meta property="og:image" content="https://synligdigital.no/og-2026-08.png">' +
    '<meta property="og:image:width" content="1200">' +
    '<meta property="og:image:height" content="630">' +
    '<meta property="og:site_name" content="Synlig">' +
    '<meta property="og:locale" content="nb_NO">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + escTitle + '">' +
    '<meta name="twitter:description" content="' + escDesc + '">' +
    '<meta name="twitter:image" content="https://synligdigital.no/og-2026-08.png">';
  // String .replace() replaces only the first occurrence. The two reports
  // containing "<title>" in body text (as audit findings) have no closing
  // </title> in body, so the head match is unique.
  return html.replace("</title>", "</title>" + og);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Serve-check: proves this build is serving at the edge, not just stored.
    // Deploy stamps __SOURCE_STAMP__ → sha256(dist/worker.js)[0:12] at upload time.
    // sjekk-worker/deploy.ts pattern applied 2026-08-06 after measuring that a
    // deploy-200 + Cloudflare script-GET readback both reported new code while the
    // edge served the OLD build for ~2 minutes.
    if (pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "synlig-site", stamp: "__SOURCE_STAMP__", ts: Date.now() }), { headers: { "Content-Type": "application/json" } });
    }

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
    // 2026-08-08: the URL is now VERSIONED (/og-2026-08.png) and every og:image
    // points at the versioned path. Reason: the image is a headline layer — it
    // still rendered "Er bedriften din usynlig for AI?" months after that
    // positioning died, because nobody re-reads a picture. Re-rendering it is not
    // enough: CF holds it for max-age=3600 and LinkedIn/Slack/Teams cache OG
    // rasters by URL for far longer, so a same-path swap leaves the dead headline
    // in every future share preview. Bump the date suffix whenever the image
    // content changes. /og.png stays served for links already in the wild.
    // Self-hosted DM Sans. The front page declares @font-face against these
    // exact paths; a 404 here degrades silently to a fallback font, which is
    // the kind of regression nobody files a bug for — so deploy.ts gates them
    // as live routes.
    if (pathname.startsWith("/fonts/dm-sans/")) {
      const key = pathname.slice("/fonts/dm-sans/".length).replace(/\\.ttf$/, "");
      const b64 = FONTS_B64[key];
      if (b64) {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": "font/ttf",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
            ...SECURITY_HEADERS,
          },
        });
      }
    }

    if (pathname === "/og.png" || pathname === "/og-2026-08.png") {
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
      // Microsoft 365 SafeLinks / EU-tenant email scanner detection.
      // SafeLinks fetches the URL from a sandboxed Chromium with a regular
      // Chrome UA (no "Outlook"/"MSOffice" marker) — it slips past the UA-only
      // preview rule. Country-of-origin is the only server-visible tell:
      // Microsoft's EU tenant runs out of Dublin (IE), Frankfurt (DE), and
      // Amsterdam (NL); same pattern for Defender for Office 365.
      // 2026-06-02: IE-only rule shipped after three same-minute "human" opens
      //   from IE (AutoSock 6636b5e6 11:02, Zaptec jrwfdkev 09:38,
      //   Fjord Tours 3be49647 06:36) triggered premature E2 tasks.
      // 2026-06-23: extended to DE + NL after duett2026 (DE:1 NO:1 06:46) and
      //   sof2026 (DE:1 NL:1 06:46) — both Norwegian B2B targets — produced
      //   "👀 Rapport åpnet" hot-prospect alerts from a same-minute DE+EU pair
      //   that no human could have produced. The hardcoded /r/<slug> reports
      //   don't write \`send:<hash>\` to KV (no send-email.ts call), so
      //   isSendTimeScanner can't catch them; only the country-based rule
      //   prevents the false positive. Edge case (German/Dutch prospect viewing
      //   legitimately): false-negative is recoverable on the third open via
      //   the existing humanCount===3 alert.
      const EU_SCANNER_COUNTRIES = new Set(["IE", "DE", "NL"]);
      const isM365ScannerIE = !isBot && EU_SCANNER_COUNTRIES.has(country) &&
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

    // RETIRED RAILS — /api/{handlingsplan,fundament,lopende}-checkout.
    // The 4 900 / 14 900 / 4 900-per-mnd tiers were retired 2026-08-08. Live
    // offer is 990 Lite (card) + 9 900 sitert-måling (mailto + /faktura).
    // The BUTTONS went 08-08; the ROUTES kept minting real cs_live sessions
    // until 08-13, so anyone holding a shared or bookmarked link from that
    // window could pay by card for something we no longer deliver. Measured
    // 08-13: 427 sessions since 08-08, 0 paid — caught before any refund case.
    // The handlers are DELETED, not merely unrouted, so re-adding a route
    // cannot silently re-arm the rail. Pinned by dead-tier-rail.test.ts.
    if (pathname === "/api/handlingsplan-checkout" || pathname === "/api/fundament-checkout" || pathname === "/api/lopende-checkout") {
      return new Response(null, {
        status: 302,
        headers: { "Location": "https://synligdigital.no/priser", "Cache-Control": "no-store" },
      });
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
    //
    // 2026-06-11: PRESERVE query string in the redirect. Without this the
    // leaderboard row CTAs (?ref=leaderboard&utm_source=...) and similar
    // intent-tagged links were stripped on the 301, killing attribution.
    // Browsers follow the Location verbatim — if Location has no query, the
    // visitor lands at sjekk.synligdigital.no/ with no UTM, no ref, no source.
    if (pathname === "/sjekk" || pathname === "/sjekk/") {
      let sjekkLocation = "https://sjekk.synligdigital.no/";
      if (url.search) {
        sjekkLocation = "https://sjekk.synligdigital.no/" + url.search;
      }
      return new Response(null, {
        status: 301,
        headers: { "Location": sjekkLocation, "Cache-Control": "public, max-age=86400" },
      });
    }
    if (pathname === "/kontakt" || pathname === "/kontakt/") {
      return new Response(null, {
        status: 301,
        headers: { "Location": "https://synligdigital.no/#kontakt", "Cache-Control": "public, max-age=86400" },
      });
    }
    // /om — 2026-08-14 fase 4. Målt live samme morgen: /om svarte 404.
    // AVGJØRELSEN ER EKSPLISITT: vi bygger IKKE en om-oss-side.
    // Grunnen: /metode gjør allerede jobben en teknisk kjøper trenger (protokoll,
    // hva vi ikke påstår, hvordan målingen kjøres), og en tynn om-side er verre
    // enn ingen. Det /om-siden ville svart på som /metode IKKE svarte på var
    // «hvilket selskap fakturerer meg, og kan jeg slå det opp?» — og det svaret
    // hører hjemme i footeren på HVER side, ikke på én side kjøperen må finne.
    // Det ligger nå i _partials/legal-identity.ts (org.nr + Brreg-lenke, injisert
    // i ~250 flater med byggeport). Denne 301-en finnes bare for å drepe 404-en
    // for den som gjetter URL-en. Ikke bygg /om senere uten å lese den fila.
    if (pathname === "/om" || pathname === "/om/" || pathname === "/om-oss" || pathname === "/om-oss/") {
      return new Response(null, {
        status: 301,
        headers: { "Location": "https://synligdigital.no/metode", "Cache-Control": "public, max-age=86400" },
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
      // Lang-aware initial-paint swap for /faktura when ?lang=en is set.
      // Mirrors the same en-funnel propagation as /api/lead-capture (renders
      // Stripe checkout in en locale) and /takk-for-bestilling?lang=en. Without
      // this swap, /faktura?lang=en bytes are Norwegian until the in-page JS
      // swap fires post-DOMContentLoaded — credibility flicker for an English
      // buyer reaching this page via the Stripe-abandonment recovery banner.
      let body = route.body;
      const isFakturaPath =
        pathname === "/faktura" ||
        pathname === "/faktura/" ||
        pathname === "/faktura.html";
      if (isFakturaPath && url.searchParams.get("lang") === "en") {
        body = FAKTURA_EN_HTML;
      }
      return new Response(body, {
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
