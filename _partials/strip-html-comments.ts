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
 * else in a <style> body goes.
 *
 * JS (added 2026-08-14): the third syntax. This paragraph used to read
 * "<script> bodies still pass through verbatim — JS comments can carry
 * sourcemap and directive semantics, and no leak has been measured there; that
 * stays a deliberate boundary, not an oversight." The ground was then measured
 * and is false. Live /faktura?lang=en served 220 comment lines / 15 011 bytes
 * of internal engineering log and /en/ 64 lines / 4 394 bytes — the two pages a
 * foreign buyer reads in order to pay us. The worst line named a real prospect
 * and his abandoned checkout ("2026-06-17 Halliday/Griffin (USD 92-460
 * prospect) clicked the 'Get invoice' CTA on his English audit report at 16:14Z
 * and bounced without submitting"); also served were defect post-mortems ("was
 * dead code that had never once been applied") and the analytics slug scheme.
 * Same class as 08-08 (HTML) and 08-09 (CSS), one syntax over — third
 * recurrence, so it moves to the default execution path.
 *
 * Preserved in JS: `/*! … *\/`, plus `//#` and `//@` line comments (sourcemap
 * and engine directives are semantics, not prose). JSON-LD and any other
 * non-JS <script type> is never touched.
 *
 * Correctness is not left to the scanner's judgement. Removing a comment must
 * be a no-op on the program, so each stripped body is compared against the
 * original through Bun's transpiler — which drops comments on both sides, so
 * only a real code change can make them differ. Differ ⇒ throw, failing the
 * build loudly. A bug in the scanner can therefore stop a deploy; it cannot
 * corrupt a shipped page.
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

/**
 * Remove authored comments from a JS body, preserving `/*! … *\/`, `//#` and `//@`.
 *
 * Hand-scanned for the same reason as CSS, one level harder: in JS a `/` is
 * either division or the start of a regex literal, and `//` appears inside
 * every absolute URL we embed. The scanner therefore tracks the constructs
 * that can hold a false `//`: quoted strings, template literals (including
 * `${…}` nesting, the only construct where a line may *begin* with `//` and
 * still be data) and regex literals. Whether a `/` opens a regex is decided by
 * the previous significant token, the standard heuristic.
 *
 * `assertJsStripPreservesProgram` is what makes the heuristic safe to ship.
 */
export function stripJsComments(js: string): string {
  let out = "";
  let i = 0;
  let lineStart = 0; // index in `out` where the current output line begins
  let prev = ""; // previous significant (non-whitespace) source char emitted
  // Context stack: "tmpl" = inside a template literal, "code" = inside its ${…}.
  const ctx: string[] = [];

  const lineSoFarBlank = () => out.slice(lineStart).trim() === "";
  const push = (s: string) => {
    out += s;
    const nl = out.lastIndexOf("\n");
    if (nl >= lineStart) lineStart = nl + 1;
  };
  /**
   * A comment was just dropped. If it stood alone on its line, take the line
   * with it — otherwise every stripped comment leaves a blank line behind and
   * the artifact keeps the shape of what we removed. Safe because this only
   * runs in code context, never inside a template literal.
   */
  const dropLineIfBlank = () => {
    if (!lineSoFarBlank()) return;
    let j = i;
    while (j < js.length && (js[j] === " " || js[j] === "\t" || js[j] === "\r")) j++;
    if (js[j] === "\n") {
      out = out.slice(0, lineStart);
      i = j + 1;
    }
  };

  while (i < js.length) {
    const c = js[i]!;
    const next = js[i + 1];
    const inTemplate = ctx[ctx.length - 1] === "tmpl";

    if (inTemplate) {
      if (c === "\\") { push(js.slice(i, i + 2)); i += 2; continue; }
      if (c === "`") { ctx.pop(); push(c); i++; prev = c; continue; }
      if (c === "$" && next === "{") { ctx.push("code"); push("${"); i += 2; prev = "{"; continue; }
      push(c);
      i++;
      continue;
    }

    // ── code context ────────────────────────────────────────────────────────
    if (c === "`") { ctx.push("tmpl"); push(c); i++; prev = c; continue; }
    if (c === "}" && ctx[ctx.length - 1] === "code") { ctx.pop(); push(c); i++; prev = c; continue; }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < js.length) {
        if (js[j] === "\\") { j += 2; continue; }
        if (js[j] === quote || js[j] === "\n") break; // unterminated: stop at EOL
        j++;
      }
      push(js.slice(i, Math.min(j + 1, js.length)));
      i = j + 1;
      prev = quote;
      continue;
    }

    if (c === "/" && next === "/") {
      if (js[i + 2] === "#" || js[i + 2] === "@") {
        const eol = js.indexOf("\n", i);
        const end = eol === -1 ? js.length : eol;
        push(js.slice(i, end));
        i = end;
        prev = ";";
        continue;
      }
      const eol = js.indexOf("\n", i);
      i = eol === -1 ? js.length : eol;
      dropLineIfBlank();
      continue;
    }

    if (c === "/" && next === "*") {
      const end = js.indexOf("*/", i + 2);
      if (end === -1) { i = js.length; dropLineIfBlank(); continue; }
      if (js[i + 2] === "!") { push(js.slice(i, end + 2)); i = end + 2; prev = "/"; continue; }
      i = end + 2;
      dropLineIfBlank();
      continue;
    }

    if (c === "/" && regexCanStartAfter(prev, out)) {
      let j = i + 1;
      let inClass = false;
      while (j < js.length) {
        const d = js[j]!;
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break; // regex literals cannot span lines
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { j++; break; }
        j++;
      }
      while (j < js.length && /[a-z]/i.test(js[j]!)) j++; // flags
      push(js.slice(i, j));
      i = j;
      prev = "/";
      continue;
    }

    push(c);
    i++;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

