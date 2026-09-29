import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSitemapRoutes, routeToFilePath, portableAssetPath, cdnAssetPath, portableModuleSpecs,
  portableLocalPath, cdnUrlFromLocalPath } from "../lib/routes.mjs";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://s.framer.app/</loc></url>
  <url><loc>https://s.framer.app/tin-tuc</loc></url>
  <url><loc>https://s.framer.app/tin-tuc/backend-engineer-(ai-platform)</loc></url>
  <url><loc>https://s.framer.app/kh%E1%BA%B3ng-%C4%91%E1%BB%8Bnh</loc></url>
  <url><loc>https://s.framer.app/tin-tuc</loc></url>
  <url><loc>https://other.example.com/leaked</loc></url>
</urlset>`;

test("parseSitemapRoutes keeps same-host routes only, dedupes, and puts / first", () => {
  const routes = parseSitemapRoutes(xml, "https://s.framer.app/");
  assert.deepEqual(routes, [
    "/",
    "/tin-tuc",
    "/tin-tuc/backend-engineer-(ai-platform)",
    "/kh%E1%BA%B3ng-%C4%91%E1%BB%8Bnh",
  ]);
});

test("parseSitemapRoutes returns just / for junk or empty input", () => {
  assert.deepEqual(parseSitemapRoutes("", "https://s.framer.app/"), ["/"]);
  assert.deepEqual(parseSitemapRoutes("<html>404</html>", "https://s.framer.app/"), ["/"]);
});

test("routeToFilePath maps routes to static host layout", () => {
  assert.equal(routeToFilePath("/"), "index.html");
  assert.equal(routeToFilePath("/tin-tuc"), "tin-tuc/index.html");
  assert.equal(routeToFilePath("/tin-tuc/senior-frontend-engineer"), "tin-tuc/senior-frontend-engineer/index.html");
  assert.equal(routeToFilePath("/styles/"), "styles/index.html");
  // 404 is the one route static hosts look up by filename
  assert.equal(routeToFilePath("/404"), "404.html");
});

test("routeToFilePath decodes percent-encoded slugs so hosts match the decoded request", () => {
  assert.equal(routeToFilePath("/kh%E1%BA%B3ng-%C4%91%E1%BB%8Bnh"), "khẳng-định/index.html");
});

test("routeToFilePath rejects paths that would escape the output dir", () => {
  for (const p of ["/../etc/passwd", "/a/../../b", "/%2e%2e/x"]) {
    assert.equal(routeToFilePath(p), null, p);
  }
});

test("portableAssetPath gives ES modules a .js extension so any static host serves them as script", () => {
  // nginx/S3 return octet-stream for .mjs and for versioned mirrors, which kills the import
  assert.equal(portableAssetPath("/sites/ID/script_main.AbC.mjs"), "/sites/ID/script_main.AbC.mjs.js");
  assert.equal(portableAssetPath("/m/phosphor-icons/Key.js@0.0.53"), "/m/phosphor-icons/Key.js@0.0.53.js");
  // already-.js modules and non-module assets are untouched
  assert.equal(portableAssetPath("/modules/a/b.js"), "/modules/a/b.js");
  assert.equal(portableAssetPath("/images/a.png"), "/images/a.png");
  assert.equal(portableAssetPath("/sites/ID/x-indexes-default-0.framercms"), "/sites/ID/x-indexes-default-0.framercms");
});

test("cdnAssetPath undoes the portable rename so mirrors still resolve on the CDN", () => {
  for (const p of ["/sites/ID/main.AbC.mjs", "/m/phosphor-icons/Key.js@0.0.53"]) {
    assert.equal(cdnAssetPath(portableAssetPath(p)), p, p);
  }
  // paths the rename never touched must survive unchanged
  for (const p of ["/modules/a/b.js", "/images/a.png", "/sites/ID/x.framercms"]) {
    assert.equal(cdnAssetPath(p), p, p);
  }
});

test("portableModuleSpecs renames relative .mjs imports, which carry no CDN host to match on", () => {
  // Framer's route table lazy-loads each page with a relative specifier
  const js = 'page:z(()=>import(`./AbC.DkP.mjs`)),path:`/tin-tuc`\n' +
             'import x from "../shared/y.mjs";\n' +
             "export * from '../../z.mjs';";
  const out = portableModuleSpecs(js);
  assert.ok(out.includes("import(`./AbC.DkP.mjs.js`)"), out);
  assert.ok(out.includes('"../shared/y.mjs.js"'), out);
  assert.ok(out.includes("'../../z.mjs.js'"), out);
});

test("portableModuleSpecs leaves absolute urls and non-module strings alone", () => {
  const js = 'a="https://framerusercontent.com/x.mjs";b="/host/y.mjs";c="./note.mjs.txt";d="./s.js";';
  assert.equal(portableModuleSpecs(js), js);
});

test("portableLocalPath serves Framer's asset host from a plain resources/ folder", () => {
  assert.equal(portableLocalPath("framerusercontent.com", "/images/a.png"), "/resources/images/a.png");
  assert.equal(portableLocalPath("framerusercontent.com", "/sites/ID/main.AbC.mjs"), "/resources/sites/ID/main.AbC.mjs.js");
  // the other mirror hosts are rare and keep their own folder, so nothing collides
  assert.equal(portableLocalPath("framer.com", "/m/phosphor-icons/Key.js@0.0.53"), "/framer.com/m/phosphor-icons/Key.js@0.0.53.js");
  assert.equal(portableLocalPath("app.framerstatic.com", "/chunk-A.mjs"), "/app.framerstatic.com/chunk-A.mjs.js");
});

test("cdnUrlFromLocalPath maps a mirrored file back to the url it was fetched from", () => {
  for (const [host, pathname] of [
    ["framerusercontent.com", "/sites/ID/main.AbC.mjs"],
    ["framerusercontent.com", "/images/a.png"],
    ["framer.com", "/m/phosphor-icons/Key.js@0.0.53"],
  ]) {
    assert.equal(cdnUrlFromLocalPath(portableLocalPath(host, pathname)), `https://${host}${pathname}`);
  }
});
