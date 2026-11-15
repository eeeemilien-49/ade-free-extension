// Claude Code Bridge — app de bureau.
// Fenêtre = coquille (barre du haut, accueil, guide d'installation) + panneau de gauche
// (extension/sidepanel.html) + preview du projet (WebContentsView où l'on injecte extension/comment.js).
// L'app lance le bridge et installe l'hôte natif : l'extension Chrome s'appaire toute seule
// et voit les mêmes commentaires que la preview.
const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, nativeTheme, shell: electronShell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, execFile } = require("node:child_process");
const { createChromeHost } = require("./chrome-host");
const { ensureBridge } = require("./bridge-process");
const { DevServer } = require("./dev-server");
const { SimServer, isXcodeProject } = require("./sim-server");
const { installNativeHost, writeAppInfo, extensionSeen } = require("./native-install");

const ROOT = path.join(__dirname, "..", "..");
const EXT = path.join(ROOT, "extension");
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 7823);
const TOP = 44, SIDE = 300;
const PROTOCOL = "claude-bridge";

app.setName("Claude Code Bridge");
if (process.env.CLAUDE_APP_DATA) app.setPath("userData", path.resolve(process.env.CLAUDE_APP_DATA));
if (!app.requestSingleInstanceLock()) app.quit();

// Lancée depuis le Finder, l'app n'a pas le PATH du terminal (bun, claude, node…).
try {
  const p = execFileSync(process.env.SHELL || "/bin/zsh", ["-lc", 'printf "%s" "$PATH"'], { timeout: 5000, encoding: "utf8" });
  if (p) process.env.PATH = [...new Set([...p.split(":"), ...(process.env.PATH || "").split(":")])].join(":");
} catch {}

let win, shellView, sidebarView, pageView, host, bridge;
let devServer = null;
// view : "page" (preview) | "logs" (journaux du serveur) | "install" (guide de l'extension)
const state = { project: null, recents: [], server: { status: "idle" }, page: {}, view: "page", bridge: {}, extension: null, chrome: null, sidebar: true, theme: "system" };
let pageError = null; // dernier échec de chargement de la page principale (null si la page s'est chargée)

// ---------- projets récents ----------
const projectsFile = () => path.join(app.getPath("userData"), "projects.json");
function loadRecents() {
  try { state.recents = JSON.parse(fs.readFileSync(projectsFile(), "utf8")).recents || []; } catch { state.recents = []; }
  state.recents = state.recents.filter((d) => fs.existsSync(d));
}
function saveRecents() {
  fs.writeFileSync(projectsFile(), JSON.stringify({ recents: state.recents }, null, 2));
}

