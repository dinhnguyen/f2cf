English | [Tiếng Việt](README.vi.md)

# F2CF (Framer to Cloudflare)

A tool that runs on your own machine to manage multiple Framer websites: clone a site, detect when Framer has a newer version, preview it, and publish it to Cloudflare Pages - all from a dashboard in your browser.

This guide assumes no prior knowledge. Follow the steps in order and it will work.

---

## 1. What it is for

You design a website in Framer. Framer gives you an address like `https://yoursite.framer.website/`. F2CF lets you:

- Download the entire site to your machine.
- Put it on Cloudflare Pages (free, fast hosting) at `https://yoursite.pages.dev`.
- When you edit the site in Framer, click one button to update the Cloudflare copy.
- Automatically strip tracking code and hide the "Made in Framer" badge.

Framer stays the source of truth. You edit in Framer, then sync and republish. This tool never edits content.

---

## 2. Setup (one time)

### 2.1. Install Node.js

This is the software that runs the tool. Version 18 or newer is required.

- Go to https://nodejs.org, download the "LTS" build, install it like any normal application.
- Verify: open Terminal (on Mac: press `Cmd + Space`, type "Terminal", Enter) and run:

```bash
node --version
```

A number like `v20.x.x` or higher means you are good. "command not found" means Node is not installed yet.

Then run `npm install` once inside the tool folder to install its libraries (including `playwright`, used by the automatic discovery step).

### 2.2. Have a Cloudflare account

Free. Sign up at https://dash.cloudflare.com/sign-up if you do not have one.

### 2.3. Log in to Cloudflare on this machine

Open Terminal, go into the tool folder, and log in.

Note: `path/to/f2cf` is a placeholder - replace it with the real path to the `f2cf` folder on your machine (wherever you unzipped / saved it). Mac tip: type `cd ` (with a trailing space), then drag the `f2cf` folder from Finder into the Terminal window - it fills in the correct path; press Enter.

```bash
cd path/to/f2cf
npx wrangler login
```

- The first `npx wrangler` run downloads the Cloudflare tool automatically (give it a moment).
- A browser window opens; click "Allow".
- "Successfully logged in" means you are done.

Verify the login:

```bash
npx wrangler whoami
```

It prints your email and account name.

---

## 3. Start the dashboard

Each time you want to use the tool, open Terminal and run:

```bash
cd path/to/f2cf
npm start
```

When you see:

```
F2CF: http://127.0.0.1:4599
```

open your browser at **http://127.0.0.1:4599**

Leave that Terminal window running. To stop the tool, go back to Terminal and press `Ctrl + C`.

Note: right after opening, the dashboard may be empty for 1-3 seconds (it is checking the Cloudflare login) before the list appears. That is normal.

---

## 4. Using the dashboard

At the top: the Cloudflare login status (green check + email when logged in), the add-site form, and the table of sites.

### 4.1. Add a new site

1. Paste the Framer address into the first field (e.g. `https://yoursite.framer.website/`).
2. The second field, "cloudflare project", can be left empty - a name is derived from the address. Type one if you want a different name.
3. Click **+ Add site**.

The tool creates the Cloudflare project (if needed), downloads the site, and shows it in the table. The log area below reports progress.

### 4.2. Buttons on each site

| Button | What it does |
|--------|--------------|
| **Check** | Asks Framer whether the site changed. If so, the label switches to "update available". |
| **Sync** | Downloads the latest version from Framer to your machine (nothing goes online yet). |
| **Preview** | Opens a new tab with the downloaded copy (served from your machine). Sync first, or there is nothing to show. |
| **Publish** | Deploys the downloaded copy to Cloudflare Pages. Only after this does the `.pages.dev` address update. |
| **✕** | Removes the site from the list and deletes the local copy. Does NOT delete the Cloudflare project. |

### 4.3. Typical workflow

1. Edit content in Framer, hit Publish on Framer's side.
2. In the dashboard click **Check** - you see "update available".
3. Click **Sync** to download the new version.
4. Click **Preview** to double-check.
5. Click **Publish** to put it online.

Status labels:

- **not synced**: just added, nothing downloaded yet.
- **up to date**: the local copy matches Framer.
- **update available**: Framer changed; you should Sync.

The **Publish** button is disabled if you are not logged in to Cloudflare. Run `npx wrangler login` again and it becomes clickable.

---

## 5. Command-line usage (optional)

To quickly download one site into a folder without the dashboard:

```bash
node cli.mjs --from-url https://yoursite.framer.website/ --out target-folder
```

