// Reads static files from /workspace/synlig-site/ and generates
// /workspace/synlig-worker/worker.ts with embedded content.
// Also loads AEO reports from /workspace/synlig-site/reports/ for /r/{hash} routing.

import { readdirSync } from "fs";
import { join } from "path";

const files = {
  INDEX_HTML: await Bun.file("/workspace/synlig-site/index.html").text(),
  GUIDE_HTML: await Bun.file("/workspace/synlig-site/guide.html").text(),
  DASHBOARD_HTML: await Bun.file("/workspace/synlig-site/dashboard.html").text(),
  LLMS_TXT: await Bun.file("/workspace/synlig-site/llms.txt").text(),
  ROBOTS_TXT: await Bun.file("/workspace/synlig-site/robots.txt").text(),
  SITEMAP_XML: await Bun.file("/workspace/synlig-site/sitemap.xml").text(),
  OG_SVG: await Bun.file("/workspace/synlig-site/og.svg").text(),
  FAVICON_SVG: await Bun.file("/workspace/synlig-site/favicon.svg").text(),
  KOMPLETT_AEO_HTML: await Bun.file("/workspace/synlig-site/komplett-aeo-analyse.html").text(),
  NORDIC_LITHIUM_CASE_HTML: await Bun.file("/workspace/synlig-site/nordic-lithium-case.html").text(),
  AGENT_CARD_JSON: await Bun.file("/workspace/synlig-site/agent-card.json").text(),
  BLOGG_INDEX_HTML: await Bun.file("/workspace/synlig-site/blogg/index.html").text(),
  BLOGG_HVA_ER_AEO_HTML: await Bun.file("/workspace/synlig-site/blogg/hva-er-aeo.html").text(),
  BLOGG_AEO_I_NORGE_2026_HTML: await Bun.file("/workspace/synlig-site/blogg/aeo-i-norge-2026.html").text(),
  BLOGG_NORSK_AEO_BENCHMARK_2026_HTML: await Bun.file("/workspace/synlig-site/blogg/norsk-aeo-benchmark-2026.html").text(),
  RAPPORT_STATE_AEO_2026_HTML: await Bun.file("/workspace/synlig-site/rapport/state-of-aeo-2026.html").text(),
};

// Load reports from /workspace/synlig-site/reports/
const reportsDir = "/workspace/synlig-site/reports";
const reportEntries: Array<{ hash: string; html: string }> = [];
try {
  const reportFiles = readdirSync(reportsDir).filter(f => f.endsWith(".html"));
  for (const fname of reportFiles) {
    const hash = fname.replace(".html", "");
    const html = await Bun.file(join(reportsDir, fname)).text();
    reportEntries.push({ hash, html });
    console.log(`  Loaded report: ${hash} (${html.length} bytes)`);
  }
} catch {
  console.log("  No reports directory found, skipping.");
}

// Binary files (base64-encoded)
const pdfBytes = await Bun.file("/workspace/money/aeo/synlig-digital-one-pager.pdf").arrayBuffer();
const PDF_B64 = Buffer.from(pdfBytes).toString("base64");

// Escape backticks and dollar signs for template literals
function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

// Build reports map
const reportsMapEntries = reportEntries
  .map(r => `  "${r.hash}": \`${escape(r.html)}\``)
  .join(",\n");

