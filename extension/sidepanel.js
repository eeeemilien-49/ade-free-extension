// Side panel : vue d'ensemble des commentaires, rangés par projet › page › conversation.
// Un clic sur un commentaire ouvre son fil dans la page (en y allant si besoin) ;
// un clic sur une conversation l'ouvre ici, avec les commentaires qu'elle a proposés.
const $ = (id) => document.getElementById(id);
const pageKey = (url) => String(url || "").split("#")[0];

const SVG = (inner, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const CHEV = SVG('<path d="m6 9 6 6 6-6"/>', "chev");
const CHECK = SVG('<path d="M20 6 9 17l-5-5"/>');
const X = SVG('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
const PLAY = SVG('<path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5Z"/>');
const CHAT = SVG('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', "st chat");
const TOOL_ICON = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
};
const TOOLS = { Read: ["file", "Lecture de", "Lu"], Grep: ["search", "Recherche de", "Recherché"], Glob: ["search", "Recherche de", "Recherché"] };
const STATUS_ICON = {
  queued: SVG('<path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/><path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/><path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/><path d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69"/><path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0"/><path d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7"/><path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8"/><path d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69"/>', "st queued"),
  running: SVG('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>', "st running"),
  done: SVG('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', "st done"),
  error: SVG('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>', "st error"),
  proposed: SVG('<circle cx="12" cy="12" r="10" stroke-dasharray="3 3"/>', "st proposed"),
  stopped: SVG('<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>', "st stopped"),
};
const STATUS_LABEL = { queued: "en attente", running: "en cours", done: "terminé", error: "erreur", proposed: "proposé", stopped: "arrêté" };
const REOPEN = SVG('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>');

let loaded = false; // première réponse du service reçue
let comments = [], seen = {}, collapsed = {}, current = null, activeId = null, lastHtml = "";
let convId = null, convFull = null, lastConvHtml = ""; // conversation ouverte dans le panneau
let histOpen = false, histItems = [], histTotal = 0, histSeq = 0, histTimer = 0; // vue Historique

// ---------- réglages ----------
$("toggleSettings").onclick = () => toggleSettings();
function toggleSettings(open = $("settings").hidden) {
  $("settings").hidden = !open;
  $("toggleSettings").setAttribute("aria-expanded", String(open));
  if (open) $("cwd").disabled ? $("mode").focus() : $("cwd").focus();
}
async function loadSettings() {
  const conf = { mode: "acceptEdits", projects: {}, ...(await chrome.storage.local.get(["mode", "projects"])) };
  let origin = "";
  try { origin = new URL(current?.url).origin; } catch {}
  $("origin").textContent = origin.replace(/^https?:\/\//, "") || "ce site";
  $("cwd").value = conf.projects[origin] || "";
  $("cwd").disabled = !origin.startsWith("http");
  $("cwd").dataset.origin = origin;
  $("mode").value = conf.mode;
}
$("cwd").onchange = async () => {
  const { projects = {} } = await chrome.storage.local.get("projects");
  const v = $("cwd").value.trim(), o = $("cwd").dataset.origin;
  if (v) projects[o] = v; else delete projects[o];
  chrome.storage.local.set({ projects });
};
$("mode").onchange = () => chrome.storage.local.set({ mode: $("mode").value });

// Le côté du panneau est un réglage de Chrome, pas de l'extension : on se contente
// d'y mener (lien masqué si le panneau est déjà à gauche ; getLayout = Chrome 140+).
(async () => {
  let side = null;
  try { side = (await chrome.sidePanel.getLayout())?.side; } catch {}
  $("panelSide").hidden = side === "left";
})();
$("panelSide").onclick = () => chrome.tabs.create({ url: "chrome://settings/appearance" });

// ---------- données ----------
async function refresh() {
  [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  ({ seen = {}, collapsed = {} } = await chrome.storage.local.get(["seen", "collapsed"]));
  const res = await chrome.runtime.sendMessage({ type: "all" }).catch((e) => ({ error: e.message }));
  showError(res?.error, res?.code);
  if (!res?.error) comments = res.data;
  loaded = true;
  if (convId) {
    const conv = comments.find((c) => c.id === convId);
    if (!conv) closeConv();
    else {
      const full = await chrome.runtime.sendMessage({ type: "list", url: conv.url }).catch(() => null);
      convFull = full?.data?.comments?.find((c) => c.id === convId) || convFull;
      if (conv.finishedAt && (seen[convId] || 0) < conv.finishedAt) markSeen(convId);
    }
  }
  render();
}
function showError(msg, code) {
  $("error").hidden = !msg;
  $("errorText").textContent = msg || "";
  $("openApp").hidden = code !== "noapp";
  $("retry").hidden = code === "noapp";
}
$("retry").onclick = refresh;
$("openApp").onclick = async () => {
  $("openApp").disabled = true;
  $("errorText").textContent = "Démarrage…";
  const r = await chrome.runtime.sendMessage({ type: "openApp" }).catch((e) => ({ error: e.message }));
  $("openApp").disabled = false;
  if (r?.error) showError(r.error, r.code); else refresh();
};
const isUnread = (c) => (c.status === "done" || c.status === "error") && c.finishedAt && (seen[c.id] || 0) < c.finishedAt;
const isConv = (c) => c.kind === "conversation";
const kids = (conv) => comments.filter((c) => c.parentId === conv.id).sort((a, b) => a.n - b.n);
async function markSeen(id) {
  seen[id] = Date.now();
  await chrome.storage.local.set({ seen });
}

// ---------- rendu ----------
function group(key, title, inner, cls = "") {
  const open = !collapsed[key];
  return `<div class="group ${cls}"><button class="node" data-toggle="${esc(key)}" aria-expanded="${open}"${title.tip ? ` title="${esc(title.tip)}"` : ""}>
    <span class="label">${esc(title.text)}</span>${CHEV}</button>
    <div class="children"${open ? "" : " hidden"}>${inner}</div></div>`;
}
function row(c) {
  const unread = isUnread(c);
  const tip = [c.text, STATUS_LABEL[c.status], c.stats].filter(Boolean).join(" — ");
  const acts = c.status === "proposed"
    ? `<button class="act launch" data-launch="${c.id}" title="Lancer" aria-label="Lancer">${PLAY}</button>
       <button class="act" data-resolve="${c.id}" title="Retirer" aria-label="Retirer">${X}</button>`
    : `<button class="act" data-resolve="${c.id}" title="Résoudre" aria-label="Résoudre">${CHECK}</button>`;
  return `<div class="row${unread ? " unread" : ""}${c.id === activeId ? " active" : ""}${c.status === "proposed" ? " proposed" : ""}">
    <button class="node" data-open="${c.id}" title="${esc(tip)}">${STATUS_ICON[c.status] || STATUS_ICON.queued}
      ${c.parentId ? `<span class="n">${c.n}</span>` : ""}<span class="label">${esc(c.text.split("\n")[0])}</span>
      <span class="meta">${unread ? '<span class="unread-dot" aria-label="non lu"></span>' : ""}</span>
    </button>
    <span class="acts">${acts}</span></div>`;
}
// Conversation : ligne qui s'ouvre dans le panneau, ses commentaires imbriqués dessous.
function convRow(conv) {
  const list = kids(conv);
  const key = "c:" + conv.id, open = !collapsed[key];
  const unread = isUnread(conv) || list.some(isUnread);
  const busy = conv.status === "running" || conv.status === "queued";
  const proposed = list.filter((c) => c.status === "proposed").length;
  return `<div class="conv${conv.id === convId ? " active" : ""}">
    <div class="row${unread ? " unread" : ""}">
      <button class="node" data-conv="${conv.id}" title="${esc(conv.text)}">${busy ? STATUS_ICON.running : conv.status === "error" ? STATUS_ICON.error : CHAT}
        <span class="label">${esc(conv.text.split("\n")[0])}</span>
        <span class="meta">${unread ? '<span class="unread-dot" aria-label="non lu"></span>' : ""}${proposed ? `<span class="pill">${proposed} à lancer</span>` : ""}</span>
      </button>
      <span class="acts">${list.length ? `<button class="act" data-toggle="${esc(key)}" aria-expanded="${open}" title="${open ? "Replier" : "Déplier"}">${CHEV}</button>` : ""}
        <button class="act" data-resolve="${conv.id}" title="Résoudre la conversation et ses commentaires" aria-label="Résoudre">${CHECK}</button></span>
    </div>
    ${list.length ? `<div class="children"${open ? "" : " hidden"}>${list.map(row).join("")}</div>` : ""}</div>`;
}

function render() {
  const latest = (list) => Math.max(...list.map((c) => c.finishedAt || c.createdAt || 0));
  const currentKey = pageKey(current?.url);
  let html = "";

  // projet (dossier) › page (url) › commentaires
  const projects = new Map();
  for (const c of comments) {
    if (!projects.has(c.cwd)) projects.set(c.cwd, new Map());
    const pages = projects.get(c.cwd);
    if (!pages.has(c.url)) pages.set(c.url, []);
    pages.get(c.url).push(c);
  }
  // En cours : ce que Claude traite en ce moment, toutes pages confondues.
  const running = comments.filter((c) => !isConv(c) && (c.status === "running" || c.status === "queued"));
  if (running.length) html += group("running", { text: `En cours · ${running.length}` }, running.map(row).join(""), "running");
  const projectEntries = [...projects].sort((a, b) => latest([...b[1].values()].flat()) - latest([...a[1].values()].flat()));
  for (const [cwd, pages] of projectEntries) {
    let inner = "";
    for (const [url, list] of [...pages].sort((a, b) => latest(b[1]) - latest(a[1]))) {
      let path = url, host = "";
      try { const u = new URL(url); path = u.pathname; host = u.host; } catch {}
      const gKey = "g:" + url, gOpen = !collapsed[gKey];
      const unread = list.filter(isUnread).length;
      const top = list.filter((c) => !c.parentId || !list.some((x) => x.id === c.parentId));
      const byTime = (c) => (isConv(c) ? c.createdAt : 0);
      inner += `<div class="page${url === currentKey ? " current" : ""}"><button class="node" data-toggle="${esc(gKey)}" aria-expanded="${gOpen}" title="${esc(url)}">
        <span class="label">${esc(path)}<span class="host">${esc(host)}</span></span>
        ${unread ? `<span class="unread-dot" aria-label="${unread} non lu${unread > 1 ? "s" : ""}"></span>` : ""}
        <span class="count">${list.filter((c) => !isConv(c)).length}</span>${CHEV}</button>
        <div class="children"${gOpen ? "" : " hidden"}>${top.sort((a, b) => byTime(a) - byTime(b) || (a.n || 0) - (b.n || 0)).map((c) => (isConv(c) ? convRow(c) : row(c))).join("")}</div></div>`;
    }
    const name = cwd.split("/").filter(Boolean).pop() || cwd;
    html += group("p:" + cwd, { text: name, tip: cwd }, inner);
  }

  $("empty").hidden = comments.length > 0 || !$("error").hidden || !!convId || histOpen || !loaded;
  const unread = comments.filter(isUnread).length;
  $("unreadCount").hidden = !unread;
  $("unreadCount").textContent = unread;
  if (html !== lastHtml) { $("tree").innerHTML = html; lastHtml = html; }
  $("tree").hidden = !!convId || histOpen;
  $("convView").hidden = !convId || histOpen;
  $("histView").hidden = !histOpen;
  $("composer").hidden = histOpen || (!convId && !canConverse());
  $("tabComments").setAttribute("aria-selected", String(!histOpen));
  $("toggleHistory").setAttribute("aria-selected", String(histOpen));
  renderConv();
  updateComposer();
}

// ---------- conversation ouverte ----------
function renderConv() {
  if (!convId) return;
  const conv = comments.find((c) => c.id === convId);
  if (!conv) return;
  const full = convFull?.id === convId ? convFull : { ...conv, messages: [] };
  $("convTitle").textContent = conv.text.split("\n")[0];
  $("convTitle").title = conv.text;
  let html = "", trace = "";
  const flush = () => { if (trace) html += `<div class="trace">${trace}</div>`; trace = ""; };
  for (const m of [{ role: "user", text: conv.text }, ...(full.messages || [])]) {
    if (m.role === "tool") {
      const [ic, doing, done] = TOOLS[m.name] || ["tool", m.name || "", m.name || ""];
      trace += `<div class="tool${m.isError ? " error" : ""}">${m.running ? STATUS_ICON.running : SVG(TOOL_ICON[ic])}
        <span class="label${m.running ? " shimmer" : ""}">${esc(m.running ? doing : done)} <b>${esc(m.target || "")}</b></span></div>`;
      continue;
    }
    flush();
    if (m.role === "user") html += `<div class="msg-user">${esc(m.text)}</div>`;
    else if (m.role === "error") html += `<div class="msg-error">${esc(m.text)}</div>`;
    else html += `<div class="msg-assistant">${md(m.text)}</div>`;
  }
  flush();
  if (conv.status === "queued") html += `<div class="status">${STATUS_ICON.running}<span>En attente…</span></div>`;
  if (conv.status === "running") html += `<div class="status"><span class="shimmer">Claude analyse la page…</span></div>`;

  const list = kids(conv);
  if (list.length) {
    const proposed = list.filter((c) => c.status === "proposed").length;
    html += `<div class="card"><div class="card-head"><span class="label">Commentaires</span>
      ${proposed ? `<button class="btn-primary" data-launch-all="${conv.id}">${PLAY}Lancer${proposed > 1 ? ` les ${proposed}` : ""}</button>` : ""}</div>
      ${list.map(row).join("")}</div>`;
  }
  if (conv.stats && conv.status !== "running") html += `<div class="footer-meta">${esc(conv.stats)}</div>`;
  if (html === lastConvHtml) return;
  const body = $("convBody");
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
  body.innerHTML = html;
  lastConvHtml = html;
  if (atBottom) body.scrollTop = body.scrollHeight;
}
async function openConv(id) {
  convId = id;
  convFull = null;
  lastConvHtml = "";
  markSeen(id);
  render();
  await refresh();
  $("convBody").scrollTop = $("convBody").scrollHeight;
  $("prompt").focus();
}
function closeConv() {
  convId = null;
  convFull = null;
  render();
}
$("back").onclick = closeConv;
$("convResolve").onclick = () => convId && resolveComment(convId);
$("convBody").addEventListener("click", (e) => treeClick(e));

// ---------- saisie : nouvelle conversation sur la page, ou suite de la conversation ouverte ----------
const canConverse = () => /^https?:/.test(current?.url || "");
function updateComposer() {
  const conv = convId && comments.find((c) => c.id === convId);
  const busy = conv && (conv.status === "running" || conv.status === "queued");
  $("prompt").placeholder = conv ? "Répondre (ex. « annule le 3 »)" : "Demander à Claude sur cette page…";
  $("prompt").disabled = !conv && !canConverse();
  $("promptHint").textContent = conv ? "" : canConverse() ? "Propose des commentaires sur la page" : "Ouvre une page web pour demander";
  $("send").disabled = !$("prompt").value.trim() || $("prompt").disabled || !!busy;
  $("enterHint").hidden = $("send").disabled;
  $("promptHint").hidden = !!$("prompt").value.trim();
}
async function sendPrompt() {
  const text = $("prompt").value.trim();
  if (!text || $("send").disabled) return;
  $("send").disabled = true;
  const conv = convId && comments.find((c) => c.id === convId);
  const res = conv
    ? await chrome.runtime.sendMessage({ type: "converseReply", id: conv.id, url: conv.url, text }).catch((e) => ({ error: e.message }))
    : await chrome.runtime.sendMessage({ type: "converse", tabId: current.id, text, cwd: $("cwd").value }).catch((e) => ({ error: e.message }));
  showError(res?.error, res?.code);
  if (res?.error) return updateComposer();
  $("prompt").value = "";
  autoGrow();
  if (!conv) return openConv(res.data.id);
  await refresh();
  $("convBody").scrollTop = $("convBody").scrollHeight;
}
function autoGrow() { const t = $("prompt"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }
$("prompt").addEventListener("input", () => { autoGrow(); updateComposer(); });
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendPrompt(); }
  if (e.key === "Escape" && convId) closeConv();
});
$("send").onclick = sendPrompt;

async function launch(payload) {
  const target = comments.find((c) => c.id === (payload.id || payload.parentId));
  const list = payload.id ? [target] : comments.filter((c) => c.parentId === payload.parentId && c.status === "proposed");
  for (const c of list) c.status = "queued"; // retour immédiat
  render();
  const selectors = Object.fromEntries(list.map((c) => [c.id, c.selector]));
  const res = await chrome.runtime.sendMessage({ type: "launch", ...payload, url: list[0]?.url, selectors }).catch((e) => ({ error: e.message }));
  showError(res?.error, res?.code);
  refresh();
}

$("tree").addEventListener("click", (e) => treeClick(e));
async function treeClick(e) {
  const launchBtn = e.target.closest("[data-launch]");
  if (launchBtn) return launch({ id: launchBtn.dataset.launch });
  const launchAll = e.target.closest("[data-launch-all]");
  if (launchAll) return launch({ parentId: launchAll.dataset.launchAll });
  const convBtn = e.target.closest("[data-conv]");
  if (convBtn) return openConv(convBtn.dataset.conv);
  const resolve = e.target.closest("[data-resolve]");
  if (resolve) return resolveComment(resolve.dataset.resolve);
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const key = toggle.dataset.toggle;
    collapsed[key] ? delete collapsed[key] : (collapsed[key] = true);
    await chrome.storage.local.set({ collapsed });
    return render();
  }
  const open = e.target.closest("[data-open]");
  if (open) openComment(comments.find((c) => c.id === open.dataset.open));
}

