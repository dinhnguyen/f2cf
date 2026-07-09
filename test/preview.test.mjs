import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
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

test("preview swaps the baked origin for the serving host and types versioned js mirrors", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-prev-"));
  const origin = "https://site.pages.dev";
  await writeFile(path.join(dir, "index.html"), `<img src="${origin}/framerusercontent.com/images/a.png">`);
  await mkdir(path.join(dir, "framer.com/m/icons"), { recursive: true });
  await writeFile(path.join(dir, "framer.com/m/icons/Key.js@0.0.53"), `import"${origin}/framerusercontent.com/modules/x.js";`);
  const { url } = await startPreview("s3", dir, { origin });
  const host = new URL(url).host;

  const html = await (await fetch(url)).text();
  assert.ok(html.includes(`http://${host}/framerusercontent.com/images/a.png`), "origin swapped in html");
  assert.ok(!html.includes("site.pages.dev"));

  const js = await fetch(url + "framer.com/m/icons/Key.js@0.0.53");
  assert.equal(js.headers.get("content-type"), "text/javascript", "versioned mirror served as js");
  assert.ok((await js.text()).includes(`http://${host}/framerusercontent.com/modules/x.js`), "origin swapped in js");
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
