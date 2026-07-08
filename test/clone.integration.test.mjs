import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cloneSite, computeSourceHash } from "../lib/framer.mjs";

// Network-dependent smoke test. Needs a real Framer site: set FRAMER_TEST_URL to run.
// Skips when OFFLINE=1 or FRAMER_TEST_URL is unset.
const TEST_URL = process.env.FRAMER_TEST_URL;
const maybe = process.env.OFFLINE || !TEST_URL ? test.skip : test;

maybe("cloneSite produces a self-contained dist with a closed module graph", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "fm-clone-"));
  const res = await cloneSite({
    framerUrl: TEST_URL,
    outDir: out,
    build: { keepCdn: false, keepTracking: false, keepBadge: false },
  });
  assert.ok(res.moduleCount > 10, "should download the module graph");
  assert.ok(existsSync(path.join(out, "index.html")), "index.html at root");

  const html = await readFile(path.join(out, "index.html"), "utf8");
  // Image/font/css assets referenced in the HTML markup must be localized. Other CDN URLs
  // (CMS/module paths the runtime feeds to new URL) intentionally stay absolute - rewriting
  // those crashes Framer's hydration, so we must NOT assert them away.
  const assetRefs = [...html.matchAll(/https:\/\/framerusercontent\.com\/[^"'`)\s\\]*/g)]
    .map((m) => m[0])
    .filter((u) => /\.(woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|css)(\?|$)/i.test(u));
  assert.equal(assetRefs.length, 0, "HTML image/font/css assets should be localized");
  assert.ok(html.includes("display:none!important"), "badge hidden");
});

maybe("computeSourceHash returns a sha256 string", async () => {
  const h = await computeSourceHash(TEST_URL);
  assert.ok(h.startsWith("sha256:"));
});