// Résoudre = archiver le commentaire (et arrêter sa session) : retrait immédiat, comme dans la page.
async function resolveComment(id) {
  comments = comments.filter((c) => c.id !== id && c.parentId !== id);
  if (activeId === id) activeId = null;
  if (convId === id) convId = null;
  render();
  const res = await chrome.runtime.sendMessage({ type: "resolve", id }).catch((e) => ({ error: e.message }));
  if (res?.error) showError(res.error);
  refresh();
}

// Ouvre le fil dans la page : onglet déjà ouvert sur cette page, sinon l'onglet actif y navigue.
async function openComment(c, reopened) {
  if (!c) return;
  activeId = c.id;
  seen[c.id] = Date.now();
  await chrome.storage.local.set({ seen });
  render();
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((t) => pageKey(t.url) === c.url);
  // Rouvert depuis l'historique : la page ne le connaît pas encore, elle l'ouvrira à son prochain relevé.
  if (reopened) await chrome.storage.local.set({ pendingOpen: { id: c.id, url: c.url } });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    chrome.tabs.sendMessage(tab.id, { type: "cc:open", id: c.id }).catch(() => {});
  } else {
    await chrome.storage.local.set({ pendingOpen: { id: c.id, url: c.url } });
    chrome.tabs.update(current.id, { url: c.url });
  }
}

