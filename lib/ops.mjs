import path from "node:path";
import { rm } from "node:fs/promises";
import { cloneSite, computeSourceHash } from "./framer.mjs";
import { discoverRuntimeAssets } from "./discover.mjs";
import { whoami, ensureProject, deploy } from "./cloudflare.mjs";
import * as reg from "./registry.mjs";

const now = () => new Date().toISOString();
export const buildDir = (ctx, id) => path.join(ctx.sitesDir, id, "dist");
export const siteOrigin = (site) => site.origin || `https://${site.cloudflareProject}.pages.dev`;

export async function runClone({ framerUrl, name, project }, ctx, onLog) {
  const r = await reg.load(ctx.regPath);
  const id = reg.deriveId(framerUrl, new Set(r.sites.map((s) => s.id)));
  const cloudflareProject = project || id;
  onLog?.(`ensuring Cloudflare project "${cloudflareProject}"`);
  await ensureProject(cloudflareProject);
  const origin = `https://${cloudflareProject}.pages.dev`;
  const build = { keepCdn: false, keepTracking: false, keepBadge: false };
  const res = await cloneSite({ framerUrl, outDir: buildDir(ctx, id), origin, build, onLog });
  await discoverRuntimeAssets({ id, dir: buildDir(ctx, id), origin, build, onLog });
  const record = {
    id, name: name || id, framerUrl, cloudflareProject, liveUrl: "", origin,
    build,
    syncedHash: res.sourceHash, lastSyncedAt: now(),
    remoteHash: res.sourceHash, lastCheckedAt: now(),
    lastPublishedAt: "", lastDeploymentId: "",
  };
  reg.upsertSite(r, record);
  await reg.save(ctx.regPath, r);
  return record;
}

export async function runSync(id, ctx, onLog) {
  const r = await reg.load(ctx.regPath);
  const site = reg.getSite(r, id);
  if (!site) throw new Error(`No site "${id}"`);
  const origin = siteOrigin(site);
  const res = await cloneSite({ framerUrl: site.framerUrl, outDir: buildDir(ctx, id), origin, build: site.build, onLog });
  if (!site.build.keepCdn) await discoverRuntimeAssets({ id, dir: buildDir(ctx, id), origin, build: site.build, onLog });
  reg.upsertSite(r, { id, origin, syncedHash: res.sourceHash, lastSyncedAt: now(), remoteHash: res.sourceHash, lastCheckedAt: now() });
  await reg.save(ctx.regPath, r);
  return reg.getSite(r, id);
}

export async function runCheck(id, ctx) {
  const r = await reg.load(ctx.regPath);
  const site = reg.getSite(r, id);
  if (!site) throw new Error(`No site "${id}"`);
  const remoteHash = await computeSourceHash(site.framerUrl);
  reg.upsertSite(r, { id, remoteHash, lastCheckedAt: now() });
  await reg.save(ctx.regPath, r);
  return { hasUpdate: remoteHash !== site.syncedHash, remoteHash };
}

export async function runPublish(id, ctx, onLog) {
  const r = await reg.load(ctx.regPath);
  const site = reg.getSite(r, id);
  if (!site) throw new Error(`No site "${id}"`);
  await whoami(); // preflight; throws if not authenticated
  onLog?.(`deploying "${id}" -> ${site.cloudflareProject}`);
  const { deploymentId, url } = await deploy({ dir: buildDir(ctx, id), project: site.cloudflareProject });
  reg.upsertSite(r, { id, liveUrl: url || site.liveUrl, lastPublishedAt: now(), lastDeploymentId: deploymentId });
  await reg.save(ctx.regPath, r);
  return reg.getSite(r, id);
}

export async function removeSiteAndBuild(id, ctx) {
  const r = await reg.load(ctx.regPath);
  reg.removeSite(r, id);
  await reg.save(ctx.regPath, r);
  await rm(path.join(ctx.sitesDir, id), { recursive: true, force: true });
}
