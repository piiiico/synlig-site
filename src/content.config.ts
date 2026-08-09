import { defineCollection, z } from "astro:content";
import type { Loader } from "astro/loaders";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Content collections for the 36 blog posts + 3 case pages (fase 3, 2026-08-09).
 *
 * WHY A CUSTOM LOADER AND NOT glob()
 * Astro's built-in glob() loader handles .md/.mdx/.json only. These pages are
 * hand-written HTML — tables, comparison grids, score boxes, FAQ blocks — and
 * they are the citation engine (most-cited host in the category, N=3 measured
 * 2026-08-08). Round-tripping ~700-line HTML bodies through CommonMark would
 * re-parse blocks we cannot afford to have re-parsed. So the source of truth
 * stays raw HTML and this loader reads it byte-for-byte.
 *
 * FRONTMATTER FORMAT
 * Each file is:
 *
 *     <!-- fact-source-allow: [...] -->          ← must stay in src/, see below
 *     <script type="application/json" id="frontmatter">
 *     { … }
 *     </script>
 *
 *     <body fragment>
 *
 * A JSON <script> rather than YAML because build.ts's fact-source gate already
 * blanks <script> in cleanHtml() — exactly as it blanks <head> today — so the
 * gate's claim count over src/content/blogg is identical to what it was over
 * blogg/*.html. Metadata that is not prose must not become claims to source.
 *
 * The fact-source markers must live in the SOURCE. build.ts strips HTML
 * comments from the built artifact AFTER the gate has run; markers vanishing
 * from dist/ is correct, markers vanishing from src/ turns 341 claims red.
 */

const frontmatter = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  canonical: z.string().url(),
  ogTitle: z.string(),
  ogDescription: z.string(),
  published: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  modified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tags: z.array(z.string()),
  heading: z.string(),
  lead: z.string(),
  metaChips: z.array(z.string()),
  breadcrumbLabel: z.string(),
  /** index-card fields — editorial, lifted from the hand-written /blogg index */
  category: z.string(),
  cardMeta: z.string(),
  cardTitle: z.string(),
  excerpt: z.string(),
  /**
   * Typed data, never markup. Base.astro serialises these into
   * <script type="application/ld+json"> — the same contract the front page
   * uses via src/data/homepage-jsonld.ts. Kept per-page rather than in a
   * parallel src/data/ tree so a page's structured data and its prose cannot
   * drift apart; that drift is what the head-contract comment in Base.astro
   * was written about.
   */
  jsonLd: z.array(z.unknown()),
  /** bespoke per-page CSS that survived the design-system sweep */
  css: z.string(),
});

export type ArticleFrontmatter = z.infer<typeof frontmatter>;

const FM_RE =
  /<script type="application\/json" id="frontmatter">\s*([\s\S]*?)\s*<\/script>/;

function htmlLoader(dir: string): Loader {
  return {
    name: `html-fragments:${dir}`,
    load: async ({ store, parseData, generateDigest, logger, watcher }) => {
      const abs = join(process.cwd(), "src/content", dir);
      const files = readdirSync(abs)
        .filter((f) => f.endsWith(".html"))
        .sort();

      // Empty-input floor. A loader that silently yields nothing turns every
      // downstream gate false-clean: getStaticPaths() returns [], the pages
      // never render, and the build goes green with the site's whole content
      // layer missing. Fail loud instead.
      if (files.length === 0) {
        throw new Error(`content collection "${dir}" loaded 0 files from ${abs}`);
      }

      store.clear();
      for (const file of files) {
        const raw = readFileSync(join(abs, file), "utf8");
        const m = FM_RE.exec(raw);
        if (!m) throw new Error(`${dir}/${file}: no <script id="frontmatter"> block`);

        let parsed: unknown;
        try {
          parsed = JSON.parse(m[1]);
        } catch (err) {
          throw new Error(`${dir}/${file}: frontmatter is not valid JSON — ${err}`);
        }

        const id = file.replace(/\.html$/, "");
        const data = await parseData({ id, data: parsed as Record<string, unknown> });
        const html = raw.slice(m.index + m[0].length).trim();
        if (!html) throw new Error(`${dir}/${file}: empty body after frontmatter`);

        store.set({
          id,
          data,
          digest: generateDigest(raw),
          rendered: { html },
          filePath: `src/content/${dir}/${file}`,
        });
        watcher?.add(join(abs, file));
      }
      logger.info(`loaded ${files.length} ${dir} pages (${statSync(abs).isDirectory() ? "html" : "?"})`);
    },
  };
}

export const collections = {
  blogg: defineCollection({ loader: htmlLoader("blogg"), schema: frontmatter }),
  case: defineCollection({ loader: htmlLoader("case"), schema: frontmatter }),
};
