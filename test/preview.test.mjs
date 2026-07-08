import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startPreview, stopPreview, stopAll } from "../lib/preview.mjs";

test("startPreview serves the dir at root and reuses per id", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-prev-"));
  await writeFile(path.join(dir, "index.html"), "<h1>hi</h1>");
  await writeFile(path.join(dir, "a.txt"), "AAA");
  const { url, port } = await startPreview("s1", dir);
  const again = await startPreview("s1", dir);
  assert.equal(again.port, port, "same id reuses the same server");

  const root = await (await fetch(url)).text();
  assert.match(root, /hi/);
  const asset = await fetch(url + "a.txt");
  assert.equal(await asset.text(), "AAA");
  stopAll();
});

test("404s missing files, blocks traversal, and survives malformed URLs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-prev-"));
  await writeFile(path.join(dir, "index.html"), "<h1>hi</h1>");
  const { url } = await startPreview("s2", dir);
  assert.equal((await fetch(url + "nope.txt")).status, 404);
  const esc = await fetch(url + "..%2f..%2f..%2fetc%2fpasswd");
  assert.ok(esc.status === 404 || esc.status === 400, `traversal returned ${esc.status}`);
  const bad = await fetch(url + "%zz");
  assert.equal(bad.status, 400);
  // server still alive after the malformed request (process did not crash)
  assert.match(await (await fetch(url)).text(), /hi/);
  stopAll();
});
