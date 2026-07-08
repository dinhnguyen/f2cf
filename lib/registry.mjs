import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";

export function deriveId(framerUrl, taken = new Set()) {
  const host = new URL(framerUrl.includes("://") ? framerUrl : `https://${framerUrl}`).host;
  const base = host.split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-") || "site";
  let id = base, n = 1;
  while (taken.has(id)) id = `${base}-${++n}`;
  return id;
}

export async function load(regPath) {
  if (!existsSync(regPath)) return { version: 1, sites: [] };
  let reg;
  try {
    reg = JSON.parse(await readFile(regPath, "utf8"));
  } catch (e) {
    throw new Error(`Corrupt registry at ${regPath}: ${e.message}`);
  }
  reg.version ??= 1;
  reg.sites ??= [];
  return reg;
}

export async function save(regPath, reg) {
  const tmp = regPath + ".tmp";
  await writeFile(tmp, JSON.stringify(reg, null, 2));
  await rename(tmp, regPath); // atomic within the same filesystem
}

export function getSite(reg, id) {
  return reg.sites.find((s) => s.id === id);
}

export function upsertSite(reg, record) {
  const i = reg.sites.findIndex((s) => s.id === record.id);
  if (i >= 0) reg.sites[i] = { ...reg.sites[i], ...record };
  else reg.sites.push(record);
  return reg;
}

export function removeSite(reg, id) {
  reg.sites = reg.sites.filter((s) => s.id !== id);
  return reg;
}
