import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runPushGithub, gitDir, buildDir } from "../lib/ops.mjs";
import { save } from "../lib/registry.mjs";

async function fixture(site) {
  const root = await mkdtemp(path.join(tmpdir(), "fm-push-"));
  const ctx = { regPath: path.join(root, "registry.json"), sitesDir: path.join(root, "sites") };
  await save(ctx.regPath, { version: 1, sites: [site] });
  await mkdir(buildDir(ctx, site.id), { recursive: true });
  await writeFile(path.join(buildDir(ctx, site.id), "index.html"), "<h1>hi</h1>");
  return ctx;
}

const okRunner = (calls) => (cmd, args) => {
  calls.push([cmd, ...args].join(" "));
  const key = args.join(" ");
  if (key.includes("api user")) return { status: 0, stdout: "acme\n", stderr: "" };
  if (key.includes("status --porcelain")) return { status: 0, stdout: "?? index.html\n", stderr: "" };
  if (key.includes("rev-parse HEAD")) return { status: 0, stdout: "c0ffee1\n", stderr: "" };
  return { status: 0, stdout: "", stderr: "" };
};

const withGithub = { id: "demo", name: "Demo", framerUrl: "https://demo.framer.app/", cloudflareProject: "demo", github: { repo: "acme/demo", branch: "main" } };

test("runPushGithub refuses a site with no github repo configured", async () => {
  const ctx = await fixture({ id: "demo", name: "Demo", framerUrl: "https://demo.framer.app/", cloudflareProject: "demo" });
  await assert.rejects(() => runPushGithub("demo", ctx, null, okRunner([])), /github|repo/i);
});

test("runPushGithub refuses an unknown site", async () => {
  const ctx = await fixture(withGithub);
  await assert.rejects(() => runPushGithub("nope", ctx, null, okRunner([])), /No site/i);
});

test("runPushGithub pushes the build dir with the git dir kept outside it", async () => {
  const calls = [];
  const ctx = await fixture(withGithub);
  await runPushGithub("demo", ctx, null, okRunner(calls));
  const push = calls.find((c) => c.includes("git ") && c.includes("push"));
  assert.ok(push, calls.join(" | "));
  assert.ok(push.includes(`--git-dir=${gitDir(ctx, "demo")}`), push);
  assert.ok(push.includes(`--work-tree=${buildDir(ctx, "demo")}`), push);
  assert.ok(!gitDir(ctx, "demo").startsWith(buildDir(ctx, "demo")), "git dir must not live inside dist");
});

test("runPushGithub ensures the repo exists before pushing", async () => {
  const calls = [];
  const ctx = await fixture(withGithub);
  await runPushGithub("demo", ctx, null, okRunner(calls));
  assert.ok(calls.some((c) => c.includes("gh repo view acme/demo")), calls.join(" | "));
});

test("runPushGithub records the commit and push time in the registry", async () => {
  const ctx = await fixture(withGithub);
  const site = await runPushGithub("demo", ctx, null, okRunner([]));
  assert.equal(site.github.lastCommit, "c0ffee1");
  assert.match(site.github.lastPushedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// Every test above stubs git. This one drives real git against a local bare remote,
// so a wrong flag or a misread `git status` cannot pass unnoticed.
test("runPushGithub against real git: first push commits, second is a no-op", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fm-realgit-"));
  const remote = path.join(root, "remote.git");
  const ctx = { regPath: path.join(root, "registry.json"), sitesDir: path.join(root, "sites") };
  await save(ctx.regPath, { version: 1, sites: [withGithub] });
  await mkdir(buildDir(ctx, "demo"), { recursive: true });
  await writeFile(path.join(buildDir(ctx, "demo"), "index.html"), "<h1>v1</h1>");

  const real = (cmd, args, opts = {}) => {
    if (cmd === "gh") return { status: 0, stdout: "acme\n", stderr: "" };
    const a = args.map((x) => (x === "git@github.com:acme/demo.git" ? remote : x));
    const r = spawnSync(cmd, a, { encoding: "utf8", ...opts });
    return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
  };
  assert.equal(spawnSync("git", ["init", "--bare", "-q", remote]).status, 0);

  const first = [];
  await runPushGithub("demo", ctx, (l) => first.push(l), real);
  assert.ok(first.some((l) => l.startsWith("pushed ")), first.join(" | "));

  const head = spawnSync("git", ["--git-dir=" + remote, "rev-parse", "main"], { encoding: "utf8" });
  assert.equal(head.status, 0, "remote must have a main branch after the first push");

  const second = [];
  const site = await runPushGithub("demo", ctx, (l) => second.push(l), real);
  assert.ok(second.includes("no changes to push"), second.join(" | "));
  assert.equal(site.github.lastCommit, head.stdout.trim());
});