// ---------- historique : éléments résolus, rangés par projet › page › jour ----------
const PAGE_SIZE = 50;

$("toggleHistory").onclick = () => (histOpen ? closeHistory() : openHistory());
$("tabComments").onclick = () => { if (histOpen) closeHistory(); else if (convId) closeConv(); };
$("histQ").addEventListener("input", () => { clearTimeout(histTimer); histTimer = setTimeout(() => loadHistory(), 200); });
$("histQ").addEventListener("keydown", (e) => { if (e.key === "Escape") closeHistory(); });
$("histBody").addEventListener("click", histClick);

function openHistory() {
  histOpen = true;
  $("toggleHistory").setAttribute("aria-expanded", "true");
  render();
  loadHistory();
  $("histQ").focus();
}
function closeHistory() {
  histOpen = false;
  $("toggleHistory").setAttribute("aria-expanded", "false");
  render();
}
async function loadHistory(more) {
  const seq = ++histSeq;
  const res = await chrome.runtime.sendMessage({ type: "history", q: $("histQ").value.trim(), offset: more ? histItems.length : 0, limit: PAGE_SIZE })
    .catch((e) => ({ error: e.message }));
  if (seq !== histSeq) return; // réponse d'une recherche dépassée
  showError(res?.error, res?.code);
  if (res?.error) return;
  histItems = more ? histItems.concat(res.data.items) : res.data.items;
  histTotal = res.data.total;
  renderHistory();
}

