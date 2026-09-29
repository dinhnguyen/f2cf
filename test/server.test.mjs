import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../server.mjs";

async function boot() {
  const root = await mkdtemp(path.join(tmpdir(), "fm-srv-"));
  const publicDir = path.join(root, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, "index.html"), "<h1>dash</h1>");
  const ctx = { regPath: path.join(root, "registry.json"), sitesDir: path.join(root, "sites"), publicDir };
  const server = createServer(ctx);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, ctx, base: `http://127.0.0.1:${server.address().port}` };
}

test("GET /api/sites is empty on a fresh registry", async () => {
  const { server, base } = await boot();
  const body = await (await fetch(`${base}/api/sites`)).json();
  assert.deepEqual(body.sites, []);
  server.close();
});

test("GET / serves the dashboard; unknown path 404s", async () => {
  const { server, base } = await boot();
  assert.match(await (await fetch(`${base}/`)).text(), /dash/);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  server.close();
});

test("POST /api/sites without framerUrl is 400", async () => {
  const { server, base } = await boot();
  const r = await fetch(`${base}/api/sites`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 400);
  server.close();
});

test("POST /api/sites with malformed JSON returns 400 and the server survives", async () => {
  const { server, base } = await boot();
  const r = await fetch(`${base}/api/sites`, { method: "POST", headers: { "content-type": "application/json" }, body: "not json{{{" });
  assert.equal(r.status, 400);
  assert.equal((await fetch(`${base}/api/sites`)).status, 200); // still alive
  server.close();
});

test("static serving rejects encoded path traversal", async () => {
  const { server, base } = await boot();
  assert.equal((await fetch(`${base}/..%2f..%2f..%2fetc%2fpasswd`)).status, 404);
  server.close();
});

test("POST /api/sites rejects an invalid githubRepo", async () => {
  const { server, base } = await boot();
  const r = await fetch(`${base}/api/sites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ framerUrl: "https://demo.framer.app/", githubRepo: "https://gitlab.com/a/b" }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test("POST /api/sites/:id/push is an accepted route", async () => {
  const { server, base } = await boot();
  const r = await fetch(`${base}/api/sites/demo/push`, { method: "POST" });
  assert.equal(r.status, 202);
  server.close();
});

async function seed(ctx, site) {
  await writeFile(ctx.regPath, JSON.stringify({ version: 1, sites: [site] }));
}
const demo = { id: "demo", name: "Demo", framerUrl: "https://demo.framer.app/", cloudflareProject: "demo" };

test("PATCH /api/sites/:id links a github repo to an existing site", async () => {
  const { server, base, ctx } = await boot();
  await seed(ctx, demo);
  const r = await fetch(`${base}/api/sites/demo`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ githubRepo: "https://github.com/acme/demo.git" }),
  });
  assert.equal(r.status, 200);
  const { sites } = await (await fetch(`${base}/api/sites`)).json();
  assert.equal(sites[0].github.repo, "acme/demo");
  assert.equal(sites[0].github.branch, "main");
  server.close();
});

test("PATCH /api/sites/:id with an empty repo unlinks it", async () => {
  const { server, base, ctx } = await boot();
  await seed(ctx, { ...demo, github: { repo: "acme/demo", branch: "main", lastPushedAt: "", lastCommit: "" } });
  const r = await fetch(`${base}/api/sites/demo`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ githubRepo: "" }),
  });
  assert.equal(r.status, 200);
  const { sites } = await (await fetch(`${base}/api/sites`)).json();
  assert.equal(sites[0].github, null);
  server.close();
});

test("PATCH /api/sites/:id rejects an invalid repo", async () => {
  const { server, base, ctx } = await boot();
  await seed(ctx, demo);
  const r = await fetch(`${base}/api/sites/demo`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ githubRepo: "https://gitlab.com/a/b" }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test("PATCH /api/sites/:id on an unknown site is 404", async () => {
  const { server, base } = await boot();
  const r = await fetch(`${base}/api/sites/nope`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ githubRepo: "acme/demo" }),
  });
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /no such site/i);
  server.close();
});

test("PATCH /api/sites/:id keeps an existing push record when the repo is unchanged", async () => {
  const { server, base, ctx } = await boot();
  await seed(ctx, { ...demo, github: { repo: "acme/demo", branch: "main", lastPushedAt: "2026-01-01T00:00:00.000Z", lastCommit: "c0ffee1" } });
  await fetch(`${base}/api/sites/demo`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ githubRepo: "acme/demo" }),
  });
  const { sites } = await (await fetch(`${base}/api/sites`)).json();
  assert.equal(sites[0].github.lastCommit, "c0ffee1");
  server.close();
});

test("PATCH /api/sites/:id clears the push record when the repo changes", async () => {
  const { server, base, ctx } = await boot();
  await seed(ctx, { ...demo, github: { repo: "acme/demo", branch: "main", lastPushedAt: "2026-01-01T00:00:00.000Z", lastCommit: "c0ffee1" } });
  await fetch(`${base}/api/sites/demo`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ githubRepo: "acme/other" }),
  });
  const { sites } = await (await fetch(`${base}/api/sites`)).json();
  assert.equal(sites[0].github.repo, "acme/other");
  assert.equal(sites[0].github.lastCommit, "");
  server.close();
});
