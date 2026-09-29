import { createHash } from "node:crypto";
import { parseSitemapRoutes, routeToFilePath, portableAssetPath, portableModuleSpecs, portableLocalPath } from "./routes.mjs";

export function extractImports(js) {
  // static import/export ... from "x", side-effect import "x", dynamic import("x").
  // Quotes may be ' " or ` (Framer emits template-literal dynamic imports); skip any
  // backtick spec with ${...} interpolation since it can't be resolved statically.
  const specs = new Set();
  for (const re of [
    /(?:^|[;\s])(?:import|export)\b[^'"`]*?\bfrom\s*['"`]([^'"`]+)['"`]/g,
    /(?:^|[;\s])import\s*['"`]([^'"`]+)['"`]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ]) {
    for (const m of js.matchAll(re)) if (!m[1].includes("${")) specs.add(m[1]);
  }
  return [...specs];
}

export function stripExternalScripts(html) {
  return html
    .replace(/<script\b[^>]*\bsrc="https:\/\/events\.framer\.com\/[^"]*"[^>]*>\s*<\/script>/gi, "")
    .replaceAll("https://framer.com/edit/init.mjs", "about:blank");
}

export function hideBadge(html) {
  const style = `<style>#__framer-badge-container,.__framer-badge{display:none!important}</style>`;
  return html.includes("</head>") ? html.replace("</head>", style + "</head>") : style + html;
}

// Portable builds address assets by root-relative path, but Framer feeds some of those
// paths to `new URL(url, base)`, which rejects a relative base ("Invalid base URL") and
// takes the whole page down on client-side navigation. This resolves a relative base
// against the document instead, and must run before the module bundle.
export const URL_SHIM_MARKER = "f2cf-url-shim";
const URL_SHIM =
  `<script id="${URL_SHIM_MARKER}">(function(){var N=URL;function U(u,b){` +
  `if(typeof b==="string")b=new N(b,location.href);` +
  `else if(b===undefined&&typeof u==="string"&&u.charAt(0)==="/")b=location.href;` +
  `return b===undefined?new N(u):new N(u,b)}U.prototype=N.prototype;` +
  `["createObjectURL","revokeObjectURL","canParse","parse"].forEach(function(k){` +
  `if(N[k])U[k]=function(){return N[k].apply(N,arguments)}});window.URL=U})();</script>`;

// Shims go after the charset meta, so it keeps its place in the document's first bytes,
// and always ahead of the module bundle that depends on them.
function injectHead(html, marker, script) {
  if (html.includes(marker)) return html;
  const charset = html.match(/<meta[^>]+charset=[^>]*>/i);
  if (charset) return html.replace(charset[0], charset[0] + script);
  return html.includes("<head>") ? html.replace("<head>", "<head>" + script) : script + html;
}

export function injectUrlShim(html) {
  return injectHead(html, URL_SHIM_MARKER, URL_SHIM);
}

// Framer reads CMS index slices as `file.framercms?range=from-to[,from-to...]`, a
// convention only its own CDN implements, and it demands a 200 whose body is exactly the
// concatenated slices - so a plain 206 will not do either. Every other host returns the
// whole file and the runtime aborts with "Unexpected response length". Fetching the file
// and slicing it here needs nothing from the host; the files are tens of KB and the
// browser caches the full response across slice requests.
export const RANGE_SHIM_MARKER = "f2cf-range-shim";
const RANGE_SHIM =
  `<script id="${RANGE_SHIM_MARKER}">(function(){var F=window.fetch,RE=/^\\d+-\\d+(,\\d+-\\d+)*$/;` +
  `window.fetch=function(i,o){try{` +
  `var h=typeof i==="string"?i:i&&(i.href||i.url);` +
  `if(h){var u=new URL(h,location.href),r=u.searchParams.get("range");` +
  `if(r&&RE.test(r)){u.searchParams.delete("range");` +
  `return F(u.href,o).then(function(s){return s.ok?s.arrayBuffer().then(function(b){` +
  `var p=r.split(",").map(function(x){var q=x.split("-");return[+q[0],+q[1]]}),n=0,k;` +
  `for(k=0;k<p.length;k++)n+=p[k][1]-p[k][0]+1;` +
  `var out=new Uint8Array(n),at=0;` +
  `for(k=0;k<p.length;k++){out.set(new Uint8Array(b.slice(p[k][0],p[k][1]+1)),at);at+=p[k][1]-p[k][0]+1}` +
  `return new Response(out,{status:200,headers:{"content-type":"application/octet-stream"}})}):s})}}}catch(e){}` +
  `return F.apply(this,arguments)}})();</script>`;

export function injectRangeShim(html) {
  return injectHead(html, RANGE_SHIM_MARKER, RANGE_SHIM);
}

export function hashSource(html) {
  // Hash the SET of framerusercontent.com asset/bundle URLs (content-hashed by Framer),
  // query-stripped and sorted. Any content or asset change flips at least one hash,
  // while avoiding false positives from per-request volatility.
  const urls = [...html.matchAll(/https:\/\/framerusercontent\.com\/[^"'`)\s\\]*/g)]
    .map((m) => m[0].split("?")[0]);
  const uniq = [...new Set(urls)].sort();
  return "sha256:" + createHash("sha256").update(uniq.join("\n")).digest("hex");
}

import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (f2cf clone)";
const ASSET_ORIGINS = new Set(["framerusercontent.com", "app.framerstatic.com"]);
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalizeUrl(u) {
  return u.includes("://") ? u : `https://${u}`;
}

export async function fetchBuf(url, tries = 4, accept = () => false) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { "user-agent": UA } });
    } catch (e) {
      lastErr = e; // network error - retry
      if (i < tries - 1) await sleep(400 * 3 ** i);
      continue;
    }
    if (res.ok || accept(res.status)) return Buffer.from(await res.arrayBuffer());
    if (!TRANSIENT.has(res.status)) throw new Error(`HTTP ${res.status}`); // permanent - don't retry
    lastErr = new Error(`HTTP ${res.status}`);
    if (i < tries - 1) await sleep(400 * 3 ** i);
  }
  throw lastErr;
}

async function pool(items, size, fn) {
  const q = [...items];
  const work = Array.from({ length: Math.min(size, q.length) }, async () => {
    while (q.length) await fn(q.shift());
  });
  await Promise.all(work);
}

async function crawlModuleGraph(outDir, startUrls, onLog, localPath = defaultLocalPath) {
  const seen = new Set();
  const queue = [...startUrls];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let js;
    try {
      const buf = await fetchBuf(url);
      const u = new URL(url);
      const dest = path.join(outDir, localPath(u.host, u.pathname).replace(/^\/+/, ""));
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      js = buf.toString("utf8");
    } catch (e) {
      onLog?.(`  ! module ${url} (${e.message})`);
      continue;
    }
    for (const spec of extractImports(js)) {
      let abs;
      try { abs = new URL(spec, url).href; } catch { continue; }
      const host = new URL(abs).host;
      if (ASSET_ORIGINS.has(host) && /\.m?js($|\?)/.test(abs) && !seen.has(abs)) queue.push(abs);
    }
  }
  return seen;
}

