// Route discovery and static-host path mapping. Framer publishes one HTML document per
// route and lists them all in sitemap.xml; a clone that only fetches "/" leaves every
// subpage to whatever fallback the host applies (Cloudflare Pages serves the homepage
// for all of them, so titles, meta and CMS pages are silently wrong).

export function parseSitemapRoutes(xml, baseUrl) {
  const host = new URL(baseUrl).host;
  const routes = new Set(["/"]);
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    let u;
    try { u = new URL(m[1]); } catch { continue; }
    if (u.host !== host) continue;
    routes.add(u.pathname === "" ? "/" : u.pathname);
  }
  return [...routes];
}

// Static hosts serve a directory request from its index.html, and look up 404.html by
// name, so /tin-tuc becomes tin-tuc/index.html and /404 becomes 404.html.
export function routeToFilePath(route) {
  let decoded;
  try { decoded = decodeURIComponent(route); } catch { return null; }
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) return null;
  if (!segments.length) return "index.html";
  if (segments.length === 1 && segments[0] === "404") return "404.html";
  return segments.join("/") + "/index.html";
}

// Portable builds cannot ship a _headers file, and the common static hosts (nginx, S3,
// GitHub Pages) type .mjs and versioned mirrors like Key.js@0.0.53 as octet-stream,
// which browsers refuse to execute as modules. Appending .js is collision-free.
export function portableAssetPath(pathname) {
  return /\.mjs$/i.test(pathname) || /\.m?js@[^/]*$/i.test(pathname) ? pathname + ".js" : pathname;
}

// Inverse of portableAssetPath: maps a mirrored path back to the CDN path it came from,
// so a portable build can still fetch files it only discovers at runtime.
export function cdnAssetPath(pathname) {
  const stripped = pathname.replace(/\.js$/i, "");
  return portableAssetPath(stripped) === pathname ? stripped : pathname;
}

// Framer's route table lazy-loads each page through a relative specifier
// (`import(`./Hash.mjs`)`), which has no CDN host for the URL rewrite to match, so the
// portable rename has to reach these separately.
export function portableModuleSpecs(js) {
  return js.replace(/(['"`])(\.{1,2}\/[^'"`\s]+?\.mjs)\1/g, (_, q, spec) => `${q}${spec}.js${q}`);
}

// Portable builds serve Framer's asset host from a plain folder name; the other mirror
// hosts are rare (icon modules, shared runtime chunks) and keep their own folder so
// nothing collides.
export const PORTABLE_ASSET_DIR = "resources";
const PORTABLE_DIRS = { "framerusercontent.com": PORTABLE_ASSET_DIR };
const PORTABLE_HOSTS = { [PORTABLE_ASSET_DIR]: "framerusercontent.com" };

export function portableLocalPath(host, pathname) {
  return "/" + (PORTABLE_DIRS[host] || host) + portableAssetPath(pathname);
}

// Inverse of portableLocalPath, so files first seen at runtime can still be fetched.
export function cdnUrlFromLocalPath(localPath) {
  const [dir, ...rest] = localPath.replace(/^\/+/, "").split("/");
  return "https://" + (PORTABLE_HOSTS[dir] || dir) + cdnAssetPath("/" + rest.join("/"));
}
