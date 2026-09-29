import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const defaultRunner = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
};

export function parseRepo(input) {
  const raw = String(input || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("GitHub repo required (owner/name)");
  let slug;
  const ssh = raw.match(/^git@github\.com:(.+)$/);
  if (ssh) slug = ssh[1];
  else if (/^[a-z]+:\/\//i.test(raw)) {
    const u = new URL(raw);
    if (u.host !== "github.com") throw new Error(`Not a github.com repo: ${raw}`);
    slug = u.pathname.replace(/^\/+/, "");
  } else slug = raw;
  slug = slug.replace(/\.git$/, "").replace(/\/+$/, "");
  const [owner, name, ...rest] = slug.split("/");
  if (!owner || !name || rest.length) throw new Error(`Invalid repo "${input}" - expected owner/name`);
  return { owner, name, slug: `${owner}/${name}`, sshUrl: `git@github.com:${owner}/${name}.git` };
}

export async function whoami(runner = defaultRunner) {
  const r = runner("gh", ["api", "user", "--jq", ".login"]);
  const login = r.stdout.trim();
  if (r.status !== 0 || !login) throw new Error("GitHub not authenticated - run `gh auth login`");
  return { login };
}

export async function ensureRepo(repo, runner = defaultRunner) {
  if (runner("gh", ["repo", "view", repo.slug, "--json", "name"]).status === 0) return;
  const r = runner("gh", ["repo", "create", repo.slug, "--private"]);
  if (r.status !== 0) throw new Error(`Failed to create repo "${repo.slug}": ${(r.stderr || r.stdout).trim()}`);
}

export async function pushDir({ gitDir, workTree, repo, branch, message }, runner = defaultRunner) {
  const git = (...args) => runner("git", [`--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...args], { cwd: workTree });
  const must = (r, what) => {
    if (r.status !== 0) throw new Error(`git ${what} failed: ${(r.stderr || r.stdout).trim()}`);
    return r;
  };
  if (!existsSync(gitDir)) must(git("init", "-b", branch), "init");
  if (git("remote", "set-url", "origin", repo.sshUrl).status !== 0) must(git("remote", "add", "origin", repo.sshUrl), "remote add");
  must(git("add", "-A"), "add");
  const dirty = !!must(git("status", "--porcelain"), "status").stdout.trim();
  if (dirty) {
    must(git("commit", "-m", message), "commit");
    must(git("push", "-u", "origin", branch), "push");
  }
  return { pushed: dirty, commit: git("rev-parse", "HEAD").stdout.trim() };
}
