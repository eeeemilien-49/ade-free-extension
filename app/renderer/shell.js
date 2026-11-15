// Coquille : barre du haut (projet, navigation, serveur, Chrome), accueil, journaux du serveur
// et guide d'installation de l'extension.
const $ = (id) => document.getElementById(id);
const home = (p) => p.replace(/^\/Users\/[^/]+/, "~");
const SERVER_LABEL = { detecting: "Recherche du serveur…", starting: "Démarrage…", error: "Erreur", stopped: "Arrêté" };
let state = null;

app.onState((s) => { state = s; render(); });
app.onFocusAddress(() => { $("address").focus(); $("address").select(); });
app.do("ready");

function render() {
  const { project, recents, server, page, view, extension } = state;
  $("projectName").textContent = project?.name || "Aucun projet";
  $("project").title = project ? home(project.dir) : "Ouvrir un projet";

  $("back").disabled = !page.canGoBack;
  $("forward").disabled = !page.canGoForward;
  $("reload").disabled = !page.url;
  if (document.activeElement !== $("address")) $("address").value = page.url || "";

  const st = server.status;
  $("server").hidden = !project;
  $("server").dataset.status = st;
  let host = "";
  try { host = new URL(server.url).host; } catch {}
  $("serverText").textContent = st === "running" ? host + (server.external ? " · externe" : "") : SERVER_LABEL[st] || "—";
  $("server").title = st === "running"
    ? (server.external ? "Serveur lancé hors de l'app (réutilisé, pas arrêté à la fermeture)" : `Lancé par l'app : ${server.command}`) + " — clic : journaux"
    : "Journaux du serveur";

  $("openChrome").disabled = !(page.url || server.url);
  $("openChromeText").textContent = state.chrome && state.chrome !== "Google Chrome" ? `Ouvrir dans ${state.chrome}` : "Ouvrir dans Chrome";
  $("install").hidden = !!extension;

  const pageShown = !!page.url && view === "page";
  $("installGuide").hidden = view !== "install";
  $("welcome").hidden = !!project || pageShown || view === "install";
  $("status").hidden = !project || pageShown || view === "install";
  $("installState").textContent = extension ? "Extension connectée." : "En attente de l'extension…";
  $("installState").classList.toggle("shimmer", !extension);
  $("installState").classList.toggle("ok", !!extension);

  $("recents").innerHTML = "";
  for (const d of recents) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.innerHTML = "<span></span><small></small>";
    b.firstChild.textContent = d.split("/").pop();
    b.lastChild.textContent = home(d);
    b.onclick = () => app.do("open", d);
    li.append(b);
    $("recents").append(li);
  }

  if (project) {
    const logs = view === "logs";
    const title = st === "error" ? "Le serveur de dev n'a pas démarré"
      : st === "running" ? (logs ? "Journaux du serveur" : "Chargement de la page…")
      : st === "stopped" ? "Serveur arrêté"
      : st === "detecting" ? "Recherche d'un serveur déjà lancé…" : `Démarrage de ${project.name}…`;
    $("statusTitle").textContent = title;
    $("statusTitle").classList.toggle("still", st === "error" || st === "stopped" || logs);
    $("statusDetail").textContent = st === "error" ? server.error || "" : server.command ? "$ " + server.command : "";
    $("statusDetail").classList.toggle("error", st === "error");
    $("retry").hidden = st !== "error" && st !== "stopped";
    $("backToPage").hidden = !logs || !page.url;
    const el = $("logs");
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.textContent = (server.logs || []).join("\n");
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
}

$("project").onclick = () => {
  const r = $("project").getBoundingClientRect();
  app.do("projectMenu", { x: r.left, y: r.bottom + 4 });
};
$("pick").onclick = () => app.do("pick");
$("back").onclick = () => app.do("back");
$("forward").onclick = () => app.do("forward");
$("reload").onclick = () => app.do("reload");
$("server").onclick = () => app.do("toggleLogs");
$("retry").onclick = () => app.do("restart");
$("backToPage").onclick = () => app.do("toggleLogs");
$("openChrome").onclick = () => app.do("openInChrome");
$("install").onclick = () => app.do("install");
$("closeGuide").onclick = () => app.do("install");
$("openExtensions").onclick = () => app.do("openExtensionsPage");
$("revealExtension").onclick = () => app.do("revealExtension");
$("addressForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("address").value.trim();
  if (v) app.do("navigate", v);
  $("address").blur();
};
$("address").addEventListener("keydown", (e) => { if (e.key === "Escape") { $("address").blur(); render(); } });