// Framer builds its CMS data URLs at runtime from a relative name plus a module URL as
// base, sometimes rerouting /modules/ to /cms/ - none of which the absolute-URL scan can
// see, so these files have to be resolved from the source text.
const CMS_URL_RE = /new URL\(\s*['"`](\.[^'"`]*\.framercms)['"`]\s*,\s*['"`](https:\/\/framerusercontent\.com\/[^'"`]+)['"`]\s*\)(?:\.href\.replace\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\))?/g;

export function extractCmsUrls(js) {
  const urls = new Set();
  for (const [, spec, base, from, to] of js.matchAll(CMS_URL_RE)) {
    let href;
    try { href = new URL(spec, base).href; } catch { continue; }
    urls.add(from ? href.replace(from, to) : href);
  }
  return [...urls];
}

// Whether a CDN pathname is a concrete static-asset file safe to serve locally.
export function isLocalizableAsset(pathname) {
  return /\.(woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico|css|mp4|webm|mov|mp3|wav|ogg)$/i.test(pathname);
}

// --- full-local (origin) mode -------------------------------------------------------
// With a known deploy origin we can go further than the HTML-only rewrite: every CDN
// URL (in HTML *and* JS) is rewritten to an absolute URL on that origin. Absolute URLs
// keep Framer's `new URL(url, base)` calls valid - rewriting to relative paths is what
// crashes hydration, not self-hosting itself (verified against live exports, issue #1).

const CDN_URL_RE = /https:\/\/(?:framerusercontent\.com|app\.framerstatic\.com|framer\.com\/m)\/[^"'`)\s\\]*/g;

// Superset of isLocalizableAsset: in origin mode, runtime modules and CMS/search data
// files are mirrorable too since their URLs stay absolute after the rewrite.
export function isMirrorableAsset(pathname) {
  return isLocalizableAsset(pathname) || /\.(m?js|json|framercms)$/i.test(pathname);
}

// Text files that may embed CDN URLs; includes versioned module mirrors (Name.js@1.2.3).
// .framercms is deliberately absent: it is a binary format whose records are length-
// prefixed and whose slices the runtime fetches by byte offset with Range headers, so
// substituting URLs inside it shifts every offset and breaks the page.
export function isRewritableText(p) {
  return /\.(m?js|css|json)$/i.test(p) || /\.m?js@[^/]*$/i.test(p);
}

export const EDITOR_STUB_PATH = "/f2cf-editor-stub.mjs";
const EDITOR_STUB_JS =
  "export function createEditorBar(){return function(){return null}}\nexport default function(){return null}\n";

// The editor bar is also dynamically imported from inside the runtime JS
// (`import(\`https://framer.com/edit/init.mjs\`)`), out of reach of the HTML-only
// stripExternalScripts. Point it at a local no-op module; `import("about:blank")`
// would reject and break hydration.
export function stubEditorBar(js, target = EDITOR_STUB_PATH) {
  return js.replaceAll("https://framer.com/edit/init.mjs", target);
}

const cdnKey = (u) => {
  const { host, pathname } = new URL(u.split("?")[0]);
  return host + pathname;
};

// String-for-string rewrite, so it is safe in any context: HTML attributes, single- or
// double-quoted JS strings, template literals, srcset lists, CSS url(). `skip` holds
// cdnKey()s of assets that failed to mirror and must keep loading from the CDN.
const defaultLocalPath = (host, pathname) => "/" + host + pathname;

export function rewriteToOrigin(text, origin, skip = new Set(), localPath = defaultLocalPath) {
  return text.replace(CDN_URL_RE, (u) => {
    if (skip.has(cdnKey(u))) return u;
    const { host, pathname, search } = new URL(u);
    return `${origin}${localPath(host, pathname)}${search}`;
  });
}

async function walkFiles(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

// Mirror every concrete CDN file referenced from any page HTML or downloaded text file,
// then rewrite them all to `origin` (empty origin = root-relative, for portable builds).
// Runs to a fixpoint: mirrored JS/CSS can reference further CDN files (icon shims, CMS
// indexes, fontshare fonts).
async function localizeToOrigin(outDir, pages, origin, onLog, { localPath = defaultLocalPath, portable = false } = {}) {
  const seen = new Set();
  const failed = new Set();
  let assetCount = 0;
  for (let round = 1; ; round++) {
    const texts = pages.map((pg) => pg.html);
    for (const f of await walkFiles(outDir)) if (isRewritableText(f)) texts.push(await readFile(f, "utf8"));
    const urls = new Set();
    for (const t of texts) {
      for (const m of t.matchAll(CDN_URL_RE)) {
        const u = m[0].split("?")[0];
        if (!seen.has(u) && isMirrorableAsset(new URL(u).pathname)) urls.add(u);
      }
      for (const u of extractCmsUrls(t)) if (!seen.has(u)) urls.add(u);
    }
    if (!urls.size) break;
    onLog?.(`mirroring ${urls.size} CDN file(s) (round ${round})...`);
    await pool([...urls], 8, async (u) => {
      seen.add(u);
      const { host, pathname } = new URL(u);
      const dest = path.join(outDir, localPath(host, decodeURIComponent(pathname)).replace(/^\/+/, ""));
      try {
        if (!existsSync(dest)) {
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, await fetchBuf(u));
        }
        assetCount++;
      } catch (e) {
        failed.add(cdnKey(u));
        onLog?.(`  ! ${u} (${e.message})`);
      }
    });
  }
  for (const f of await walkFiles(outDir)) {
    if (!isRewritableText(f)) continue;
    const txt = await readFile(f, "utf8");
    let out = rewriteToOrigin(txt, origin, failed, localPath);
    if (portable && /\.m?js(@[^/]*)?$/i.test(f)) out = portableModuleSpecs(out);
    if (out !== txt) await writeFile(f, out);
  }
  return {
    pages: pages.map((pg) => ({ ...pg, html: rewriteToOrigin(pg.html, origin, failed, localPath) })),
    assetCount,
    failedAssets: [...failed],
  };
}

// Legacy (no-origin) mode: localize ONLY assets referenced in the HTML markup, where the
// browser resolves root-relative paths against the page origin. URLs inside the .mjs
// runtime stay untouched here: Framer feeds them to `new URL(...)` (as both the url and
// the base) and a root-relative rewrite crashes hydration. Without a known origin we
// cannot produce the absolute URLs that localizeToOrigin uses, so JS-referenced assets
// keep loading from the Framer CDN in this mode.
async function localizeFramerAssets(outDir, pages, onLog) {
  const URL_RE = /https:\/\/framerusercontent\.com\/[^"'`)\s\\]*/g;
  const assetPath = (u) => new URL(u.split("?")[0]).pathname;

  const paths = new Set();
  for (const pg of pages) {
    for (const m of pg.html.matchAll(URL_RE)) {
      const p = assetPath(m[0]);
      if (isLocalizableAsset(p)) paths.add(p);
    }
  }

  onLog?.(`localizing ${paths.size} HTML asset(s)...`);
  let ok = 0;
  const failed = [];
  await pool([...paths], 8, async (p) => {
    const dest = path.join(outDir, "framerusercontent.com", p.replace(/^\/+/, ""));
    try {
      if (!existsSync(dest)) {
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, await fetchBuf("https://framerusercontent.com" + p));
      }
      ok++;
    } catch (e) {
      failed.push(p);
      onLog?.(`  ! ${p} (${e.message})`);
    }
  });
  onLog?.(`localized ${ok}/${paths.size}`);

  const failedSet = new Set(failed);
  const rewrite = (s) =>
    s.replace(URL_RE, (u) => {
      const p = assetPath(u);
      return isLocalizableAsset(p) && !failedSet.has(p) ? "/framerusercontent.com" + p : u;
    });
  return { pages: pages.map((pg) => ({ ...pg, html: rewrite(pg.html) })), assetCount: ok, failedAssets: failed };
}

// Framer serves a separate HTML document per route; sitemap.xml is its published index.
async function fetchRoutes(base, onLog) {
  try {
    const xml = (await fetchBuf(new URL("/sitemap.xml", base).href, 2)).toString("utf8");
    return parseSitemapRoutes(xml, base);
  } catch (e) {
    onLog?.(`! sitemap.xml unavailable (${e.message}) - cloning the entry page only`);
    return ["/"];
  }
}

export async function cloneSite({ framerUrl, outDir, origin = "", build = {}, onLog }) {
  const base = normalizeUrl(framerUrl);
  onLog?.(`cloning: ${base}`);
  await mkdir(outDir, { recursive: true });

  const portable = !!build.portable;
  const localPath = portable ? portableLocalPath : defaultLocalPath;
  const targetOrigin = portable ? "" : origin;
  const fullLocal = (!!targetOrigin || portable) && !build.keepCdn;

  const routes = await fetchRoutes(base, onLog);
  onLog?.(`routes: ${routes.length}`);
  let pages = [];
  for (const route of routes) {
    const file = routeToFilePath(route);
    if (!file) { onLog?.(`  ! skipped unsafe route ${route}`); continue; }
    try {
      // the 404 document is published with a 404 status - that is the page, not an error
      const accept = route === "/404" ? (st) => st === 404 : undefined;
      const buf = await fetchBuf(new URL(route, base).href, 4, accept);
      pages.push({ route, file, html: buf.toString("utf8") });
    } catch (e) {
      onLog?.(`  ! ${route} (${e.message})`);
    }
  }
  if (!pages.length) throw new Error(`No page could be fetched from ${base}`);
  // hash the ORIGINAL entry html (absolute CDN urls) before rewrite, to stay comparable
  // with computeSourceHash, which only sees the entry page
  const sourceHash = hashSource(pages[0].html);

  const moduleUrls = [...new Set(pages.flatMap((pg) =>
    [...pg.html.matchAll(/https:\/\/(?:framerusercontent|app\.framerstatic)\.com\/[^"')\s]+\.mjs/g)].map((m) => m[0])))];
  onLog?.(`bundle entry modules: ${moduleUrls.length}`);
  const modules = await crawlModuleGraph(outDir, moduleUrls, onLog, localPath);
  onLog?.(`downloaded ${modules.size} module(s)`);

  let assetCount = 0, failedAssets = [];
  if (fullLocal) {
    const r = await localizeToOrigin(outDir, pages, targetOrigin, onLog, { localPath, portable }); // rewrites module urls too
    pages = r.pages; assetCount = r.assetCount; failedAssets = r.failedAssets;
  } else {
    for (const u of modules) {
      const rel = "./" + new URL(u).host + new URL(u).pathname;
      for (const pg of pages) pg.html = pg.html.replaceAll(u, rel);
    }
    if (!build.keepCdn) {
      const r = await localizeFramerAssets(outDir, pages, onLog);
      pages = r.pages; assetCount = r.assetCount; failedAssets = r.failedAssets;
    }
  }
  const stubPath = portable ? portableAssetPath(EDITOR_STUB_PATH) : EDITOR_STUB_PATH;
  if (!build.keepTracking) {
    for (const pg of pages) pg.html = stripExternalScripts(pg.html);
    if (fullLocal) {
      for (const f of await walkFiles(outDir)) {
        if (!isRewritableText(f)) continue;
        const txt = await readFile(f, "utf8");
        const out = stubEditorBar(txt, stubPath);
        if (out !== txt) await writeFile(f, out);
      }
      await writeFile(path.join(outDir, stubPath.slice(1)), EDITOR_STUB_JS);
    }
  }
  for (const pg of pages) {
    if (fullLocal) pg.html = injectRangeShim(pg.html);
    if (portable) pg.html = injectUrlShim(pg.html);
    if (!build.keepBadge) pg.html = hideBadge(pg.html);
    const dest = path.join(outDir, pg.file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, pg.html);
  }
  if (fullLocal && !portable) {
    // Cloudflare Pages would serve versioned module mirrors (Name.js@1.2.3) as octet-stream
    await writeFile(path.join(outDir, "_headers"), "/framer.com/m/*\n  Content-Type: text/javascript\n");
  }
  onLog?.(`built ${outDir} (${pages.length} page(s))`);
  return { moduleCount: modules.size, pageCount: pages.length, assetCount, failedAssets, sourceHash };
}

export async function computeSourceHash(framerUrl) {
  const html = (await fetchBuf(normalizeUrl(framerUrl))).toString("utf8");
  return hashSource(html);
}
