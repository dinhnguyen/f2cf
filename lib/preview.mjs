import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const servers = new Map(); // id -> { server, port, url }

const TYPES = {
  ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".ico": "image/x-icon", ".gif": "image/gif",
};
const TEXT_TYPES = new Set(["text/html; charset=utf-8", "text/javascript", "text/css", "application/json"]);

function contentType(fp) {
  const t = TYPES[path.extname(fp)];
  if (t) return t;
  const b = path.basename(fp);
  if (/\.m?js(@[^/]*)?$/.test(b)) return "text/javascript"; // versioned mirrors (Name.js@1.2.3)
  if (b.endsWith(".framercms")) return "application/json";
  return "application/octet-stream";
}

// opts.origin: the origin baked into a full-local dist; text responses get it swapped
// for the host actually serving the preview so assets resolve locally.
export function startPreview(id, dir, opts = {}) {
  const existing = servers.get(id);
  if (existing) return Promise.resolve({ port: existing.port, url: existing.url });

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (rel.endsWith("/")) rel += "index.html";
        const fp = path.join(dir, rel.replace(/^\/+/, ""));
        const relToDir = path.relative(dir, fp);
        const inside = relToDir === "" || (!relToDir.startsWith("..") && !path.isAbsolute(relToDir));
        if (!inside || !existsSync(fp) || !statSync(fp).isFile()) {
          res.writeHead(404); res.end("not found"); return;
        }
        const type = contentType(fp);
        if (opts.origin && TEXT_TYPES.has(type)) {
          const host = req.headers.host || `127.0.0.1:${server.address().port}`;
          const body = (await readFile(fp, "utf8")).replaceAll(opts.origin, `http://${host}`);
          res.writeHead(200, { "content-type": type });
          res.end(body);
          return;
        }
        res.writeHead(200, { "content-type": type });
        const stream = createReadStream(fp);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      } catch {
        res.writeHead(400); res.end("bad request");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const rec = { server, port, url: `http://127.0.0.1:${port}/` };
      servers.set(id, rec);
      resolve({ port: rec.port, url: rec.url });
    });
  });
}

export function stopPreview(id) {
  const rec = servers.get(id);
  if (rec) { rec.server.close(); servers.delete(id); }
}

export function stopAll() {
  for (const id of [...servers.keys()]) stopPreview(id);
}