const dayLabel = (t) => {
  const d = new Date(t), today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
};
const timeLabel = (t) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function histRow(c) {
  // stats = « $0.012 · 34 s » : durée puis coût.
  const stats = String(c.stats || "").split(" · ").filter(Boolean);
  const cost = stats.find((x) => x.startsWith("$")), dur = stats.find((x) => !x.startsWith("$"));
  const meta = [timeLabel(c.resolvedAt), dur, cost, c.children && `${c.children} commentaire${c.children > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const icon = isConv(c) ? CHAT : STATUS_ICON[c.status] || STATUS_ICON.done;
  return `<div class="hist">
    <div class="hist-head" title="${esc([c.text, STATUS_LABEL[c.status]].filter(Boolean).join(" — "))}">${icon}<span class="label">${esc(c.text.split("\n")[0])}</span></div>
    <div class="hist-meta">${esc(meta)}</div>
    ${c.final ? `<details><summary>${CHEV}Réponse</summary><div class="msg-assistant">${md(c.final)}</div></details>` : ""}
    <span class="acts"><button class="act" data-reopen="${c.id}" title="Rouvrir" aria-label="Rouvrir">${REOPEN}</button></span></div>`;
}

function renderHistory() {
  if (!histItems.length) {
    $("histBody").innerHTML = `<div class="state empty">${SVG('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>')}
      <strong>${$("histQ").value.trim() ? "Aucun résultat" : "Aucun élément résolu"}</strong></div>`;
    return;
  }
  // projet › page › jour, dans l'ordre d'arrivée (du plus récent au plus ancien)
  const projects = new Map();
  for (const c of histItems) {
    if (!projects.has(c.cwd)) projects.set(c.cwd, new Map());
    const pages = projects.get(c.cwd);
    if (!pages.has(c.url)) pages.set(c.url, []);
    pages.get(c.url).push(c);
  }
  let html = "";
  for (const [cwd, pages] of projects) {
    let inner = "";
    for (const [url, list] of pages) {
      let path = url, host = "";
      try { const u = new URL(url); path = u.pathname; host = u.host; } catch {}
      const key = "hg:" + url, open = !collapsed[key];
      let rows = "", day = "";
      for (const c of list) {
        const d = dayLabel(c.resolvedAt);
        if (d !== day) { rows += `<div class="day">${esc(d)}</div>`; day = d; }
        rows += histRow(c);
      }
      inner += `<div class="page"><button class="node" data-toggle="${esc(key)}" aria-expanded="${open}" title="${esc(url)}">
        <span class="label">${esc(path)}<span class="host">${esc(host)}</span></span>
        <span class="count">${list.length}</span>${CHEV}</button>
        <div class="children"${open ? "" : " hidden"}>${rows}</div></div>`;
    }
    html += group("hp:" + cwd, { text: cwd.split("/").filter(Boolean).pop() || cwd, tip: cwd }, inner);
  }
  if (histItems.length < histTotal) html += `<button class="link more" data-more>Afficher plus (${histTotal - histItems.length})</button>`;
  // Garde les réponses dépliées d'un rendu à l'autre.
  const opened = new Set([...$("histBody").querySelectorAll("details[open]")].map((d) => d.closest(".hist").querySelector("[data-reopen]").dataset.reopen));
  $("histBody").innerHTML = html;
  for (const id of opened) $("histBody").querySelector(`[data-reopen="${id}"]`)?.closest(".hist").querySelector("details")?.setAttribute("open", "");
}

async function histClick(e) {
  if (e.target.closest("[data-more]")) return loadHistory(true);
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const key = toggle.dataset.toggle;
    collapsed[key] ? delete collapsed[key] : (collapsed[key] = true);
    await chrome.storage.local.set({ collapsed });
    return renderHistory();
  }
  const btn = e.target.closest("[data-reopen]");
  if (btn) reopen(btn.dataset.reopen);
}

// Rouvrir : l'élément redevient actif (même session) puis s'ouvre comme un commentaire actif.
async function reopen(id) {
  const res = await chrome.runtime.sendMessage({ type: "reopen", id }).catch((e) => ({ error: e.message }));
  showError(res?.error, res?.code);
  if (res?.error) return;
  histItems = histItems.filter((c) => c.id !== id);
  histTotal--;
  closeHistory();
  await refresh();
  const c = comments.find((x) => x.id === id) || res.data;
  if (isConv(c)) openConv(c.id);
  else openComment(c, true);
}

// Raccourcis de l'app de bureau (menu Présentation, ⌘,) : l'app envoie « panel:command ».
document.addEventListener("panel:command", (e) => {
  const cmd = e.detail;
  if (cmd === "settings") toggleSettings(true);
  else if (cmd === "history") histOpen ? $("histQ").focus() : openHistory();
  else if (cmd === "comments") { if (histOpen) closeHistory(); if (convId) closeConv(); }
  else if (cmd === "prompt") { if (histOpen) closeHistory(); if (!$("composer").hidden) $("prompt").focus(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.target === $("prompt") || e.target === $("histQ")) return;
  if (!$("settings").hidden) toggleSettings(false);
  else if (histOpen) closeHistory();
  else if (convId) closeConv();
});

chrome.tabs.onActivated.addListener(() => refresh().then(loadSettings));
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "complete") refresh().then(loadSettings); });
chrome.storage.onChanged.addListener((ch) => { if (ch.seen) refresh(); });

function md(src) {
  return esc(src)
    .replace(/```\w*\n?([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

refresh().then(loadSettings);
setInterval(() => document.visibilityState === "visible" && refresh(), 2000);
