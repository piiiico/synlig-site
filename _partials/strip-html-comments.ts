/**
 * Strip authored comments from a page so they are not served to visitors.
 *
 * Two comment syntaxes, one contract: nothing we wrote for the next maintainer
 * ships. The module used to honour that for `<!-- -->` only and passed `<style>`
 * bodies through verbatim, on the correct-but-partial reasoning that a `<!--`
 * inside CSS is not an HTML comment. It isn't — but a `/* *` + `/` one is, and
 * that hole was live: measured 2026-08-09, /priser served 14 CSS comments,
 * including the inline-form funnel analysis ("removes the 5→6 email-step
 * bounce"), the Stripe-abandonment lead-scoring note ("warmest possible leads:
 * entered email, clicked checkout, bailed") and the Lite-tier launch date. Same
 * class as the 08-08 HTML-comment leak on the same page, one syntax over.
 *
 * keepPrefixes: comment-content prefixes whose HTML comments survive.
 *   e.g. [" DIAGNOSIS:"] preserves <!-- DIAGNOSIS: WHY NOT MENTIONED -->
 *
 * CSS: `/*! … *\/` survives (the universal preserve-marker; Tailwind ships its
 * MIT licence that way and removing it would be a licence violation). Everything
 * else in a <style> body goes. `<script>` bodies still pass through verbatim —
 * JS comments can carry sourcemap and directive semantics, and no leak has been
 * measured there; that stays a deliberate boundary, not an oversight.
 *
 * Shared module so build.ts can apply it AND tests can import it directly —
 * keeping the two-arm regression test possible without re-running the build.
 */
export const STRIP_KEEP_PREFIXES = {
  /** Preserved in reports: deploy.ts scaffold gate keys on this marker. */
  DIAGNOSIS: " DIAGNOSIS:",
} as const;

/**
 * Remove `/* … *\/` comments from a CSS body, preserving `/*! … *\/`.
 *
 * Hand-scanned rather than regexed because a naive replace corrupts any rule
 * whose STRING value contains the delimiter — `content: "/*"` is legal CSS and
 * would swallow the rest of the sheet. Quoted strings are skipped as units.
 */
export function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    // Skip over quoted strings verbatim, honouring backslash escapes.
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < css.length) {
        if (css[i] === "\\") {
          out += css.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += css[i];
        if (css[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      // Unterminated comment: drop the remainder rather than emit half a rule.
      if (end === -1) return out;
      if (css[i + 2] === "!") {
        out += css.slice(i, end + 2); // /*! … */ — preserve marker, keep it
      }
      i = end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function stripHtmlComments(
  html: string,
  keepPrefixes: string[] = [],
): string {
  return html
    .split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/i)
    .map((part, i) => {
      if (i % 2 === 1) {
        // <script> passes through; <style> gets its CSS comments removed.
        if (!/^<style\b/i.test(part)) return part;
        const open = part.indexOf(">") + 1;
        const close = part.toLowerCase().lastIndexOf("</style>");
        if (open <= 0 || close < open) return part;
        return part.slice(0, open) + stripCssComments(part.slice(open, close)) + part.slice(close);
      }
      return part.replace(/<!--([\s\S]*?)-->/g, (_match, content: string) =>
        keepPrefixes.some((p) => content.startsWith(p)) ? `<!--${content}-->` : "",
      );
    })
    .join("");
}