const worker = `// Auto-generated Cloudflare Worker — do not edit by hand.
// Built from /workspace/synlig-site/ static files.
// Generated: ${new Date().toISOString()}

const INDEX_HTML = \`${escape(files.INDEX_HTML)}\`;

const GUIDE_HTML = \`${escape(files.GUIDE_HTML)}\`;

const DASHBOARD_HTML = \`${escape(files.DASHBOARD_HTML)}\`;

const LLMS_TXT = \`${escape(files.LLMS_TXT)}\`;

const ROBOTS_TXT = \`${escape(files.ROBOTS_TXT)}\`;

const SITEMAP_XML = \`${escape(files.SITEMAP_XML)}\`;

const OG_SVG = \`${escape(files.OG_SVG)}\`;

const FAVICON_SVG = \`${escape(files.FAVICON_SVG)}\`;

const KOMPLETT_AEO_HTML = \`${escape(files.KOMPLETT_AEO_HTML)}\`;

const NORDIC_LITHIUM_CASE_HTML = \`${escape(files.NORDIC_LITHIUM_CASE_HTML)}\`;

const AGENT_CARD_JSON = \`${escape(files.AGENT_CARD_JSON)}\`;

const BLOGG_INDEX_HTML = \`${escape(files.BLOGG_INDEX_HTML)}\`;

const BLOGG_HVA_ER_AEO_HTML = \`${escape(files.BLOGG_HVA_ER_AEO_HTML)}\`;

const BLOGG_AEO_I_NORGE_2026_HTML = \`${escape(files.BLOGG_AEO_I_NORGE_2026_HTML)}\`;

const BLOGG_NORSK_AEO_BENCHMARK_2026_HTML = \`${escape(files.BLOGG_NORSK_AEO_BENCHMARK_2026_HTML)}\`;

const RAPPORT_STATE_AEO_2026_HTML = \`${escape(files.RAPPORT_STATE_AEO_2026_HTML)}\`;

const ONE_PAGER_PDF_B64 = "${PDF_B64}";

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
  "/guide": { body: GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/guide.html": { body: GUIDE_HTML, contentType: "text/html; charset=utf-8" },
  "/dashboard": { body: DASHBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/dashboard.html": { body: DASHBOARD_HTML, contentType: "text/html; charset=utf-8" },
  "/llms.txt": { body: LLMS_TXT, contentType: "text/plain; charset=utf-8" },
  "/robots.txt": { body: ROBOTS_TXT, contentType: "text/plain; charset=utf-8" },
  "/sitemap.xml": { body: SITEMAP_XML, contentType: "application/xml; charset=utf-8" },
  "/og.svg": { body: OG_SVG, contentType: "image/svg+xml" },
  "/favicon.svg": { body: FAVICON_SVG, contentType: "image/svg+xml" },
  "/analyse/komplett-aeo": { body: KOMPLETT_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/analyse/komplett-aeo.html": { body: KOMPLETT_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/case/nordic-lithium": { body: NORDIC_LITHIUM_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/case/nordic-lithium.html": { body: NORDIC_LITHIUM_CASE_HTML, contentType: "text/html; charset=utf-8" },
  "/.well-known/agent-card.json": { body: AGENT_CARD_JSON, contentType: "application/json; charset=utf-8" },
  "/blogg": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/index.html": { body: BLOGG_INDEX_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo": { body: BLOGG_HVA_ER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/hva-er-aeo.html": { body: BLOGG_HVA_ER_AEO_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-i-norge-2026": { body: BLOGG_AEO_I_NORGE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/aeo-i-norge-2026.html": { body: BLOGG_AEO_I_NORGE_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norsk-aeo-benchmark-2026": { body: BLOGG_NORSK_AEO_BENCHMARK_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/blogg/norsk-aeo-benchmark-2026.html": { body: BLOGG_NORSK_AEO_BENCHMARK_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/rapport/state-of-aeo-2026": { body: RAPPORT_STATE_AEO_2026_HTML, contentType: "text/html; charset=utf-8" },
  "/rapport/state-of-aeo-2026.html": { body: RAPPORT_STATE_AEO_2026_HTML, contentType: "text/html; charset=utf-8" },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

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

    // Tracking pixel: GET /track?h={hash}
    // Returns 1x1 GIF. Each request logged by Cloudflare Analytics.
    // Check: https://dash.cloudflare.com → Analytics → /track paths
    if (pathname === "/track") {
      const h = url.searchParams.get("h") || "unknown";
      // Log to console (visible in CF Workers logs)
      console.log(\`[TRACK] Report viewed: \${h} | UA: \${request.headers.get("User-Agent") || "-"} | Ref: \${request.headers.get("Referer") || "-"}\`);
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

    // AEO Report hosting: GET /r/{hash}
    if (pathname.startsWith("/r/")) {
      const hash = pathname.slice(3); // Remove /r/
      const reportHtml = REPORTS[hash];
      if (reportHtml) {
        return new Response(reportHtml, {
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
      return new Response(route.body, {
        status: 200,
        headers: {
          "Content-Type": route.contentType,
          ...SECURITY_HEADERS,
          ...CACHE_HEADERS,
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
