import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setCloudflareProject, runPublish, isBuildStale } from "../lib/ops.mjs";
import { load } from "../lib/registry.mjs";

const okRunner = () => ({ status: 0, stdout: "", stderr: "" });

const ctxWith = async (site) => {
  const root = await mkdtemp(path.join(tmpdir(), "fm-proj-"));
  const ctx = { regPath: path.join(root, "registry.json"), sitesDir: path.join(root, "sites") };
  await writeFile(ctx.regPath, JSON.stringify({ version: 1, sites: [site] }, null, 2));
  return ctx;
};

const baseSite = {
  id: "meid", name: "MeID", framerUrl: "https://meid.framer.website/",
  cloudflareProject: "meid-website", origin: "https://meid-website.pages.dev",
  builtOrigin: "https://meid-website.pages.dev",
  liveUrl: "https://d87050b8.meid-website.pages.dev", lastDeploymentId: "d87050b8",
  build: { keepCdn: false, keepTracking: false, keepBadge: false },
  github: { repo: "acme/meid", branch: "main", lastPushedAt: "x", lastCommit: "abc" },
};

test("setCloudflareProject repoints project and origin, keeping source and repo", async () => {
  const ctx = await ctxWith(baseSite);
  const site = await setCloudflareProject("meid", "meid-site-v2", ctx, okRunner);
  assert.equal(site.cloudflareProject, "meid-site-v2");
  assert.equal(site.origin, "https://meid-site-v2.pages.dev");
  assert.equal(site.framerUrl, baseSite.framerUrl, "source site untouched");
  assert.deepEqual(site.github, baseSite.github, "git repo untouched");
  const reg = await load(ctx.regPath);
  assert.equal(reg.sites[0].cloudflareProject, "meid-site-v2", "persisted");
});

test("setCloudflareProject clears the stale deployment pointers", async () => {
  const ctx = await ctxWith(baseSite);
  const site = await setCloudflareProject("meid", "meid-site-v2", ctx, okRunner);
  assert.equal(site.liveUrl, "");
  assert.equal(site.lastDeploymentId, "");
  assert.equal(site.builtOrigin, "", "dist still holds the old origin");
});

test("setCloudflareProject rejects an invalid project name", async () => {
  const ctx = await ctxWith(baseSite);
  await assert.rejects(() => setCloudflareProject("meid", "Not Valid!", ctx, okRunner), /invalid/i);
});

test("setCloudflareProject is a no-op when the name is unchanged", async () => {
  const ctx = await ctxWith(baseSite);
  const site = await setCloudflareProject("meid", "meid-website", ctx, () => {
    throw new Error("must not touch Cloudflare");
  });
  assert.equal(site.liveUrl, baseSite.liveUrl, "existing deployment kept");
});

test("runPublish refuses a build made for a different origin", async () => {
  const ctx = await ctxWith({ ...baseSite, origin: "https://meid-site-v2.pages.dev", builtOrigin: "" });
  await assert.rejects(() => runPublish("meid", ctx), /stale|re-sync/i);
});

test("isBuildStale leaves legacy records with no builtOrigin alone", () => {
  const { builtOrigin, ...legacy } = baseSite;
  assert.equal(isBuildStale(legacy), false);
  assert.equal(isBuildStale(baseSite), false, "build matches its origin");
  assert.equal(isBuildStale({ ...baseSite, origin: "https://other.pages.dev" }), true);
});
