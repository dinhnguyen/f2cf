import path from "node:path";
import { fileURLToPath } from "node:url";
import * as reg from "./lib/registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const regPath = path.join(__dirname, "registry.json");

const seeds = [
  { name: "Example Site", framerUrl: "https://example.framer.website/", cloudflareProject: "example-site" },
];

const r = await reg.load(regPath);
for (const s of seeds) {
  const id = reg.deriveId(s.framerUrl, new Set());
  if (reg.getSite(r, id)) { console.log(`skip ${id} (exists)`); continue; }
  reg.upsertSite(r, {
    id, name: s.name, framerUrl: s.framerUrl, cloudflareProject: s.cloudflareProject,
    liveUrl: `https://${s.cloudflareProject}.pages.dev`,
    build: { keepCdn: false, keepTracking: false, keepBadge: false },
    syncedHash: "", lastSyncedAt: "", remoteHash: "", lastCheckedAt: "",
    lastPublishedAt: "", lastDeploymentId: "",
  });
  console.log(`seeded ${id}`);
}
await reg.save(regPath, r);