Options:

| Flag | Meaning |
|------|---------|
| `--out <folder>` | Where to write the result (default `dist`). |
| `--origin <url>` | The address the site will be deployed at (e.g. `https://yoursite.pages.dev`). With this flag, **everything** is downloaded - fonts, images, modules, CMS data - and the site no longer calls Framer's servers. |
| `--keep-cdn` | Do not download assets; keep loading them from Framer's CDN. |
| `--keep-tracking` | Keep Framer's tracking code and editor bar. |
| `--portable` | Build a standalone copy that runs on any static host at a domain root (nginx, S3, Netlify, GitHub Pages). All assets are downloaded into `resources/` and referenced by root-relative paths, and ES modules are mirrored under a `.js` extension so hosts that do not know `.mjs` still serve them as script. Cannot be combined with `--origin`. |
| `--keep-badge` | Keep the "Made in Framer" badge. |

The default (no flags) is a clean build: tracking removed, badge hidden, HTML-referenced images downloaded. The dashboard always uses `--origin` mode (it derives the project's `*.pages.dev` address), so sites cloned through the dashboard are fully detached from Framer.

---

## 6. Where data is stored

Inside the `f2cf` folder:

- `registry.json` - the list of sites you manage (address, project name, sync/publish timestamps).
- `sites/<name>/dist/` - the downloaded copy of each site.

Both stay on your machine only and are not committed to git. Deleting `registry.json` loses the list (the sites on Cloudflare remain).

To seed a sample site for a quick try (edit the list in `seed.mjs`):

```bash
node seed.mjs
```

---

## 7. Important things to know

- **Sites are fully detached from Framer's infrastructure.** Fonts, images, JS modules, icons and CMS data are all downloaded and served from Cloudflare; Framer's editor bar (which pings `framer.com` for every visitor) is disabled. The only remaining external servers are Google Fonts (kept on purpose - Google's CDN is fast) and third-party embeds such as Google Maps or YouTube - those are live services and cannot be downloaded.
- **CMS images are the one exception.** Framer's `.framercms` collection files are a binary format: records carry byte-length prefixes and the runtime reads slices by offset, so rewriting URLs inside them corrupts the file. They are mirrored byte-for-byte, which leaves the article thumbnail URLs stored inside them pointing at `framerusercontent.com`. Pages loaded directly are unaffected - only content rendered after a client-side navigation into a CMS list pulls those images from Framer.
- **A small shim is injected into every self-hosted page.** Framer requests CMS slices as `file.framercms?range=from-to`, a convention only its own CDN implements, and it insists on a `200` whose body is exactly the requested bytes. The shim fetches the file and slices it in the browser, so no host support is required. Portable builds get a second shim that lets root-relative paths work as a `new URL(url, base)` base.
- **Images are served at original size.** Framer's CDN resizes images via query parameters (`?width=...`); the self-hosted copy returns the original file for every size, so pages can be slightly heavier on small screens.
- **`playwright` is required** (already in `package.json`; `npm install` is enough) for the discovery step that finds files the site only loads at runtime (icons, CMS data). Without it the tool still works, but some icons/dynamic sections may be missing.
- **Every route is cloned.** The route list comes from the site's `sitemap.xml`, and each route is written as its own document (`/tin-tuc` -> `tin-tuc/index.html`, `/404` -> `404.html`), so subpages keep their own title, meta tags and CMS content. If `sitemap.xml` is unavailable, only the entry page is cloned.
- **Update checks only look at the entry page.** A change confined to a subpage (a new article, an edited job post) does not flip the sync hash, so run Sync manually after editing CMS content in Framer.
- **One-way Framer -> machine.** Do not edit downloaded files; edit in Framer and Sync again.
- The tool binds to `127.0.0.1` only; nobody outside your machine can reach your dashboard.

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `node: command not found` | Node.js is not installed (section 2.1). |
| Dashboard does not open | Check the Terminal is still running `npm start`; the address is `http://127.0.0.1:4599`. |
| Publish button disabled | Not logged in to Cloudflare. Run `npx wrangler login`. |
| Preview blank / broken | Click **Sync** for that site first, then Preview again. |
| Port 4599 busy | Run `PORT=4600 npm start` and open `http://127.0.0.1:4600`. |
| A few images fail during clone | Normal if Framer throttles temporarily; the tool retries. Failed images keep loading from Framer's CDN and the site still works. |

To verify the tool itself still works:

```bash
npm test
```