// ---------- préférences d'affichage (panneau, apparence) ----------
const prefsFile = () => path.join(app.getPath("userData"), "prefs.json");
function loadPrefs() {
  try { Object.assign(state, pick(JSON.parse(fs.readFileSync(prefsFile(), "utf8")))); } catch {}
  nativeTheme.themeSource = state.theme;
}
const pick = ({ sidebar, theme }) => ({ ...(typeof sidebar === "boolean" && { sidebar }), ...(["system", "light", "dark"].includes(theme) && { theme }) });
function savePrefs() {
  try { fs.writeFileSync(prefsFile(), JSON.stringify(pick(state), null, 2)); } catch {}
}
function setSidebar(on) {
  state.sidebar = on;
  savePrefs();
  buildMenu();
  pushState();
}
function setTheme(theme) {
  state.theme = theme;
  nativeTheme.themeSource = theme;
  savePrefs();
  buildMenu();
  pushState();
}
// Commandes envoyées au panneau (extension/sidepanel.js écoute « panel:command »).
function panelCommand(cmd) {
  if (!state.sidebar) setSidebar(true);
  sidebarView.webContents.focus();
  sidebarView.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent("panel:command", { detail: ${JSON.stringify(cmd)} }))`).catch(() => {});
}

// ---------- état → coquille ----------
function pushState() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  const wc = pageView.webContents;
  const url = wc.getURL();
  state.page = {
    url: url === "about:blank" ? "" : url, title: wc.getTitle(), loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
    error: pageError,
  };
  shellView.webContents.send("app:state", state);
  layout();
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const side = state.sidebar ? SIDE : 0;
  shellView.setBounds({ x: 0, y: 0, width, height });
  sidebarView.setVisible(state.sidebar);
  sidebarView.setBounds({ x: 0, y: TOP, width: SIDE, height: height - TOP });
  pageView.setBounds({ x: side, y: TOP, width: width - side, height: height - TOP });
  pageView.setVisible(!!state.page.url && !state.page.error && state.view === "page");
}
function setView(v) { state.view = v; pushState(); }
function reloadPage(ignoreCache) {
  if (pageError) return navigate(pageError.url);
  const wc = pageView.webContents;
  ignoreCache === true ? wc.reloadIgnoringCache() : wc.reload();
}

function navigate(url) {
  // « localhost:3000 » n'est pas un schéma : on n'accepte tel quel que « xxx:// ».
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = (/^(localhost|127\.|\[::1\])/.test(url) ? "http://" : "https://") + url;
  if (!/^https?:/.test(url)) return;
  state.view = "page";
  pageError = null;
  pageView.webContents.loadURL(url).catch(() => {});
  layout();
}

// ---------- Chrome ----------
// Le navigateur où ouvrir les pages : Chrome s'il est installé, sinon le navigateur par défaut.
function findChrome() {
  for (const name of ["Google Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Chromium"]) {
    for (const dir of ["/Applications", path.join(app.getPath("home"), "Applications")]) {
      if (fs.existsSync(path.join(dir, name + ".app"))) return name;
    }
  }
  return null;
}
function openInChrome(url) {
  url = String(url || "");
  if (!/^(https?|chrome):/.test(url)) return;
  if (!state.chrome) return void electronShell.openExternal(url);
  execFile("open", ["-a", state.chrome, url], (err) => { if (err && /^https?:/.test(url)) electronShell.openExternal(url); });
}

// Extension : connectée si l'hôte natif a été appelé par elle (trace laissée sur le disque).
function refreshExtension() {
  const seen = extensionSeen();
  const next = seen ? { seenAt: seen.seenAt } : null;
  if (JSON.stringify(next) === JSON.stringify(state.extension)) return;
  const first = !state.extension && next;
  state.extension = next;
  if (first && state.view === "install") state.view = "page";
  pushState();
}

// ---------- projet ----------
async function openProject(dir) {
  dir = path.resolve(dir);
  if (!fs.existsSync(dir)) return;
  closeProject();
  state.project = { dir, name: path.basename(dir) };
  buildMenu();
  state.recents = [dir, ...state.recents.filter((d) => d !== dir)].slice(0, 12);
  saveRecents();
  app.addRecentDocument?.(dir);
  // Projet iOS (Xcode) : miroir du simulateur commentable, à la place d'un serveur de dev.
  devServer = isXcodeProject(dir) ? new SimServer(dir) : new DevServer(dir);
  devServer.on("change", (s) => {
    const wasRunning = state.server.status === "running";
    state.server = { ...s, logs: s.logs.slice(-200) };
    // Le serveur s'arrête alors que la page était affichée : on montre pourquoi plutôt qu'une page morte.
    if (wasRunning && (s.status === "error" || s.status === "stopped") && state.view === "page") state.view = "logs";
    if (s.status === "running" && !wasRunning && s.url) {
      // Le dossier du projet pour cette origine : les commentaires de la page iront dans ce projet.
      const origin = new URL(s.url).origin;
      const { projects = {} } = host.storageGet("projects");
      if (projects[origin] !== dir) host.storageSet({ projects: { ...projects, [origin]: dir } });
      navigate(s.url);
    }
    pushState();
  });
  if (state.view === "logs") state.view = "page";
  pushState();
  devServer.start();
}
function closeProject() {
  devServer?.stop();
  devServer?.removeAllListeners();
  devServer = null;
  state.project = null;
  state.server = { status: "idle" };
  pageError = null;
  if (state.view === "logs") state.view = "page";
  if (pageView.webContents.getURL()) pageView.webContents.loadURL("about:blank").then(() => pageView.webContents.navigationHistory.clear());
}
async function pickProject() {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Ouvrir un projet", buttonLabel: "Ouvrir" });
  if (!r.canceled && r.filePaths[0]) openProject(r.filePaths[0]);
}

function projectMenu() {
  const items = state.recents.map((d) => ({
    label: path.basename(d), sublabel: d.replace(app.getPath("home"), "~"),
    type: "checkbox", checked: state.project?.dir === d, click: () => openProject(d),
  }));
  return Menu.buildFromTemplate([
    ...(items.length ? [{ label: "Récents", enabled: false }, ...items, { type: "separator" }] : []),
    { label: "Ouvrir un dossier…", accelerator: "CmdOrCtrl+O", click: pickProject },
    ...(state.project ? [
      { type: "separator" },
      { label: "Redémarrer le serveur de dev", click: () => openProject(state.project.dir) },
      { label: state.view === "logs" ? "Revenir à la page" : "Journaux du serveur", click: () => setView(state.view === "logs" ? "page" : "logs") },
      { label: "Afficher dans le Finder", click: () => electronShell.openPath(state.project.dir) },
      { label: "Fermer le projet", click: () => { closeProject(); buildMenu(); pushState(); } },
    ] : []),
    ...(state.recents.length ? [{ type: "separator" }, { label: "Vider les récents", click: () => { state.recents = state.project ? [state.project.dir] : []; saveRecents(); pushState(); } }] : []),
  ]);
}

// ---------- actions de la coquille ----------
const actions = {
  pick: pickProject,
  open: (dir) => openProject(dir),
  projectMenu: ({ x, y }) => projectMenu().popup({ window: win, x: Math.round(x), y: Math.round(y) }),
  navigate: (url) => navigate(String(url || "").trim()),
  back: () => pageView.webContents.navigationHistory.goBack(),
  forward: () => pageView.webContents.navigationHistory.goForward(),
  reload: reloadPage,
  toggleSidebar: () => setSidebar(!state.sidebar),
  theme: (t) => ["system", "light", "dark"].includes(t) && setTheme(t),
  focusPanel: () => panelCommand("focus"),
  restart: () => state.project && openProject(state.project.dir),
  toggleLogs: () => setView(state.view === "logs" ? "page" : "logs"),
  openInChrome: () => openInChrome(state.page.url || state.server.url),
  // Guide d'installation de l'extension (en attendant le Chrome Web Store).
  install: () => setView(state.view === "install" ? "page" : "install"),
  openExtensionsPage: () => openInChrome("chrome://extensions"),
  revealExtension: () => electronShell.showItemInFolder(path.join(EXT, "manifest.json")),
  ready: () => pushState(),
};

function buildMenu() {
  const page = () => pageView.webContents;
  const theme = (label, value) => ({ label, type: "radio", checked: state.theme === value, click: () => setTheme(value) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: "about", label: `À propos de ${app.name}` },
      { type: "separator" },
      { label: "Réglages…", accelerator: "CmdOrCtrl+,", click: () => panelCommand("settings") },
      { type: "separator" },
      { role: "services", label: "Services" },
      { type: "separator" },
      { role: "hide", label: `Masquer ${app.name}` }, { role: "hideOthers", label: "Masquer les autres" }, { role: "unhide", label: "Tout afficher" },
      { type: "separator" },
      { role: "quit", label: `Quitter ${app.name}` },
    ] },
    { label: "Fichier", submenu: [
      { label: "Ouvrir un projet…", accelerator: "CmdOrCtrl+O", click: pickProject },
      { label: "Ouvrir l'adresse", accelerator: "CmdOrCtrl+L", click: () => { shellView.webContents.focus(); shellView.webContents.send("app:focus-address"); } },
      { label: "Ouvrir dans Chrome", accelerator: "CmdOrCtrl+Shift+O", click: actions.openInChrome },
      { type: "separator" },
      { label: "Redémarrer le serveur de dev", enabled: !!state.project, click: actions.restart },
      { label: "Journaux du serveur", accelerator: "Alt+CmdOrCtrl+L", enabled: !!state.project, click: actions.toggleLogs },
      { type: "separator" },
      { label: "Installer l'extension Chrome…", click: () => setView("install") },
      { type: "separator" }, { role: "close", label: "Fermer la fenêtre" },
    ] },
    { role: "editMenu", label: "Édition" },
    { label: "Présentation", submenu: [
      { label: "Panneau", type: "checkbox", checked: state.sidebar, accelerator: "CmdOrCtrl+\\", click: actions.toggleSidebar },
      { label: "Commentaires", accelerator: "CmdOrCtrl+1", click: () => panelCommand("comments") },
      { label: "Historique", accelerator: "CmdOrCtrl+Y", click: () => panelCommand("history") },
      { label: "Demander à Claude", accelerator: "CmdOrCtrl+K", click: () => panelCommand("prompt") },
      { type: "separator" },
      { label: "Recharger la page", accelerator: "CmdOrCtrl+R", click: () => reloadPage() },
      { label: "Recharger sans cache", accelerator: "CmdOrCtrl+Shift+R", click: () => reloadPage(true) },
      { label: "Précédent", accelerator: "CmdOrCtrl+[", click: () => page().navigationHistory.goBack() },
      { label: "Suivant", accelerator: "CmdOrCtrl+]", click: () => page().navigationHistory.goForward() },
      { type: "separator" },
      { label: "Zoom avant", accelerator: "CmdOrCtrl+Plus", click: () => page().setZoomLevel(page().getZoomLevel() + 0.5) },
      { label: "Zoom arrière", accelerator: "CmdOrCtrl+-", click: () => page().setZoomLevel(page().getZoomLevel() - 0.5) },
      { label: "Taille réelle", accelerator: "CmdOrCtrl+0", click: () => page().setZoomLevel(0) },
      { type: "separator" },
      { label: "Apparence", submenu: [theme("Système", "system"), theme("Clair", "light"), theme("Sombre", "dark")] },
      { type: "separator" },
      { label: "Développement", submenu: [
        { label: "Recharger le panneau", click: () => sidebarView.webContents.reload() },
        { label: "Outils de développement (page)", accelerator: "Alt+CmdOrCtrl+I", click: () => page().toggleDevTools() },
        { label: "Outils de développement (panneau)", accelerator: "Alt+CmdOrCtrl+J", click: () => sidebarView.webContents.toggleDevTools() },
        { label: "Outils de développement (coquille)", click: () => shellView.webContents.toggleDevTools() },
      ] },
    ] },
    { role: "windowMenu", label: "Fenêtre" },
  ]));
}

// Lien claude-bridge:// (app empaquetée) : claude-bridge://open?project=/chemin ou claude-bridge://open?url=…
function handleLink(link) {
  try {
    const u = new URL(link);
    const project = u.searchParams.get("project"), url = u.searchParams.get("url");
    if (project) openProject(project);
    else if (url) navigate(url);
    win?.show();
  } catch {}
}

// ---------- démarrage ----------
async function main() {
  await app.whenReady();
  loadRecents();
  loadPrefs();
  buildMenu();
  state.chrome = findChrome();

  bridge = await ensureBridge({ port: PORT });
  state.bridge = { url: bridge.url, own: !!bridge.child, ok: !!bridge.token };

  // Appairage avec l'extension : hôte natif + infos pour la rouvrir.
  try {
    const { installed } = installNativeHost();
    console.log("[extension] hôte natif installé pour : " + (installed.join(", ") || "aucun navigateur trouvé"));
  } catch (e) { console.error("[extension] hôte natif :", e.message); }
  writeAppInfo({
    port: PORT, pid: process.pid,
    launch: app.isPackaged
      ? { cmd: "/usr/bin/open", args: ["-a", process.execPath.replace(/\/Contents\/MacOS\/.*$/, "")] }
      : { cmd: process.execPath, args: [path.join(__dirname, "..")], cwd: path.join(__dirname, "..") },
  });
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  refreshExtension();
  setInterval(refreshExtension, 2000);

  win = new BaseWindow({
    width: 1440, height: 920, minWidth: 820, minHeight: 500,
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff", title: "Claude Code Bridge",
  });

  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload-shell.js") } });
  sidebarView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "preload-sidebar.js"), contextIsolation: false, sandbox: false, nodeIntegration: false },
  });
  pageView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "preload-page.js"), contextIsolation: true, sandbox: false, nodeIntegration: false, partition: "persist:pages" },
  });
  win.contentView.addChildView(shellView);
  win.contentView.addChildView(sidebarView);
  win.contentView.addChildView(pageView);

  host = createChromeHost({
    storeFile: path.join(app.getPath("userData"), "storage.json"),
    backgroundFile: path.join(EXT, "background.js"),
    bridgeUrl: bridge.url,
    getPairing: () => ({ port: PORT, token: bridge.token }),
    getPage: () => pageView.webContents,
    getPageBounds: () => pageView.getBounds(),
    navigate,
  });
  // Le token et le port viennent du bridge : rien à coller à la main.
  if (bridge.token) host.storageSet({ token: bridge.token, port: PORT });

  const pwc = pageView.webContents;
  pwc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) navigate(url);
    return { action: "deny" };
  });
  for (const ev of ["did-start-loading", "did-stop-loading", "page-title-updated", "did-navigate"]) pwc.on(ev, pushState);
  pwc.on("did-finish-load", () => host.pageUpdated({ status: "complete" }));
  pwc.on("did-navigate-in-page", () => { host.pageUpdated({ status: "complete" }); pushState(); });
  pwc.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 : navigation interrompue par une autre
    console.log(`[page] échec de chargement ${url} : ${desc}`);
    pageError = { code, desc, url };
    pushState();
  });
  pwc.on("did-navigate", (_e, _url, status) => { if (status) pageError = null; });
  pwc.on("console-message", (e) => { if (e.level === "error" || /claude-bridge/.test(e.message)) console.log(`[page] ${e.message}`); });
  sidebarView.webContents.on("console-message", (e) => { if (e.level === "error") console.log(`[panneau] ${e.message}`); });

  shellView.webContents.loadFile(path.join(__dirname, "..", "renderer", "shell.html"));
  sidebarView.webContents.loadFile(path.join(EXT, "sidepanel.html"));
  win.on("resize", layout);
  nativeTheme.on("updated", () => { win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff"); pushState(); });
  win.on("closed", () => app.quit());
  layout();

  const initial = process.env.CLAUDE_APP_OPEN || process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith("-") && !a.startsWith(PROTOCOL + ":"));
  if (initial) openProject(initial.replace(/^~/, app.getPath("home")));
  const link = process.argv.find((a) => a.startsWith(PROTOCOL + ":"));
  if (link) handleLink(link);
}

// Certaines actions renvoient des objets Electron (BrowserWindow, process…) que l'IPC ne sait pas
// cloner : on ne renvoie au rendu que des données simples.
ipcMain.handle("app:do", async (_e, action, arg) => {
  const result = await actions[action]?.(arg);
  try { return structuredClone(result); } catch { return undefined; }
});
app.on("open-url", (e, url) => { e.preventDefault(); if (win) handleLink(url); });
app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(PROTOCOL + ":"));
  if (link) handleLink(link);
  win?.show(); win?.focus();
});

// Fermeture : on arrête le serveur de dev qu'on a lancé, et le bridge s'il est à nous.
function cleanup() {
  devServer?.stop();
  try { writeAppInfo({ pid: null }); } catch {}
  try { bridge?.child?.kill("SIGTERM"); } catch {}
}
app.on("before-quit", cleanup);
app.on("window-all-closed", () => app.quit());
process.on("SIGINT", () => { cleanup(); app.quit(); });
process.on("SIGTERM", () => { cleanup(); app.quit(); });

main().catch((e) => { console.error(e); dialog.showErrorBox("Claude Code Bridge", String(e?.stack || e)); app.quit(); });