/** Keywords after which a `/` opens a regex literal rather than dividing. */
const REGEX_PRECEDING_KEYWORDS = [
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await",
];

function regexCanStartAfter(prev: string, emitted: string): boolean {
  if (prev === "") return true;
  if ("(,=:[!&|?{};+-*%~^<>".includes(prev)) return true;
  // `return /re/` — the previous significant char is a word char, so fall back
  // to the trailing identifier.
  const m = emitted.match(/([A-Za-z_$][\w$]*)\s*$/);
  return m ? REGEX_PRECEDING_KEYWORDS.includes(m[1]!) : false;
}

/**
 * Throw unless `stripped` is the same program as `original`.
 *
 * The oracle is Bun's transpiler: it removes comments itself, so two bodies
 * that differ only in comments transpile to identical output. Any difference
 * is a real code change made by the scanner. Verified bidirectionally — a
 * comment-only diff compares equal, and a one-character code edit does not.
 *
 * If the ORIGINAL does not parse, the body was not JS after all (a template,
 * a mislabelled block): the caller keeps it verbatim rather than guessing.
 * That path cannot hide a leak silently — the strip tests assert named live
 * surfaces come out clean, so a body that starts being skipped turns them red.
 */
export function assertJsStripPreservesProgram(
  original: string,
  stripped: string,
  where: string,
): boolean {
  const t = new Bun.Transpiler({ loader: "js" });
  let before: string;
  try {
    before = t.transformSync(original);
  } catch {
    return false; // not parseable as JS — caller must keep the original
  }
  let after: string;
  try {
    after = t.transformSync(stripped);
  } catch (err) {
    throw new Error(
      `[comment-strip] JS strip produced unparseable code in ${where}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (before !== after) {
    throw new Error(
      `[comment-strip] JS strip CHANGED THE PROGRAM in ${where}. ` +
        `Comment removal must be a no-op; the scanner mis-read a string, regex or template literal.`,
    );
  }
  return true;
}

/** <script> types whose body is JavaScript. Anything else is left untouched. */
const JS_SCRIPT_TYPE = /^(?:text\/javascript|application\/javascript|module|text\/babel)$/i;

function isJsScript(openTag: string): boolean {
  const m = openTag.match(/\stype\s*=\s*["']?([^"'\s>]+)/i);
  if (!m) return true; // no type attribute ⇒ JavaScript
  return JS_SCRIPT_TYPE.test(m[1]!);
}

export function stripHtmlComments(
  html: string,
  keepPrefixes: string[] = [],
): string {
  return html
    .split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/i)
    .map((part, i) => {
      if (i % 2 === 1) {
        if (/^<style\b/i.test(part)) {
          const open = part.indexOf(">") + 1;
          const close = part.toLowerCase().lastIndexOf("</style>");
          if (open <= 0 || close < open) return part;
          return part.slice(0, open) + stripCssComments(part.slice(open, close)) + part.slice(close);
        }
        const open = part.indexOf(">") + 1;
        const close = part.toLowerCase().lastIndexOf("</script>");
        if (open <= 0 || close < open) return part;
        if (!isJsScript(part.slice(0, open))) return part; // JSON-LD et al.
        const body = part.slice(open, close);
        const stripped = stripJsComments(body);
        if (!assertJsStripPreservesProgram(body, stripped, "inline <script>")) return part;
        return part.slice(0, open) + stripped + part.slice(close);
      }
      return part.replace(/<!--([\s\S]*?)-->/g, (_match, content: string) =>
        keepPrefixes.some((p) => content.startsWith(p)) ? `<!--${content}-->` : "",
      );
    })
    .join("");
}
