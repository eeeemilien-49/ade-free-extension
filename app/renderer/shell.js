// Coquille : barre du haut (projet, serveur, ouvrir dans Chrome) et volet du projet.
const $ = (id) => document.getElementById(id);
const home = (p) => p.replace(/^\/Users\/[^/]+/, "~");
const SERVER_LABEL = { detecting: "Recherche du serveur…", starting: "Démarrage…", error: "Erreur", stopped: "Arrêté" };
let state = null;

app.onState((s) => { state = s; render(); });
app.do("ready");

function render() {
  const { project, recents, server } = state;
  const st = server.status;
  $("projectName").textContent = project?.name || "Aucun projet";
  $("project").title = project ? home(project.dir) : "Ouvrir un projet";

  let host = "";
  try { host = new URL(server.url).host; } catch {}
  $("server").hidden = !project;
  $("server").dataset.status = st;
  $("serverText").textContent = st === "running" ? host + (server.external ? " · externe" : "") : SERVER_LABEL[st] || "—";
  $("server").title = st === "running"
    ? server.external ? "Serveur lancé hors de l'app : réutilisé, pas arrêté à la fermeture" : `Lancé par l'app : ${server.command}`
    : "";
  // Injecteur : calque posé dans l'onglet actif du navigateur (AppleScript).
  const inj = state.injector;
  $("injector").hidden = !inj;
  if (inj) {
    $("injector").dataset.status = inj.error ? "error" : inj.injected ? "active" : "idle";
    $("injectorText").textContent = inj.error ? "Calque bloqué" : inj.injected ? `${inj.browser} · ⌘ + clic actif` : inj.browser ? `${inj.browser} · en attente d'une page` : "En attente du navigateur";
    let host = "";
    try { host = new URL(inj.url).host; } catch {}
    $("injector").title = inj.injected && host ? `Calque actif sur ${host}` : "Passe sur Chrome, Arc ou Safari pour commenter";
  }
  $("injectorError").hidden = !inj?.error;
  $("injectorError").textContent = inj?.error || "";
  $("openChrome").hidden = !(project && st === "running" && server.url);

  $("welcome").hidden = !!project;
  $("status").hidden = !project;

  $("recents").innerHTML = "";
  for (const d of recents) {
    const b = document.createElement("button");
    b.innerHTML = "<span></span><small></small>";
    b.firstChild.textContent = d.split("/").pop();
    b.lastChild.textContent = home(d);
    b.onclick = () => app.do("open", d);
    const li = document.createElement("li");
    li.append(b);
    $("recents").append(li);
  }

  if (project) {
    $("statusTitle").textContent = st === "error" ? "Le serveur de dev n'a pas démarré"
      : st === "running" ? `${project.name} tourne sur ${host}`
      : st === "stopped" ? "Serveur arrêté"
      : st === "detecting" ? "Recherche d'un serveur déjà lancé…" : `Démarrage de ${project.name}…`;
    $("statusTitle").className = st === "starting" || st === "detecting" ? "shimmer" : "";
    $("statusDetail").textContent = st === "error" ? server.error || ""
      : st === "running" ? "Ouvre la page dans le navigateur et ⌘ + clic sur un élément pour le commenter."
      : server.command ? "$ " + server.command : "";
    $("statusDetail").classList.toggle("error", st === "error");
    $("retry").hidden = st !== "error" && st !== "stopped";
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
$("retry").onclick = () => app.do("restart");
$("openChrome").onclick = () => app.do("openUrl", state.server.url);
