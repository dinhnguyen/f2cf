import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deriveId, load, save, getSite, upsertSite, removeSite } from "../lib/registry.mjs";

test("deriveId slugs the subdomain and de-dupes", () => {
  const taken = new Set();
  const a = deriveId("https://example.framer.website/", taken); taken.add(a);
  const b = deriveId("https://example.framer.website/", taken);
  assert.equal(a, "example");
  assert.equal(b, "example-2");
});

test("load returns empty registry when file is absent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-reg-"));
  const reg = await load(path.join(dir, "registry.json"));
  assert.deepEqual(reg, { version: 1, sites: [] });
});

test("upsert/get/remove and atomic save round-trip", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-reg-"));
  const p = path.join(dir, "registry.json");
  let reg = await load(p);
  upsertSite(reg, { id: "example", name: "Example", framerUrl: "https://example.framer.website/" });
  upsertSite(reg, { id: "example", name: "Example 2" }); // replace
  assert.equal(reg.sites.length, 1);
  assert.equal(getSite(reg, "example").name, "Example 2");
  await save(p, reg);
  const reloaded = JSON.parse(await readFile(p, "utf8"));
  assert.equal(reloaded.sites[0].name, "Example 2");
  removeSite(reg, "example");
  assert.equal(reg.sites.length, 0);
});

test("load throws a clear error on corrupt registry", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fm-reg-"));
  const p = path.join(dir, "registry.json");
  await writeFile(p, "{ not valid json");
  await assert.rejects(() => load(p), /Corrupt registry/);
});
