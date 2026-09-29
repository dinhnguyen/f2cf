const $ = (s, r = document) => r.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const fmt = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const elapsed = (t) => {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const sseByOp = {};
const pending = new Map(); // framerUrl -> startedAt, clones the server has not registered yet
const opStart = new Map();  // site id -> when this tab first saw the op running
const localBusy = new Map(); // site id -> kind, for ops this tab just fired but the server has not reported yet
let inflight = 0;
let authed = null;
let sites = null;
let painted = false;

// The top bar is the only always-visible proof that something is happening: any request
// in flight, any server-side op running, or any clone still unregistered keeps it alive.
const bar = () => {
  const busy = inflight > 0 || pending.size > 0 || localBusy.size > 0 || (sites || []).some((s) => s.op.running);
  $("#bar").classList.toggle("on", busy);
};

const api = async (p, opts) => {
  inflight++; bar();
  try { return await (await fetch("/api" + p, opts)).json(); }
  finally { inflight--; bar(); }
};

async function loadAuth() {
  const s = await api("/status");
  const el = $("#auth");
  el.textContent = s.auth ? (s.auth.email || s.auth.account) : "chưa đăng nhập - chạy npx wrangler login";
  el.className = "auth " + (s.auth ? "ok" : "bad");
  const next = !!s.auth;
  if (next !== authed) { authed = next; if (sites) paint(); }
}

const isBusy = (site) => site.op.running || localBusy.has(site.id);

function badge(site) {
  if (isBusy(site)) {
    const t = opStart.get(site.id) ?? Date.now();
    opStart.set(site.id, t);
    return `<span class="badge run">${esc(site.op.kind || localBusy.get(site.id))} <b data-since="${t}">${elapsed(t)}</b></span>`;
  }
  opStart.delete(site.id);
  if (site.op.error) return `<span class="badge err" title="${esc(site.op.error)}">lỗi</span>`;
  if (!site.syncedHash) return `<span class="badge new">chưa sync</span>`;
  if (site.hasUpdate) return `<span class="badge upd">có bản mới</span>`;
  return `<span class="badge ok">up to date</span>`;
}

const skeletonRows = (n) => Array.from({ length: n }, () => {
  const tr = document.createElement("tr");
  tr.className = "skel";
  tr.innerHTML = `<td><i class="sk" style="width:46%"></i><i class="sk" style="width:72%"></i></td>
    <td><i class="sk" style="width:70%"></i></td><td><i class="sk" style="width:80%"></i></td>
    <td><i class="sk" style="width:80%"></i></td><td><i class="sk" style="width:60%"></i></td>
    <td><i class="sk" style="width:90%"></i></td>`;
  return tr;
});

function pendingRow(framerUrl, startedAt) {
  const tr = document.createElement("tr");
  tr.className = "busy ghost";
  tr.innerHTML = `
    <td><b>${esc(framerUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</b>
      <div class="src">đang tải site về, chưa vào registry</div></td>
    <td data-label="Trạng thái"><span class="badge run">clone <b data-since="${startedAt}">${elapsed(startedAt)}</b></span></td>
    <td class="muted" data-label="Sync">-</td>
    <td class="muted" data-label="Publish">-</td>
    <td class="muted" data-label="GitHub">-</td>
    <td class="actions"></td>`;
  return tr;
}

function paint() {
  const tb = $("#sites tbody");
  tb.innerHTML = "";
  // Entrance animation belongs to the first paint only; replaying it on every op completion
  // makes the whole table blink.
  tb.classList.toggle("intro", !painted && !!sites);
  if (sites) painted = true;
  if (!sites) { skeletonRows(3).forEach((r) => tb.appendChild(r)); return bar(); }

  for (const s of sites) {
    const busy = isBusy(s) ? "disabled" : "";
    const id = esc(s.id);
    const safeHref = /^https?:\/\//.test(s.liveUrl || "") ? esc(s.liveUrl) : "#";
    const tr = document.createElement("tr");
    if (isBusy(s)) tr.className = "busy";
    tr.innerHTML = `
      <td><b>${esc(s.name)}</b>
        <div class="url"><a href="${safeHref}" target="_blank" rel="noopener noreferrer">${esc(s.liveUrl || s.cloudflareProject)}</a></div>
        <div class="src">${esc(s.framerUrl)}</div>
        <div class="src">${esc(s.cloudflareProject)}
          <button class="link" data-act="project" data-id="${id}" ${busy}>đổi project</button></div></td>
      <td data-label="Trạng thái">${badge(s)}</td>
      <td class="muted" data-label="Sync">${fmt(s.lastSyncedAt)}</td>
      <td class="muted" data-label="Publish">${fmt(s.lastPublishedAt)}</td>
      <td class="muted" data-label="GitHub">${s.github?.repo
        ? `<a href="https://github.com/${esc(s.github.repo)}" target="_blank" rel="noopener noreferrer">${esc(s.github.repo)}</a>
           <div class="src">${s.github.lastCommit ? esc(s.github.lastCommit.slice(0, 7)) + " · " + fmt(s.github.lastPushedAt) : "chưa push"}</div>`
        : ""}
        <button class="link" data-act="repo" data-id="${id}" ${busy}>${s.github?.repo ? "đổi" : "đặt repo"}</button></td>
      <td class="actions">
        <button data-act="check" data-id="${id}" ${busy}>Check</button>
        <button data-act="sync" data-id="${id}" ${busy}>Sync</button>
        <button data-act="preview" data-id="${id}" ${busy}>Preview</button>
        <button data-act="push" data-id="${id}" ${busy || (s.github?.repo ? "" : "disabled")}>Push</button>
        <button data-act="publish" data-id="${id}" ${busy || (authed ? "" : "disabled")}>Publish</button>
        <button data-act="delete" data-id="${id}" ${busy}>✕</button>
      </td>`;
    tb.appendChild(tr);
    if (isBusy(s)) openLog(s.id);
  }
  for (const [url, at] of pending) tb.appendChild(pendingRow(url, at));
  bar();
}

async function render() {
  sites = (await api("/sites")).sites;
  paint();
}

// One ticker drives every running counter, so a long clone visibly advances instead of
// looking frozen between SSE lines.
setInterval(() => {
  for (const el of document.querySelectorAll("[data-since]")) el.textContent = elapsed(Number(el.dataset.since));
}, 1000);

// Returns once the stream is actually open. EventSource connects asynchronously, so firing
// the POST first drops every line the op emits before the browser finishes the handshake.
function openLog(id) {
  if (sseByOp[id]) return sseByOp[id].ready;
  const log = $("#log");
  log.hidden = false; log.textContent = "";
  const es = new EventSource(`/api/sites/${encodeURIComponent(id)}/logs`);
  es.ready = new Promise((resolve) => {
    es.onopen = resolve;
    setTimeout(resolve, 2000); // never block the action on a stream that will not open
  });
  sseByOp[id] = es;
  es.onmessage = (e) => {
    const line = JSON.parse(e.data);
    const el = document.createElement("span");
    if (line.startsWith("[error]")) el.className = "l-err";
    else if (line.startsWith("[busy]")) el.className = "l-warn";
    else if (line.startsWith("[done]")) el.className = "l-ok";
    el.textContent = line + "\n";
    log.appendChild(el); log.scrollTop = log.scrollHeight;
    if (line.startsWith("[done]") || line.startsWith("[error]")) {
      es.close(); delete sseByOp[id];
      localBusy.delete(id);
      if (id.startsWith("new:")) pending.delete(id.slice(4));
      setTimeout(render, 300);
    }
  };
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const { act, id } = b.dataset;

  if (act === "repo") {
    const site = (sites || []).find((s) => s.id === id);
    const next = prompt(`GitHub repo cho "${id}" (để trống để bỏ liên kết):`, site?.github?.repo || "");
    if (next === null) return;
    const r = await api(`/sites/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ githubRepo: next.trim() }) });
    if (r.error) alert(r.error);
    return render();
  }
  if (act === "project") {
    const site = (sites || []).find((s) => s.id === id);
    const next = prompt(`Cloudflare project cho "${id}" (đổi tên sẽ đổi URL pages.dev, phải sync lại trước khi publish):`, site?.cloudflareProject || "");
    if (next === null) return;
    const r = await api(`/sites/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cloudflareProject: next.trim() }) });
    if (r.error) alert(r.error);
    return render();
  }
  if (act === "check") { await api(`/sites/${id}/check`, { method: "POST" }); return render(); }
  if (act === "delete") { if (confirm(`Xoá ${id}?`)) { await api(`/sites/${id}`, { method: "DELETE" }); render(); } return; }
  if (act === "preview") { const r = await api(`/sites/${id}/preview`, { method: "POST" }); if (r.url) window.open(r.url, "_blank"); return; }

  // Hold the row busy from the click itself: the server only reports `running` on the next
  // poll, and paint() rebuilds the row, so an optimistic CSS class alone would flicker away.
  localBusy.set(id, act);
  paint();
  await openLog(id);
  await api(`/sites/${id}/${act}`, { method: "POST" }); // sync | push | publish
  render();
});

