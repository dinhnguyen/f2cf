import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImports, stripExternalScripts, hideBadge, hashSource, fetchBuf, isLocalizableAsset } from "../lib/framer.mjs";

test("isLocalizableAsset localizes static resources but leaves module/CMS base URLs (new URL bases) alone", () => {
  // static resources -> safe to rewrite to root-relative
  for (const p of ["/assets/x.woff2", "/images/a.png", "/images/b.webp", "/x.svg", "/y.css"]) {
    assert.equal(isLocalizableAsset(p), true, p);
  }
  // used as `new URL(rel, base)` bases on the live runtime -> must stay absolute (the bug)
  for (const p of [
    "/modules/4Ds45TQY/42Mq/r4GnmA_r2.js",
    "/modules/4Ds45TQY/42Mq/r4GnmA_r2-indexes-default-0.framercms",
    "/sites/ID/react.Cv7ZhSil.mjs",
    "/modules/base/", // trailing-slash base hint
  ]) {
    assert.equal(isLocalizableAsset(p), false, p);
  }
});

test("extractImports finds static, side-effect, and template-literal dynamic imports", () => {
  const js = [
    'import{a}from"./react.mjs";',
    "import`./side.mjs`;".replace("`", '"').replace("`", '"'),
    'import(`./PX9.DvzhLYxY.mjs`)',
    'import(`./skip-${x}.mjs`)',
  ].join("\n");
  const specs = extractImports(js);
  assert.ok(specs.includes("./react.mjs"));
  assert.ok(specs.includes("./PX9.DvzhLYxY.mjs"));
  assert.ok(!specs.some((s) => s.includes("${")));
});

test("stripExternalScripts removes analytics and neutralizes edit preload", () => {
  const html =
    '<script async src="https://events.framer.com/script?v=2" data-fid="x"></script>' +
    'n.href="https://framer.com/edit/init.mjs";';
  const out = stripExternalScripts(html);
  assert.ok(!out.includes("events.framer.com"));
  assert.ok(!out.includes("framer.com/edit/init.mjs"));
  assert.ok(out.includes("about:blank"));
});

test("hideBadge injects the hide-CSS before </head>", () => {
  const out = hideBadge("<head><title>x</title></head><body></body>");
  assert.ok(out.includes("#__framer-badge-container"));
  assert.ok(out.includes("display:none!important"));
  assert.ok(out.indexOf("<style>") < out.indexOf("</head>"));
});

test("hashSource is stable for same asset set and changes when a bundle hash changes", () => {
  const a = '<img src="https://framerusercontent.com/images/x.png?scale-down-to=512">' +
            '<script src="https://framerusercontent.com/sites/ID/main.AAAA.mjs"></script>';
  const b = a.replace("main.AAAA.mjs", "main.BBBB.mjs");
  assert.equal(hashSource(a), hashSource(a));
  assert.notEqual(hashSource(a), hashSource(b));
  assert.ok(hashSource(a).startsWith("sha256:"));
});

test("fetchBuf does not retry a permanent 404", async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 404 };
  };
  try {
    await assert.rejects(() => fetchBuf("https://x/y.png", 4), /404/);
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(calls, 1, "permanent error must not be retried");
});
