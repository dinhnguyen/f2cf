import { createHash } from "node:crypto";

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

export async function fetchBuf(url, tries = 4) {
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
    if (res.ok) return Buffer.from(await res.arrayBuffer());
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

async function crawlModuleGraph(outDir, startUrls, onLog) {
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
      const dest = path.join(outDir, u.host, u.pathname.replace(/^\/+/, ""));
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
export function isRewritableText(p) {
  return /\.(m?js|css|json|framercms)$/i.test(p) || /\.m?js@[^/]*$/i.test(p);
}

export const EDITOR_STUB_PATH = "/f2cf-editor-stub.mjs";
const EDITOR_STUB_JS =
  "export function createEditorBar(){return function(){return null}}\nexport default function(){return null}\n";

// The editor bar is also dynamically imported from inside the runtime JS
// (`import(\`https://framer.com/edit/init.mjs\`)`), out of reach of the HTML-only
// stripExternalScripts. Point it at a local no-op module; `import("about:blank")`
// would reject and break hydration.
export function stubEditorBar(js) {
  return js.replaceAll("https://framer.com/edit/init.mjs", EDITOR_STUB_PATH);
}

const cdnKey = (u) => {
  const { host, pathname } = new URL(u.split("?")[0]);
  return host + pathname;
};

// String-for-string rewrite, so it is safe in any context: HTML attributes, single- or
// double-quoted JS strings, template literals, srcset lists, CSS url(). `skip` holds
// cdnKey()s of assets that failed to mirror and must keep loading from the CDN.
export function rewriteToOrigin(text, origin, skip = new Set()) {
  return text.replace(CDN_URL_RE, (u) => {
    if (skip.has(cdnKey(u))) return u;
    const { host, pathname, search } = new URL(u);
    return `${origin}/${host}${pathname}${search}`;
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

// Mirror every concrete CDN file referenced from the HTML or any downloaded text file,
// then rewrite them all to `origin`. Runs to a fixpoint: mirrored JS/CSS can reference
// further CDN files (icon shims, CMS indexes, fontshare fonts).
async function localizeToOrigin(outDir, html, origin, onLog) {
  const seen = new Set();
  const failed = new Set();
  let assetCount = 0;
  for (let round = 1; ; round++) {
    const texts = [html];
    for (const f of await walkFiles(outDir)) if (isRewritableText(f)) texts.push(await readFile(f, "utf8"));
    const urls = new Set();
    for (const t of texts) {
      for (const m of t.matchAll(CDN_URL_RE)) {
        const u = m[0].split("?")[0];
        if (!seen.has(u) && isMirrorableAsset(new URL(u).pathname)) urls.add(u);
      }
    }
    if (!urls.size) break;
    onLog?.(`mirroring ${urls.size} CDN file(s) (round ${round})...`);
    await pool([...urls], 8, async (u) => {
      seen.add(u);
      const { host, pathname } = new URL(u);
      const dest = path.join(outDir, host, decodeURIComponent(pathname).replace(/^\/+/, ""));
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
    const out = rewriteToOrigin(txt, origin, failed);
    if (out !== txt) await writeFile(f, out);
  }
  return { html: rewriteToOrigin(html, origin, failed), assetCount, failedAssets: [...failed] };
}

// Legacy (no-origin) mode: localize ONLY assets referenced in the HTML markup, where the
// browser resolves root-relative paths against the page origin. URLs inside the .mjs
// runtime stay untouched here: Framer feeds them to `new URL(...)` (as both the url and
// the base) and a root-relative rewrite crashes hydration. Without a known origin we
// cannot produce the absolute URLs that localizeToOrigin uses, so JS-referenced assets
// keep loading from the Framer CDN in this mode.
async function localizeFramerAssets(outDir, html, onLog) {
  const URL_RE = /https:\/\/framerusercontent\.com\/[^"'`)\s\\]*/g;
  const assetPath = (u) => new URL(u.split("?")[0]).pathname;

  const paths = new Set();
  for (const m of html.matchAll(URL_RE)) {
    const p = assetPath(m[0]);
    if (isLocalizableAsset(p)) paths.add(p);
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
  return { html: rewrite(html), assetCount: ok, failedAssets: failed };
}

export async function cloneSite({ framerUrl, outDir, origin = "", build = {}, onLog }) {
  const base = normalizeUrl(framerUrl);
  onLog?.(`cloning: ${base}`);
  await mkdir(outDir, { recursive: true });
  let html = (await fetchBuf(base)).toString("utf8");
  const sourceHash = hashSource(html); // hash the ORIGINAL html (absolute CDN urls) before rewrite

  const moduleUrls = [...html.matchAll(/https:\/\/(?:framerusercontent|app\.framerstatic)\.com\/[^"')\s]+\.mjs/g)].map((m) => m[0]);
  onLog?.(`bundle entry modules: ${moduleUrls.length}`);
  const modules = await crawlModuleGraph(outDir, moduleUrls, onLog);
  onLog?.(`downloaded ${modules.size} module(s)`);

  const fullLocal = !!origin && !build.keepCdn;
  let assetCount = 0, failedAssets = [];
  if (fullLocal) {
    const r = await localizeToOrigin(outDir, html, origin, onLog); // rewrites module urls too
    html = r.html; assetCount = r.assetCount; failedAssets = r.failedAssets;
  } else {
    for (const u of modules) {
      const rel = "./" + new URL(u).host + new URL(u).pathname;
      html = html.replaceAll(u, rel);
    }
    if (!build.keepCdn) {
      const r = await localizeFramerAssets(outDir, html, onLog);
      html = r.html; assetCount = r.assetCount; failedAssets = r.failedAssets;
    }
  }
  if (!build.keepTracking) {
    html = stripExternalScripts(html);
    if (fullLocal) {
      for (const f of await walkFiles(outDir)) {
        if (!isRewritableText(f)) continue;
        const txt = await readFile(f, "utf8");
        const out = stubEditorBar(txt);
        if (out !== txt) await writeFile(f, out);
      }
      await writeFile(path.join(outDir, EDITOR_STUB_PATH.slice(1)), EDITOR_STUB_JS);
    }
  }
  if (!build.keepBadge) html = hideBadge(html);
  await writeFile(path.join(outDir, "index.html"), html);
  if (fullLocal) {
    // Cloudflare Pages would serve versioned module mirrors (Name.js@1.2.3) as octet-stream
    await writeFile(path.join(outDir, "_headers"), "/framer.com/m/*\n  Content-Type: text/javascript\n");
  }
  onLog?.(`built ${outDir}`);
  return { moduleCount: modules.size, assetCount, failedAssets, sourceHash };
}

export async function computeSourceHash(framerUrl) {
  const html = (await fetchBuf(normalizeUrl(framerUrl))).toString("utf8");
  return hashSource(html);
}
