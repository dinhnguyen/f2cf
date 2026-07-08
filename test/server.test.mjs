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
  return { server, base: `http://127.0.0.1:${server.address().port}` };
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
