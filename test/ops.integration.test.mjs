import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClone, runCheck, buildDir } from "../lib/ops.mjs";
import { deriveId, load } from "../lib/registry.mjs";

// Needs a real Framer site (FRAMER_TEST_URL) and an existing Cloudflare project (CF_TEST_PROJECT).
// Skips when OFFLINE=1 or either var is unset.
const TEST_URL = process.env.FRAMER_TEST_URL;
const TEST_PROJECT = process.env.CF_TEST_PROJECT;
const maybe = process.env.OFFLINE || !TEST_URL || !TEST_PROJECT ? test.skip : test;

maybe("runClone records a site and builds into sites/<id>/dist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fm-ops-"));
  const ctx = { regPath: path.join(root, "registry.json"), sitesDir: path.join(root, "sites") };
  const expectedId = deriveId(TEST_URL, new Set());
  // Pass an existing project to keep runClone idempotent (an empty project would call ensureProject).
  const site = await runClone(
    { framerUrl: TEST_URL, name: "Test", project: TEST_PROJECT },
    ctx
  );
  assert.equal(site.id, expectedId);
  assert.ok(site.syncedHash.startsWith("sha256:"));
  assert.ok(existsSync(path.join(buildDir(ctx, site.id), "index.html")));

  const reg = await load(ctx.regPath);
  assert.equal(reg.sites.length, 1);

  const check = await runCheck(site.id, ctx);
  assert.equal(check.hasUpdate, false, "just-cloned site is up to date");
});
