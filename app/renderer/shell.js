// Coquille : barre du haut (panneau, projet, navigation, adresse + serveur, Chrome), accueil,
// états du serveur de dev et de la page, guide d'installation de l'extension.
const $ = (id) => document.getElementById(id);
const home = (p) => p.replace(/^\/Users\/[^/]+/, "~");
const pretty = (url) => String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const SERVER_LABEL = { detecting: "Recherche…", starting: "Démarrage…", error: "Erreur", stopped: "Arrêté" };
const ICON = {
  busy: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
  error: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  stopped: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
  logs: '<svg viewBox="0 0 24 24"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>',
  offline: '<svg viewBox="0 0 24 24"><path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.43"/><path d="M2 8.82a15 15 0 0 1 4.18-2.65"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="m2 2 20 20"/></svg>',
};
const NET_ERROR = {
  ERR_CONNECTION_REFUSED: "rien ne répond à cette adresse", ERR_NAME_NOT_RESOLVED: "adresse introuvable",
  ERR_INTERNET_DISCONNECTED: "pas de connexion internet", ERR_CONNECTION_TIMED_OUT: "délai dépassé",
  ERR_ADDRESS_UNREACHABLE: "adresse injoignable", ERR_CERT_AUTHORITY_INVALID: "certificat non reconnu",
};
let state = null;

app.onState((s) => { state = s; render(); });
app.onFocusAddress(() => { $("address").focus(); $("address").select(); });
app.do("ready");

function render() {
  const { project, recents, server, page, view, extension } = state;
  document.body.classList.toggle("no-sidebar", !state.sidebar);
  $("toggleSidebar").setAttribute("aria-pressed", String(!!state.sidebar));
  $("projectName").textContent = project?.name || "Ouvrir un projet";
  $("project").classList.toggle("empty", !project);
  $("project").title = project ? home(project.dir) : "Ouvrir un projet (⌘O)";

  // navigation + adresse
  $("back").disabled = !page.canGoBack;
  $("forward").disabled = !page.canGoForward;
  $("reload").disabled = !page.url && !page.error;
  const addr = page.error?.url || page.url || "";
  if (document.activeElement !== $("address")) $("address").value = pretty(addr);
  $("addressForm").classList.toggle("filled", !!addr);
  $("progress").hidden = !(page.loading && page.url && view === "page");

  // serveur de dev : point dans la barre d'adresse
  const st = page.error && view === "page" ? "pageerror" : server.status;
  $("server").hidden = !project;
  $("server").dataset.status = st;
  $("serverText").textContent = SERVER_LABEL[st] || "";
  $("server").title = (server.status === "running"
    ? server.external ? "Serveur déjà lancé hors de l'app (réutilisé, jamais arrêté par l'app)" : `Serveur lancé par l'app : ${server.command}`
    : "Serveur de dev") + " — journaux (⌥⌘L)";

  $("openChrome").disabled = !(page.url || server.url);
  const browser = state.chrome && state.chrome !== "Google Chrome" ? state.chrome : "Chrome";
  $("openChrome").title = `Ouvrir dans ${browser} (⇧⌘O)`;
  $("install").hidden = !!extension || !project;

  // zone centrale
  const pageShown = !!page.url && !page.error && view === "page";
  $("installGuide").hidden = view !== "install";
  $("welcome").hidden = !!project || view === "install" || pageShown;
  $("status").hidden = !project || pageShown || view === "install";
  $("welcomeInstall").hidden = !!extension;
  $("installState").classList.toggle("ok", !!extension);
  $("installStateText").textContent = extension ? "Extension connectée" : "En attente de l'extension…";

  renderRecents(recents, project);
  if (project && !pageShown) renderStatus(project, server, page, view);
}

function renderRecents(recents, project) {
  const html = recents.filter((d) => d !== project?.dir).slice(0, 6)
    .map((d) => `<li><button data-dir="${esc(d)}"><span class="name">${esc(d.split("/").pop())}</span><small>${esc(home(d))}</small></button></li>`).join("");
  if ($("recents").innerHTML !== html) $("recents").innerHTML = html;
}

