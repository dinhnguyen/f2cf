import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cloneSite } from "../lib/framer.mjs";

const SITE = "https://s.framer.app";
const CDN = "https://framerusercontent.com";

const page = (title, extra = "") => `<!doctype html><html><head><title>${title}</title>
<script type="module" src="${CDN}/sites/ID/main.AbC.mjs"></script>
<link rel="stylesheet" href="${CDN}/sites/ID/style.css"></head>
<body><img src="${CDN}/images/a.png?width=230">${extra}</body></html>`;

const ROUTES = {
  "/": page("Home"),
  "/tin-tuc": page("Tin tuc"),
  "/tin-tuc/bai-viet": page("Bai viet"),
  "/404": page("Not found"),
};

const SITEMAP = `<urlset>${Object.keys(ROUTES).map((r) => `<loc>${SITE}${r === "/" ? "/" : r}</loc>`).join("")}</urlset>`;

function stubFetch() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const body =
      u.href === `${SITE}/sitemap.xml` ? SITEMAP
      : u.origin === SITE ? ROUTES[u.pathname === "/" ? "/" : u.pathname.replace(/\/$/, "")]
      : u.pathname === "/sites/ID/main.AbC.mjs" ? `export const bg = "${CDN}/images/b.png";\nconst p = () => import(\`./page.XyZ.mjs\`);`
      : u.pathname === "/sites/ID/page.XyZ.mjs" ? "export default 1;"
      : u.pathname === "/sites/ID/style.css" ? `body{background:url(${CDN}/images/c.png)}`
      : u.pathname.startsWith("/images/") ? "PNGDATA"
      : undefined;
    if (body === undefined) return { ok: false, status: 404 };
    const arrayBuffer = async () => new TextEncoder().encode(body).buffer;
    // Framer serves its 404 document with a real 404 status, like any static host
    if (u.origin === SITE && u.pathname === "/404") return { ok: false, status: 404, arrayBuffer };
    return { ok: true, status: 200, arrayBuffer };
  };
  return () => { globalThis.fetch = orig; };
}

const build = { keepCdn: false, keepTracking: false, keepBadge: false };
const read = (dir, p) => readFile(path.join(dir, p), "utf8");

test("cloneSite writes one document per sitemap route", async () => {
  const restore = stubFetch();
  const out = await mkdtemp(path.join(tmpdir(), "f2cf-mp-"));
  try {
    const res = await cloneSite({ framerUrl: SITE + "/", outDir: out, origin: "https://x.pages.dev", build });
    assert.equal(res.pageCount, 4, "all sitemap routes cloned");
    assert.match(await read(out, "index.html"), /<title>Home<\/title>/);
    assert.match(await read(out, "tin-tuc/index.html"), /<title>Tin tuc<\/title>/);
    assert.match(await read(out, "tin-tuc/bai-viet/index.html"), /<title>Bai viet<\/title>/);
    assert.match(await read(out, "404.html"), /<title>Not found<\/title>/);
  } finally { restore(); }
});

test("cloneSite in origin mode rewrites every page to the deploy origin", async () => {
  const restore = stubFetch();
  const out = await mkdtemp(path.join(tmpdir(), "f2cf-mp-"));
  try {
    await cloneSite({ framerUrl: SITE + "/", outDir: out, origin: "https://x.pages.dev", build });
    const html = await read(out, "tin-tuc/index.html");
    assert.ok(html.includes("https://x.pages.dev/framerusercontent.com/images/a.png?width=230"), html.slice(0, 300));
    assert.ok(!html.includes(CDN), "no CDN refs left on a subpage");
    assert.ok(!html.includes("f2cf-url-shim"), "absolute origin urls are valid bases already");
    // Framer asks for CMS slices with ?range=, which only its own CDN understands
    assert.ok(html.includes("f2cf-range-shim"), "self-hosted builds need the range shim");
  } finally { restore(); }
});

test("portable build uses root-relative urls and serves modules under a .js extension", async () => {
  const restore = stubFetch();
  const out = await mkdtemp(path.join(tmpdir(), "f2cf-mp-"));
  try {
    await cloneSite({ framerUrl: SITE + "/", outDir: out, build: { ...build, portable: true } });
    const html = await read(out, "tin-tuc/index.html");
    assert.ok(html.includes("f2cf-url-shim"), "root-relative paths need the URL shim to stay valid as a base");
    assert.ok(html.includes('src="/resources/sites/ID/main.AbC.mjs.js"'), html.slice(0, 400));
    assert.ok(html.includes('src="/resources/images/a.png?width=230"'), "image root-relative");
    assert.ok(!html.includes("https://framerusercontent.com"), "no CDN refs left");
    assert.ok(existsSync(path.join(out, "resources/sites/ID/main.AbC.mjs.js")), "module mirrored under resources/");
    // urls inside mirrored text files are rewritten the same way
    const css = await read(out, "resources/sites/ID/style.css");
    assert.ok(css.includes("url(/resources/images/c.png)"), css);
    const js = await read(out, "resources/sites/ID/main.AbC.mjs.js");
    assert.ok(js.includes('"/resources/images/b.png"'), js);
    // the route table lazy-loads pages by relative specifier - it must follow the rename
    assert.ok(js.includes("import(`./page.XyZ.mjs.js`)"), js);
    assert.ok(existsSync(path.join(out, "resources/sites/ID/page.XyZ.mjs.js")), "lazy chunk mirrored");
  } finally { restore(); }
});
