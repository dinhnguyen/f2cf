import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepo, whoami, ensureRepo, pushDir } from "../lib/github.mjs";

const runnerFor = (map) => (cmd, args) => {
  const key = args.join(" ");
  const hit = Object.entries(map).find(([k]) => key.includes(k));
  return hit ? hit[1] : { status: 1, stdout: "", stderr: "unmocked: " + key };
};

const recordingRunner = (map, calls) => (cmd, args) => {
  calls.push([cmd, ...args].join(" "));
  return runnerFor(map)(cmd, args);
};

test("parseRepo accepts an https url", () => {
  const r = parseRepo("https://github.com/acme/my-site");
  assert.equal(r.owner, "acme");
  assert.equal(r.name, "my-site");
  assert.equal(r.slug, "acme/my-site");
  assert.equal(r.sshUrl, "git@github.com:acme/my-site.git");
});

test("parseRepo strips a trailing .git and slash", () => {
  assert.equal(parseRepo("https://github.com/acme/my-site.git/").slug, "acme/my-site");
});

test("parseRepo accepts an ssh url", () => {
  assert.equal(parseRepo("git@github.com:acme/my-site.git").slug, "acme/my-site");
});

test("parseRepo accepts a bare owner/name", () => {
  assert.equal(parseRepo("acme/my-site").slug, "acme/my-site");
});

test("parseRepo rejects a non-github host", () => {
  assert.throws(() => parseRepo("https://gitlab.com/acme/my-site"), /github/i);
});

test("parseRepo rejects input without owner and name", () => {
  assert.throws(() => parseRepo("my-site"), /owner\/name|invalid/i);
});

test("whoami returns the login", async () => {
  const runner = runnerFor({ "api user": { status: 0, stdout: "dinhnguyen\n", stderr: "" } });
  assert.equal((await whoami(runner)).login, "dinhnguyen");
});

test("whoami throws when gh is not authenticated", async () => {
  const runner = runnerFor({ "api user": { status: 1, stdout: "", stderr: "gh: To get started with GitHub CLI, please run: gh auth login" } });
  await assert.rejects(() => whoami(runner), /auth|login/i);
});

test("ensureRepo does not create when the repo already exists", async () => {
  const calls = [];
  const runner = recordingRunner({ "repo view": { status: 0, stdout: "acme/my-site\n", stderr: "" } }, calls);
  await ensureRepo(parseRepo("acme/my-site"), runner);
  assert.ok(!calls.some((c) => c.includes("repo create")), `unexpected create: ${calls.join(" | ")}`);
});

test("ensureRepo creates a private repo when it is missing", async () => {
  const calls = [];
  const runner = recordingRunner({
    "repo view": { status: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository" },
    "repo create": { status: 0, stdout: "https://github.com/acme/my-site\n", stderr: "" },
  }, calls);
  await ensureRepo(parseRepo("acme/my-site"), runner);
  const create = calls.find((c) => c.includes("repo create"));
  assert.ok(create, `no create call: ${calls.join(" | ")}`);
  assert.match(create, /--private/);
});

test("ensureRepo surfaces an unexpected create failure", async () => {
  const runner = runnerFor({
    "repo view": { status: 1, stdout: "", stderr: "Could not resolve to a Repository" },
    "repo create": { status: 1, stdout: "", stderr: "name already taken by another user" },
  });
  await assert.rejects(() => ensureRepo(parseRepo("acme/my-site"), runner), /name already taken/);
});

test("pushDir keeps the git dir out of the work tree", async () => {
  const calls = [];
  const runner = recordingRunner({
    "status --porcelain": { status: 0, stdout: " M index.html\n", stderr: "" },
    "": { status: 0, stdout: "", stderr: "" },
  }, calls);
  await pushDir({ gitDir: "/s/x/git", workTree: "/s/x/dist", repo: parseRepo("acme/my-site"), branch: "main", message: "sync" }, runner);
  assert.ok(calls.every((c) => c.includes("--git-dir=/s/x/git") && c.includes("--work-tree=/s/x/dist")), calls.join(" | "));
});

test("pushDir commits and pushes when the tree is dirty", async () => {
  const calls = [];
  const runner = recordingRunner({
    "status --porcelain": { status: 0, stdout: "?? index.html\n", stderr: "" },
    "rev-parse HEAD": { status: 0, stdout: "abc1234def\n", stderr: "" },
    "": { status: 0, stdout: "", stderr: "" },
  }, calls);
  const r = await pushDir({ gitDir: "/s/x/git", workTree: "/s/x/dist", repo: parseRepo("acme/my-site"), branch: "main", message: "sync 1" }, runner);
  assert.equal(r.pushed, true);
  assert.equal(r.commit, "abc1234def");
  assert.ok(calls.some((c) => c.includes("commit") && c.includes("sync 1")), calls.join(" | "));
  assert.ok(calls.some((c) => c.includes("push") && c.includes("main")), calls.join(" | "));
});

test("pushDir skips the commit when nothing changed", async () => {
  const calls = [];
  const runner = recordingRunner({
    "status --porcelain": { status: 0, stdout: "", stderr: "" },
    "rev-parse HEAD": { status: 0, stdout: "abc1234def\n", stderr: "" },
    "": { status: 0, stdout: "", stderr: "" },
  }, calls);
  const r = await pushDir({ gitDir: "/s/x/git", workTree: "/s/x/dist", repo: parseRepo("acme/my-site"), branch: "main", message: "sync" }, runner);
  assert.equal(r.pushed, false);
  assert.ok(!calls.some((c) => c.includes(" commit ")), calls.join(" | "));
});

test("pushDir points the remote at the requested repo", async () => {
  const calls = [];
  const runner = recordingRunner({
    "status --porcelain": { status: 0, stdout: "?? a\n", stderr: "" },
    "rev-parse HEAD": { status: 0, stdout: "abc\n", stderr: "" },
    "": { status: 0, stdout: "", stderr: "" },
  }, calls);
  await pushDir({ gitDir: "/s/x/git", workTree: "/s/x/dist", repo: parseRepo("acme/my-site"), branch: "main", message: "sync" }, runner);
  assert.ok(calls.some((c) => c.includes("remote") && c.includes("git@github.com:acme/my-site.git")), calls.join(" | "));
});

test("pushDir throws when the push fails", async () => {
  const runner = (cmd, args) => {
    const key = args.join(" ");
    if (key.includes("status --porcelain")) return { status: 0, stdout: "?? a\n", stderr: "" };
    if (key.includes("push")) return { status: 1, stdout: "", stderr: "remote: Permission denied" };
    return { status: 0, stdout: "abc\n", stderr: "" };
  };
  await assert.rejects(
    () => pushDir({ gitDir: "/s/x/git", workTree: "/s/x/dist", repo: parseRepo("acme/my-site"), branch: "main", message: "s" }, runner),
    /Permission denied/,
  );
});