function renderStatus(project, server, page, view) {
  const st = server.status, logs = view === "logs";
  let icon = "busy", title, detail = "", mono = false, retry = null, typeAddr = false, showLogs = false;
  if (page.error && !logs) {
    icon = "offline"; title = "Page inaccessible";
    detail = `${pretty(page.error.url)} — ${NET_ERROR[page.error.desc] || page.error.desc}`;
    retry = "Recharger"; showLogs = !!server.logs?.length;
  } else if (st === "error") {
    icon = "error"; title = "Le serveur de dev n'a pas démarré"; detail = server.error || "";
    retry = "Réessayer"; typeAddr = true;
  } else if (st === "stopped") {
    icon = "stopped"; title = "Serveur arrêté"; detail = server.command ? "$ " + server.command : ""; mono = true;
    retry = "Redémarrer";
  } else if (logs) {
    icon = "logs"; title = "Journaux du serveur";
    detail = server.external ? `Serveur lancé hors de l'app — ${pretty(server.url)}` : server.command ? "$ " + server.command : "";
    mono = !server.external;
  } else if (st === "detecting") {
    title = "Recherche d'un serveur déjà lancé…";
  } else if (st === "running") {
    title = "Chargement de la page…"; detail = pretty(server.url);
  } else {
    title = `Démarrage de ${project.name}…`; detail = server.command ? "$ " + server.command : ""; mono = true;
  }
  $("statusIcon").className = "status-icon" + (icon === "busy" ? " busy" : icon === "error" || icon === "offline" ? " error" : "");
  $("statusIcon").innerHTML = ICON[icon];
  $("statusTitle").textContent = title;
  $("statusTitle").classList.toggle("shimmer", icon === "busy");
  $("statusDetail").textContent = detail;
  $("statusDetail").classList.toggle("mono", mono);
  $("retry").hidden = !retry;
  $("retry").textContent = retry || "";
  $("retry").dataset.what = page.error && !logs ? "reload" : "restart";
  $("typeAddress").hidden = !typeAddr;
  $("showLogs").hidden = !showLogs;
  $("backToPage").hidden = !logs || !page.url;
  // Pendant le démarrage, les journaux restent discrets ; en erreur ou sur demande, ils prennent la place.
  const el = $("logs");
  el.hidden = page.error && !logs;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  const text = (server.logs || []).join("\n");
  $("status").classList.toggle("compact", icon === "busy" || el.hidden || !text);
  if (el.textContent !== text) el.textContent = text;
  if (atBottom) el.scrollTop = el.scrollHeight;
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

$("project").onclick = () => {
  if (!state?.project && !state?.recents.length) return app.do("pick");
  const r = $("project").getBoundingClientRect();
  app.do("projectMenu", { x: r.left, y: r.bottom + 4 });
};
$("toggleSidebar").onclick = () => app.do("toggleSidebar");
$("pick").onclick = () => app.do("pick");
$("recents").onclick = (e) => { const b = e.target.closest("[data-dir]"); if (b) app.do("open", b.dataset.dir); };
$("back").onclick = () => app.do("back");
$("forward").onclick = () => app.do("forward");
$("reload").onclick = () => app.do("reload");
$("server").onclick = () => app.do("toggleLogs");
$("retry").onclick = () => app.do($("retry").dataset.what);
$("typeAddress").onclick = () => { $("address").focus(); $("address").select(); };
$("showLogs").onclick = () => app.do("toggleLogs");
$("backToPage").onclick = () => app.do("toggleLogs");
$("openChrome").onclick = () => app.do("openInChrome");
$("install").onclick = () => app.do("install");
$("welcomeInstall").onclick = () => app.do("install");
$("closeGuide").onclick = () => app.do("install");
$("openExtensions").onclick = () => app.do("openExtensionsPage");
$("revealExtension").onclick = () => app.do("revealExtension");
$("addressForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("address").value.trim();
  if (v) app.do("navigate", v);
  $("address").blur();
};
$("address").addEventListener("focus", () => {
  const url = state?.page.error?.url || state?.page.url;
  if (url) $("address").value = url;
  requestAnimationFrame(() => $("address").select());
});
$("address").addEventListener("blur", () => state && render());
$("address").addEventListener("keydown", (e) => { if (e.key === "Escape") $("address").blur(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.target === $("address") || !state) return;
  if (state.view === "logs" && state.page.url) app.do("toggleLogs");
  else if (state.view === "install") app.do("install");
});
