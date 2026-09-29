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

test("preview resolves clean subpage urls to their directory index, like a static host", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-prev-"));
  await writeFile(path.join(dir, "index.html"), "<h1>home</h1>");
  await mkdir(path.join(dir, "tin-tuc/bài-viết"), { recursive: true });
  await writeFile(path.join(dir, "tin-tuc/index.html"), "<h1>list</h1>");
  await writeFile(path.join(dir, "tin-tuc/bài-viết/index.html"), "<h1>article</h1>");
  await writeFile(path.join(dir, "404.html"), "<h1>missing</h1>");
  const { url } = await startPreview("s4", dir);

  assert.match(await (await fetch(url + "tin-tuc")).text(), /list/, "extensionless route");
  assert.match(await (await fetch(url + "tin-tuc/")).text(), /list/, "trailing slash");
  assert.match(await (await fetch(url + "tin-tuc/b%C3%A0i-vi%E1%BA%BFt")).text(), /article/, "encoded slug");

  const missing = await fetch(url + "khong-co-trang-nay");
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /missing/, "serves 404.html as the not-found body");
  stopAll();
});

test("preview answers range requests, as media playback needs to seek within mp4 files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-prev-"));
  await writeFile(path.join(dir, "data.framercms"), "0123456789");
  const { url } = await startPreview("s5", dir);

  const part = await fetch(url + "data.framercms", { headers: { range: "bytes=2-5" } });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), "2345");
  assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(part.headers.get("content-length"), "4");

  const openEnded = await fetch(url + "data.framercms", { headers: { range: "bytes=7-" } });
  assert.equal(await openEnded.text(), "789");

  const whole = await fetch(url + "data.framercms");
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal(await whole.text(), "0123456789");
  stopAll();
});

test("preview serves .framercms untouched - the origin swap would corrupt a binary format", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-prev-"));
  const origin = "https://site.pages.dev";
  const body = Buffer.from(`\x00\x00\x00{"a":1}${origin}/framerusercontent.com/images/a.png\x00\xff`, "binary");
  await writeFile(path.join(dir, "x-indexes-default-0.framercms"), body);
  const { url } = await startPreview("s6", dir, { origin });

  const res = await fetch(url + "x-indexes-default-0.framercms");
  const served = Buffer.from(await res.arrayBuffer());
  assert.equal(served.length, body.length, "byte length must survive - offsets depend on it");
  assert.ok(served.equals(body), "bytes must be identical");
  stopAll();
});
