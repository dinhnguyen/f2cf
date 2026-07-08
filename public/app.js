const $ = (s, r = document) => r.querySelector(s);
const api = (p, opts) => fetch("/api" + p, opts).then((r) => r.json());
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "-");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sseByOp = {};

async function loadAuth() {
  const s = await api("/status");
  const el = $("#auth");
  el.textContent = s.auth ? `✓ ${s.auth.email}` : "✗ chưa đăng nhập - chạy: npx wrangler login";
  el.className = "auth " + (s.auth ? "ok" : "bad");
  return !!s.auth;
}

function badge(site) {
  if (site.op.running) return `<span class="badge run">${esc(site.op.kind)}…</span>`;
  if (site.op.error) return `<span class="badge err" title="${esc(site.op.error)}">lỗi</span>`;
  if (!site.syncedHash) return `<span class="badge new">chưa sync</span>`;
  if (site.hasUpdate) return `<span class="badge upd">có bản mới</span>`;
  return `<span class="badge ok">up to date</span>`;
}

async function render() {
  const authed = await loadAuth();
  const { sites } = await api("/sites");
  const tb = $("#sites tbody");
  tb.innerHTML = "";
  for (const s of sites) {
    const busy = s.op.running ? "disabled" : "";
    const id = esc(s.id);
    const safeHref = /^https?:\/\//.test(s.liveUrl || "") ? esc(s.liveUrl) : "#";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${esc(s.name)}</b>
        <div class="url"><a href="${safeHref}" target="_blank" rel="noopener noreferrer">${esc(s.liveUrl || s.cloudflareProject)}</a></div>
        <div class="src">${esc(s.framerUrl)}</div></td>
      <td data-label="Trạng thái">${badge(s)}</td>
      <td class="muted" data-label="Sync">${fmt(s.lastSyncedAt)}</td>
      <td class="muted" data-label="Publish">${fmt(s.lastPublishedAt)}</td>
      <td class="actions">
        <button data-act="check" data-id="${id}" ${busy}>Check</button>
        <button data-act="sync" data-id="${id}" ${busy}>Sync</button>
        <button data-act="preview" data-id="${id}" ${busy}>Preview</button>
        <button data-act="publish" data-id="${id}" ${busy || (authed ? "" : "disabled")}>Publish</button>
        <button data-act="delete" data-id="${id}" ${busy}>✕</button>
      </td>`;
    tb.appendChild(tr);
    if (s.op.running) openLog(s.id);
  }
}

function openLog(id) {
  if (sseByOp[id]) return;
  const log = $("#log");
  log.hidden = false; log.textContent = "";
  const es = new EventSource(`/api/sites/${encodeURIComponent(id)}/logs`);
  sseByOp[id] = es;
  es.onmessage = (e) => {
    const line = JSON.parse(e.data);
    log.textContent += line + "\n"; log.scrollTop = log.scrollHeight;
    if (line.startsWith("[done]") || line.startsWith("[error]")) { es.close(); delete sseByOp[id]; setTimeout(render, 300); }
  };
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === "check") { await api(`/sites/${id}/check`, { method: "POST" }); return render(); }
  if (act === "delete") { if (confirm(`Xoá ${id}?`)) { await api(`/sites/${id}`, { method: "DELETE" }); render(); } return; }
  if (act === "preview") { const r = await api(`/sites/${id}/preview`, { method: "POST" }); if (r.url) window.open(r.url, "_blank"); return; }
  await api(`/sites/${id}/${act}`, { method: "POST" }); // sync | publish
  openLog(id); render();
});

$("#addBtn").addEventListener("click", async () => {
  const framerUrl = $("#framerUrl").value.trim();
  if (!framerUrl) return;
  const project = $("#projectName").value.trim();
  await api("/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ framerUrl, project }) });
  $("#framerUrl").value = ""; $("#projectName").value = "";
  openLog("new:" + framerUrl);
  render();
});

render();
