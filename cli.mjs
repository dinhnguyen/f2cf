#!/usr/bin/env node
import { cloneSite } from "./lib/framer.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = (n) => args.includes(n);

const framerUrl = opt("--from-url", "");
if (!framerUrl) {
  console.error("Usage: framer-cf --from-url <url> [--out dist] [--keep-cdn] [--keep-tracking] [--keep-badge]");
  process.exit(1);
}
const outDir = opt("--out", "dist");
const build = { keepCdn: flag("--keep-cdn"), keepTracking: flag("--keep-tracking"), keepBadge: flag("--keep-badge") };

cloneSite({ framerUrl, outDir, build, onLog: (l) => console.log(l) })
  .then((r) => console.log(`done: ${r.moduleCount} modules, ${r.assetCount} assets, ${r.failedAssets.length} failed`))
  .catch((e) => { console.error("Error:", e.message); process.exit(1); });
