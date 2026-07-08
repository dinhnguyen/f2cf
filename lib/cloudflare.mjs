import { spawnSync } from "node:child_process";

const defaultRunner = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
};

const wrangler = (runner, ...args) => runner("npx", ["wrangler", ...args]);

export async function whoami(runner = defaultRunner) {
  const r = wrangler(runner, "whoami");
  const out = r.stdout + r.stderr;
  const email = (out.match(/email\s+'?([^\s'"@]+@[^\s'"]+\.[a-z]{2,})/i) || [])[1] || "";
  if (r.status !== 0 || !email) throw new Error("Cloudflare not authenticated - run `npx wrangler login`");
  const account = (out.match(/│\s*([^│]+?)\s*│\s*[0-9a-f]{32}/) || [])[1]?.trim() || "";
  return { email, account };
}

export async function ensureProject(name, runner = defaultRunner) {
  const r = wrangler(runner, "pages", "project", "create", name, "--production-branch", "production");
  if (r.status === 0) return;
  if (/already exists/i.test(r.stdout + r.stderr)) return; // idempotent
  throw new Error(`Failed to create project "${name}": ${(r.stderr || r.stdout).trim()}`);
}

export async function deploy({ dir, project }, runner = defaultRunner) {
  const r = wrangler(runner, "pages", "deploy", dir, "--project-name", project, "--branch", "production");
  if (r.status !== 0) throw new Error(`Deploy failed: ${(r.stderr || r.stdout).trim()}`);
  const out = r.stdout + r.stderr;
  const url = (out.match(/https:\/\/[^\s]*\.pages\.dev/) || [])[0] || "";
  if (!url) throw new Error(`Deploy produced no *.pages.dev URL: ${out.trim().slice(-200)}`);
  const deploymentId = (url.match(/https:\/\/([^.]+)\./) || [])[1] || "";
  return { deploymentId, url };
}
