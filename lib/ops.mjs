import path from "node:path";
import { rm } from "node:fs/promises";
import { cloneSite, computeSourceHash } from "./framer.mjs";
import { discoverRuntimeAssets } from "./discover.mjs";
import { whoami, ensureProject, deploy } from "./cloudflare.mjs";
import * as gh from "./github.mjs";
import * as reg from "./registry.mjs";

const now = () => new Date().toISOString();
export const buildDir = (ctx, id) => path.join(ctx.sitesDir, id, "dist");
export const gitDir = (ctx, id) => path.join(ctx.sitesDir, id, "git");
export const siteOrigin = (site) => site.origin || `https://${site.cloudflareProject}.pages.dev`;
// legacy records predate builtOrigin; only flag a build we know was made elsewhere
export const isBuildStale = (site) => site.builtOrigin !== undefined && site.builtOrigin !== siteOrigin(site);

export async function runClone({ framerUrl, name, project, githubRepo }, ctx, onLog) {
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
    id, name: name || id, framerUrl, cloudflareProject, liveUrl: "", origin, builtOrigin: origin,
    build,
    github: githubRepo ? { repo: gh.parseRepo(githubRepo).slug, branch: "main", lastPushedAt: "", lastCommit: "" } : null,
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
  reg.upsertSite(r, { id, origin, builtOrigin: origin, syncedHash: res.sourceHash, lastSyncedAt: now(), remoteHash: res.sourceHash, lastCheckedAt: now() });
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
  if (isBuildStale(site)) throw new Error(`Build for "${id}" is stale - it targets ${site.builtOrigin || "another project"}, not ${siteOrigin(site)}; re-sync first`);
  await whoami(); // preflight; throws if not authenticated
  onLog?.(`deploying "${id}" -> ${site.cloudflareProject}`);
  const { deploymentId, url } = await deploy({ dir: buildDir(ctx, id), project: site.cloudflareProject });
  reg.upsertSite(r, { id, liveUrl: url || site.liveUrl, lastPublishedAt: now(), lastDeploymentId: deploymentId });
  await reg.save(ctx.regPath, r);
  return reg.getSite(r, id);
}

export async function setGithubRepo(id, githubRepo, ctx) {
  const r = await reg.load(ctx.regPath);
  const site = reg.getSite(r, id);
  if (!site) throw new Error(`No site "${id}"`);
  const slug = githubRepo ? gh.parseRepo(githubRepo).slug : "";
  const github = !slug ? null
    : slug === site.github?.repo ? site.github
    : { repo: slug, branch: site.github?.branch || "main", lastPushedAt: "", lastCommit: "" };
  reg.upsertSite(r, { id, github });
  await reg.save(ctx.regPath, r);
  return reg.getSite(r, id);
}

export async function setCloudflareProject(id, project, ctx, runner) {
  const r = await reg.load(ctx.regPath);
  const site = reg.getSite(r, id);
  if (!site) throw new Error(`No site "${id}"`);
  const name = String(project || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/.test(name)) throw new Error(`Invalid Cloudflare project name "${name}" - lowercase letters, digits and hyphens only`);
  if (name === site.cloudflareProject) return site;
  await ensureProject(name, runner);
  reg.upsertSite(r, { id, cloudflareProject: name, origin: `https://${name}.pages.dev`, builtOrigin: "", liveUrl: "", lastDeploymentId: "" });
  await reg.save(ctx.regPath, r);
  return reg.getSite(r, id);
}

export async function runPushGithub(id, ctx, onLog, runner) {
  const r = await reg.load(ctx.regPath);
  const site = reg.getSite(r, id);
  if (!site) throw new Error(`No site "${id}"`);
  if (!site.github?.repo) throw new Error(`Site "${id}" has no GitHub repo configured`);
  const repo = gh.parseRepo(site.github.repo);
  const branch = site.github.branch || "main";
  await gh.whoami(runner);
  onLog?.(`ensuring GitHub repo "${repo.slug}"`);
  await gh.ensureRepo(repo, runner);
  onLog?.(`pushing ${buildDir(ctx, id)} -> ${repo.slug}#${branch}`);
  const { pushed, commit } = await gh.pushDir(
    { gitDir: gitDir(ctx, id), workTree: buildDir(ctx, id), repo, branch, message: `sync ${now()}` },
    runner,
  );
  onLog?.(pushed ? `pushed ${commit}` : "no changes to push");
  reg.upsertSite(r, { id, github: { ...site.github, repo: repo.slug, branch, lastPushedAt: now(), lastCommit: commit } });
  await reg.save(ctx.regPath, r);
  return reg.getSite(r, id);
}

export async function removeSiteAndBuild(id, ctx) {
  const r = await reg.load(ctx.regPath);
  reg.removeSite(r, id);
  await reg.save(ctx.regPath, r);
  await rm(path.join(ctx.sitesDir, id), { recursive: true, force: true });
}