// Closing only hides the pane; the stream stays open so a finished op still refreshes the
// table. The next op reopens it.
$("#clearLog").addEventListener("click", () => { $("#log").textContent = ""; });
$("#closeLog").addEventListener("click", () => { const l = $("#log"); l.textContent = ""; l.hidden = true; });

const dlg = $("#addDlg");
$("#openAdd").addEventListener("click", () => { $("#addErr").hidden = true; dlg.showModal(); $("#framerUrl").focus(); });
$("#cancelAdd").addEventListener("click", () => dlg.close());

$("#addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const framerUrl = $("#framerUrl").value.trim();
  if (!framerUrl) return;
  const body = JSON.stringify({ framerUrl, project: $("#projectName").value.trim(), githubRepo: $("#githubRepo").value.trim() });
  await openLog("new:" + framerUrl);
  const r = await api("/sites", { method: "POST", headers: { "content-type": "application/json" }, body });
  if (r.error) {
    sseByOp["new:" + framerUrl]?.close(); delete sseByOp["new:" + framerUrl];
    $("#log").hidden = true;
    const p = $("#addErr"); p.textContent = r.error; p.hidden = false;
    return;
  }
  pending.set(framerUrl, Date.now());
  dlg.close();
  $("#framerUrl").value = ""; $("#projectName").value = ""; $("#githubRepo").value = "";
  paint();
});

paint();      // skeleton first
render();
loadAuth();   // slow (spawns wrangler); must not block the table
