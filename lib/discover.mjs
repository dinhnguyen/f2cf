import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { fetchBuf, rewriteToOrigin, stubEditorBar, isRewritableText } from "./framer.mjs";
import { startPreview, stopPreview } from "./preview.mjs";

const MIRROR_HOSTS = new Set(["framerusercontent.com", "app.framerstatic.com", "framer.com"]);

// Framer's runtime constructs some URLs at runtime (icon sets picked by name/search,
// CMS `.framercms` indexes resolved relative to module URLs, fontshare fonts), which no
// static scan can enumerate. After a full-local build those constructed URLs point at
// this origin, so: serve the dist, load it headless, mirror whatever 404s, repeat until
// clean. Requests that still leave for a Framer origin are reported, not mirrored.
export async function discoverRuntimeAssets({ id, dir, origin, build = {}, onLog }) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    onLog?.("! discovery skipped: playwright not installed (npm i playwright) - runtime-loaded icons/CMS files may 404");
    return { skipped: true, downloaded: 0, remainingRemote: [] };
  }
  const previewId = `${id}:discover`;
  const { url } = await startPreview(previewId, dir, { origin });
  const browser = await chromium.launch({ headless: true });
  let downloaded = 0;
  let remainingRemote = [];
  try {
    for (let round = 1; round <= 5; round++) {
      const missing = new Set();
      const remote = new Set();
      const context = await browser.newContext(); // fresh context: no cached 404s between rounds
      const page = await context.newPage();
      page.on("response", (r) => {
        if (r.url().startsWith(url) && r.status() === 404) {
          missing.add(decodeURIComponent(new URL(r.url()).pathname));
        }
      });
      page.on("request", (r) => {
        try {
          if (MIRROR_HOSTS.has(new URL(r.url()).host)) remote.add(r.url());
        } catch {}
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
      try {
        const height = await page.evaluate("document.body.scrollHeight");
        for (let y = 0; y < Math.min(height, 20000); y += 800) {
          await page.evaluate(`window.scrollTo(0, ${y})`);
          await page.waitForTimeout(150);
        }
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      } catch {}
      await context.close();

      remainingRemote = [...remote];
      const todo = [...missing].filter((p) => !p.includes("..") && MIRROR_HOSTS.has(p.split("/")[1]));
      if (!todo.length) break;
      onLog?.(`discovery round ${round}: mirroring ${todo.length} runtime file(s)`);
      for (const p of todo) {
        const cdnUrl = "https://" + p.replace(/^\/+/, "");
        const dest = path.join(dir, p.replace(/^\/+/, ""));
        try {
          let buf = await fetchBuf(cdnUrl);
          if (isRewritableText(p)) {
            let txt = rewriteToOrigin(buf.toString("utf8"), origin);
            if (!build.keepTracking) txt = stubEditorBar(txt);
            buf = Buffer.from(txt);
          }
          await mkdir(path.dirname(dest), { recursive: true });
          await writeFile(dest, buf);
          downloaded++;
        } catch (e) {
          onLog?.(`  ! ${cdnUrl} (${e.message})`);
        }
      }
    }
    if (remainingRemote.length) {
      onLog?.(`! ${remainingRemote.length} request(s) still hit Framer origins: ${remainingRemote.slice(0, 5).join(", ")}`);
    } else {
      onLog?.(`discovery done: ${downloaded} runtime file(s) mirrored, no Framer requests remain`);
    }
  } finally {
    await browser.close();
    stopPreview(previewId);
  }
  return { skipped: false, downloaded, remainingRemote };
}
