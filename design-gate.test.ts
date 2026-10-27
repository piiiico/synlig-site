import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { measure } from "./design-gate";

// Fixture: the picked direction's mockup (tmp/design-1026/dir-a.html) inlined minimal.
const A = `<html><style>@font-face{font-family:N;src:url(a.woff2)}@font-face{font-family:M;src:url(b.woff2)}
:root{--paper:#f3eee4;--ink:#17140f;--red:#9b2c1f;--serif:N,Georgia,serif;--mono:M,ui-monospace,monospace}
body{font:400 19px/1.55 var(--serif)}</style><a class="logo" href="/">Synlig<sup>[1]</sup></a></html>`;

test("one-system page is green", () => expect(measure({ "/": A, "/x": A }).breaches).toEqual([]));
test("a third font in shorthand reds", () =>
  expect(measure({ "/": A.replace("</style>", "p{font:400 12px Arial}</style>") }).breaches).toEqual(["font stacks 3 > 2"]));
test("oklch counts as a colour", () => {
  const extra = Array.from({ length: 9 }, (_, i) => `.c${i}{color:oklch(0.${i + 1} 0.1 20)}`).join("");
  expect(measure({ "/": A.replace("</style>", extra + "</style>") }).breaches).toEqual([]); // 3 hex + 9 oklch = 12
  expect(measure({ "/": A.replace("</style>", extra + ".z{color:#010203}</style>") }).breaches).toEqual(["colors 13 > 12"]);
});
test("a second logo name reds", () =>
  expect(measure({ "/": A, "/b": A.replace(">Synlig<sup>", ">Synlig Digital<sup>") }).breaches).toEqual(["logo variants 2 ≠ 1"]));
test("a page with no logo reds", () =>
  expect(measure({ "/": A, "/b": A.replace('class="logo"', 'class="brand"') }).breaches).toEqual(["logo variants 2 ≠ 1"]));
test("zero pages is never green", () => expect(measure({}).breaches.length).toBeGreaterThan(0));
test("JSON-LD and comments do not paint", () =>
  expect(measure({ "/": A.replace("</html>", '<script type="application/ld+json">{"c":"#abcdef"}</script><!-- #fedcba --></html>') }).breaches).toEqual([]));
