// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Astro builds ONLY to synlig-site/dist/. It never writes worker.ts —
// build.ts is the single writer of worker.ts (DUPLICATE-WRITER GUARD,
// set after two build scripts took checkout down for 2h on 2026-05-20).
//
// inlineStylesheets: "always" is load-bearing, not a preference: the
// Cloudflare Worker serves dist/index.html as an embedded string, so a
// <link rel=stylesheet href="/_astro/*.css"> would 404 in production.
// Everything the page needs must live inside the one HTML file (fonts
// are the exception — they get their own worker routes with immutable
// cache headers, see build.ts FONT_ROUTES).
export default defineConfig({
  site: "https://synligdigital.no",
  build: {
    inlineStylesheets: "always",
    assets: "_astro",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
