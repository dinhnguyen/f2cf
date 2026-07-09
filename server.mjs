import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ops from "./lib/ops.mjs";
import { whoami } from "./lib/cloudflare.mjs";
import { startPreview } from "./lib/preview.mjs";
import { load, getSite } from "./lib/registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

export function createServer(ctx) {
  const opState = new Map();   // id -> { running, kind, error }
  const clients = new Map();   // id -> Set(res)

  const emit = (id, line) => {
    for (const res of clients.get(id) || []) res.write(`data: ${JSON.stringify(line)}\n\n`);
  };
  async function runOp(id, kind, fn) {
    const cur = opState.get(id);
    if (cur?.running) throw new Error(`"${id}" is busy (${cur.kind})`);
    opState.set(id, { running: true, kind, error: "" });
    try {
      const result = await fn((line) => emit(id, line));
      opState.set(id, { running: false, kind: "", error: "" });
      emit(id, `[done] ${kind}`);
      return result;
    } catch (e) {
      opState.set(id, { running: false, kind: "", error: e.message });
      emit(id, `[error] ${e.message}`);
      throw e;
    }
  }
  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const parts = url.pathname.split("/").filter(Boolean);

      if (parts[0] === "api") {
        if (req.method === "GET" && parts[1] === "status") {
          try { return json(res, 200, { auth: await whoami() }); }
          catch (e) { return json(res, 200, { auth: null, error: e.message }); }
        }
        if (req.method === "GET" && parts[1] === "sites" && parts.length === 2) {
          const reg = await load(ctx.regPath);
          const sites = reg.sites.map((s) => ({
            ...s,
            hasUpdate: !!s.syncedHash && s.remoteHash !== s.syncedHash,
            op: opState.get(s.id) || { running: false, kind: "", error: "" },
          }));
          return json(res, 200, { version: reg.version, sites });
        }
        if (req.method === "POST" && parts[1] === "sites" && parts.length === 2) {
          let body;
          try { body = await readBody(req); }
          catch { return json(res, 400, { error: "invalid JSON body" }); }
          if (!body.framerUrl) return json(res, 400, { error: "framerUrl required" });
          runOp("new:" + body.framerUrl, "clone", (log) => ops.runClone(body, ctx, log)).catch(() => {});
          return json(res, 202, { started: true });
        }
        const id = parts[2] ? decodeURIComponent(parts[2]) : parts[2];
        if (req.method === "POST" && parts[3] === "sync") {
          runOp(id, "sync", (log) => ops.runSync(id, ctx, log)).catch(() => {});
          return json(res, 202, { started: true });
        }
        if (req.method === "POST" && parts[3] === "check") {
          try { return json(res, 200, await ops.runCheck(id, ctx)); }
          catch (e) { return json(res, 400, { error: e.message }); }
        }
        if (req.method === "POST" && parts[3] === "publish") {
          runOp(id, "publish", (log) => ops.runPublish(id, ctx, log)).catch(() => {});
          return json(res, 202, { started: true });
        }
        if (req.method === "POST" && parts[3] === "preview") {
          const reg = await load(ctx.regPath);
          const site = getSite(reg, id);
          if (!site) return json(res, 404, { error: "no such site" });
          const { url: purl } = await startPreview(id, ops.buildDir(ctx, id), { origin: ops.siteOrigin(site) });
          return json(res, 200, { url: purl });
        }
        if (req.method === "DELETE" && parts.length === 3) {
          await ops.removeSiteAndBuild(id, ctx);
          return json(res, 200, { removed: true });
        }
        if (req.method === "GET" && parts[3] === "logs") {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          res.write(": connected\n\n");
          if (!clients.has(id)) clients.set(id, new Set());
          clients.get(id).add(res);
          req.on("close", () => clients.get(id)?.delete(res));
          return;
        }
        return json(res, 404, { error: "unknown api route" });
      }

      // static
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      const fp = path.join(ctx.publicDir, rel.replace(/^\/+/, ""));
      const relToPub = path.relative(ctx.publicDir, fp);
      const inside = relToPub === "" || (!relToPub.startsWith("..") && !path.isAbsolute(relToPub));
      if (!inside || !existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
      const buf = await readFile(fp);
      res.writeHead(200, { "content-type": STATIC_TYPES[path.extname(fp)] || "application/octet-stream" });
      return res.end(buf);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = {
    regPath: path.join(__dirname, "registry.json"),
    sitesDir: path.join(__dirname, "sites"),
    publicDir: path.join(__dirname, "public"),
  };
  const port = Number(process.env.PORT) || 4599;
  createServer(ctx).listen(port, "127.0.0.1", () => console.log(`F2CF: http://127.0.0.1:${port}`));
}
