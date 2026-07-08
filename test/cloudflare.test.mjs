import { test } from "node:test";
import assert from "node:assert/strict";
import { whoami, ensureProject, deploy } from "../lib/cloudflare.mjs";

const runnerFor = (map) => (cmd, args) => {
  const key = args.join(" ");
  const hit = Object.entries(map).find(([k]) => key.includes(k));
  return hit ? hit[1] : { status: 1, stdout: "", stderr: "unmocked: " + key };
};

test("whoami parses email and account", async () => {
  const runner = runnerFor({
    "whoami": { status: 0, stdout: "👋 You are logged in with an OAuth Token, associated with the email a@b.com.\n│ acme │ 401fc117d3f628de9c91082a52beacbc │\n", stderr: "" },
  });
  const who = await whoami(runner);
  assert.equal(who.email, "a@b.com");
  assert.equal(who.account, "acme");
});

test("whoami handles a dotted email local-part", async () => {
  const runner = runnerFor({
    "whoami": { status: 0, stdout: "👋 associated with the email first.last@company.com.\n│ acme │ 401fc117d3f628de9c91082a52beacbc │\n", stderr: "" },
  });
  const who = await whoami(runner);
  assert.equal(who.email, "first.last@company.com");
});

test("whoami throws when not authenticated even if wrangler exits 0", async () => {
  const runner = runnerFor({ "whoami": { status: 0, stdout: "You are not authenticated. Please run `wrangler login`.\n", stderr: "" } });
  await assert.rejects(() => whoami(runner), /auth|login/i);
});

test("whoami throws on non-zero exit", async () => {
  const runner = runnerFor({ "whoami": { status: 1, stdout: "", stderr: "boom" } });
  await assert.rejects(() => whoami(runner), /auth|login/i);
});

test("ensureProject is idempotent on already-exists", async () => {
  const runner = runnerFor({ "project create": { status: 1, stdout: "", stderr: "project already exists" } });
  await ensureProject("example-site", runner); // must not throw
});

test("deploy extracts deployment url and id", async () => {
  const runner = runnerFor({
    "pages deploy": { status: 0, stdout: "✨ Deployment complete! Take a peek over at https://0d787090.example-site.pages.dev\n", stderr: "" },
  });
  const r = await deploy({ dir: "/tmp/x", project: "example-site" }, runner);
  assert.match(r.url, /example-site\.pages\.dev/);
  assert.equal(r.deploymentId, "0d787090");
});

test("deploy throws when output has no pages.dev url", async () => {
  const runner = runnerFor({ "pages deploy": { status: 0, stdout: "Uploaded 3 files. (unexpected)\n", stderr: "" } });
  await assert.rejects(() => deploy({ dir: "/tmp/x", project: "p" }, runner), /pages\.dev|URL/i);
});
