// Coquille : barre du haut (projet, navigation, serveur) et accueil / journaux du serveur.
const $ = (id) => document.getElementById(id);
const home = (p) => p.replace(/^\/Users\/[^/]+/, "~");
const SERVER_LABEL = { detecting: "Recherche du serveur…", starting: "Démarrage…", error: "Erreur", stopped: "Arrêté" };
let state = null;

app.onState((s) => { state = s; render(); });
app.onFocusAddress(() => { $("address").focus(); $("address").select(); });
app.do("ready");

function render() {
  const { project, recents, server, page, showLogs } = state;
  $("projectName").textContent = project?.name || "Aucun projet";
  $("project").title = project ? home(project.dir) : "Ouvrir un projet";

  $("back").disabled = !page.canGoBack;
  $("forward").disabled = !page.canGoForward;
  if (document.activeElement !== $("address")) $("address").value = page.url && page.url !== "about:blank" ? page.url : "";

  const st = server.status;
  $("server").hidden = !project;
  $("server").dataset.status = st;
  let host = "";
  try { host = new URL(server.url).host; } catch {}
  $("serverText").textContent = st === "running" ? host + (server.external ? " · externe" : "") : SERVER_LABEL[st] || "—";
  $("server").title = st === "running"
    ? (server.external ? "Serveur lancé hors de l'app (réutilisé, pas arrêté à la fermeture)" : `Lancé par l'app : ${server.command}`) + " — clic : journaux"
    : "Journaux du serveur";

  const pageShown = !!page.url && page.url !== "about:blank" && !showLogs;
  $("welcome").hidden = !!project || pageShown;
  $("status").hidden = !project || pageShown;

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
    const title = st === "error" ? "Le serveur de dev n'a pas démarré"
      : st === "running" ? (showLogs ? "Journaux du serveur" : "Chargement de la page…")
      : st === "stopped" ? "Serveur arrêté"
      : st === "detecting" ? "Recherche d'un serveur déjà lancé…" : `Démarrage de ${project.name}…`;
    $("statusTitle").textContent = title;
    $("statusTitle").classList.toggle("still", st === "error" || st === "stopped" || showLogs);
    $("statusDetail").textContent = st === "error" ? server.error || "" : server.command ? "$ " + server.command : "";
    $("statusDetail").classList.toggle("error", st === "error");
    $("retry").hidden = st !== "error" && st !== "stopped";
    $("backToPage").hidden = !showLogs;
    const logs = $("logs");
    const atBottom = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 30;
    logs.textContent = (server.logs || []).join("\n");
    if (atBottom) logs.scrollTop = logs.scrollHeight;
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
$("addressForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("address").value.trim();
  if (v) app.do("navigate", v);
  $("address").blur();
};
$("address").addEventListener("keydown", (e) => { if (e.key === "Escape") { $("address").blur(); render(); } });
