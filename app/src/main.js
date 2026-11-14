// Claude Code Bridge — app de bureau.
// Fenêtre = coquille (barre du haut, accueil) + panneau de gauche (extension/sidepanel.html)
// + page du projet (WebContentsView où l'on injecte extension/comment.js).
const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, shell: electronShell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { createChromeHost } = require("./chrome-host");
const { ensureBridge } = require("./bridge-process");
const { DevServer } = require("./dev-server");

const ROOT = path.join(__dirname, "..", "..");
const EXT = path.join(ROOT, "extension");
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 7823);
const TOP = 44, SIDE = 320;

app.setName("Claude Code Bridge");
if (process.env.CLAUDE_APP_DATA) app.setPath("userData", path.resolve(process.env.CLAUDE_APP_DATA));

// Lancée depuis le Finder, l'app n'a pas le PATH du terminal (bun, claude, node…).
try {
  const p = execFileSync(process.env.SHELL || "/bin/zsh", ["-lc", 'printf "%s" "$PATH"'], { timeout: 5000, encoding: "utf8" });
  if (p) process.env.PATH = [...new Set([...p.split(":"), ...(process.env.PATH || "").split(":")])].join(":");
} catch {}

let win, shellView, sidebarView, pageView, host, bridge;
let devServer = null;
const state = { project: null, recents: [], server: { status: "idle" }, page: {}, showLogs: false, bridge: {} };

// ---------- projets récents ----------
const projectsFile = () => path.join(app.getPath("userData"), "projects.json");
function loadRecents() {
  try { state.recents = JSON.parse(fs.readFileSync(projectsFile(), "utf8")).recents || []; } catch { state.recents = []; }
  state.recents = state.recents.filter((d) => fs.existsSync(d));
}
function saveRecents() {
  fs.writeFileSync(projectsFile(), JSON.stringify({ recents: state.recents }, null, 2));
}

// ---------- état → coquille ----------
function pushState() {
  if (!shellView || shellView.webContents.isDestroyed()) return;
  const wc = pageView.webContents;
  state.page = {
    url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
  };
  shellView.webContents.send("app:state", state);
  layout();
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  shellView.setBounds({ x: 0, y: 0, width, height });
  sidebarView.setBounds({ x: 0, y: TOP, width: SIDE, height: height - TOP });
  pageView.setBounds({ x: SIDE, y: TOP, width: width - SIDE, height: height - TOP });
  pageView.setVisible(!!pageView.webContents.getURL() && !state.showLogs);
}

function navigate(url) {
  if (!/^[a-z]+:/i.test(url)) url = (/^(localhost|127\.|\[::1\])/.test(url) ? "http://" : "https://") + url;
  state.showLogs = false;
  pageView.webContents.loadURL(url).catch(() => {});
  layout();
}

// ---------- projet ----------
async function openProject(dir) {
  dir = path.resolve(dir);
  if (!fs.existsSync(dir)) return;
  closeProject();
  state.project = { dir, name: path.basename(dir) };
  state.recents = [dir, ...state.recents.filter((d) => d !== dir)].slice(0, 12);
  saveRecents();
  app.addRecentDocument?.(dir);
  devServer = new DevServer(dir);
  devServer.on("change", (s) => {
    const wasRunning = state.server.status === "running";
    state.server = { ...s, logs: s.logs.slice(-200) };
    if (s.status === "running" && !wasRunning && s.url) {
      // Le dossier du projet pour cette origine : les commentaires de la page iront dans ce projet.
      const origin = new URL(s.url).origin;
      const { projects = {} } = host.storageGet("projects");
      if (projects[origin] !== dir) host.storageSet({ projects: { ...projects, [origin]: dir } });
      navigate(s.url);
    }
    pushState();
  });
  pushState();
  devServer.start();
}
function closeProject() {
  devServer?.stop();
  devServer?.removeAllListeners();
  devServer = null;
  state.project = null;
  state.server = { status: "idle" };
  state.showLogs = false;
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
      { label: state.showLogs ? "Revenir à la page" : "Journaux du serveur", click: () => { state.showLogs = !state.showLogs; pushState(); } },
      { label: "Afficher dans le Finder", click: () => electronShell.openPath(state.project.dir) },
      { label: "Fermer le projet", click: () => { closeProject(); pushState(); } },
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
  reload: () => pageView.webContents.reload(),
  stop: () => pageView.webContents.stop(),
  restart: () => state.project && openProject(state.project.dir),
  toggleLogs: () => { state.showLogs = !state.showLogs; pushState(); },
  ready: () => pushState(),
};

function buildMenu() {
  const page = () => pageView.webContents;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "Fichier", submenu: [
      { label: "Ouvrir un projet…", accelerator: "CmdOrCtrl+O", click: pickProject },
      { label: "Ouvrir l'adresse", accelerator: "CmdOrCtrl+L", click: () => { shellView.webContents.focus(); shellView.webContents.send("app:focus-address"); } },
      { type: "separator" }, { role: "close" },
    ] },
    { role: "editMenu" },
    { label: "Présentation", submenu: [
      { label: "Recharger la page", accelerator: "CmdOrCtrl+R", click: () => page().reload() },
      { label: "Recharger sans cache", accelerator: "CmdOrCtrl+Shift+R", click: () => page().reloadIgnoringCache() },
      { label: "Précédent", accelerator: "CmdOrCtrl+[", click: () => page().navigationHistory.goBack() },
      { label: "Suivant", accelerator: "CmdOrCtrl+]", click: () => page().navigationHistory.goForward() },
      { type: "separator" },
      { label: "Zoom avant", accelerator: "CmdOrCtrl+Plus", click: () => page().setZoomLevel(page().getZoomLevel() + 0.5) },
      { label: "Zoom arrière", accelerator: "CmdOrCtrl+-", click: () => page().setZoomLevel(page().getZoomLevel() - 0.5) },
      { label: "Taille réelle", accelerator: "CmdOrCtrl+0", click: () => page().setZoomLevel(0) },
      { type: "separator" },
      { label: "Outils de développement (page)", accelerator: "Alt+CmdOrCtrl+I", click: () => page().toggleDevTools() },
      { label: "Outils de développement (panneau)", accelerator: "Alt+CmdOrCtrl+J", click: () => sidebarView.webContents.toggleDevTools() },
      { label: "Outils de développement (coquille)", click: () => shellView.webContents.toggleDevTools() },
    ] },
    { role: "windowMenu" },
  ]));
}

// ---------- démarrage ----------
async function main() {
  await app.whenReady();
  loadRecents();
  buildMenu();

  bridge = await ensureBridge({ port: PORT });
  state.bridge = { url: bridge.url, own: !!bridge.child, ok: !!bridge.token };

  win = new BaseWindow({
    width: 1440, height: 920, minWidth: 820, minHeight: 500,
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: "#ffffff", title: "Claude Code Bridge",
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
    getPage: () => pageView.webContents,
    getPageBounds: () => pageView.getBounds(),
    navigate,
  });
  // Le token vient du bridge (~/.claude-chrome-bridge/token) : rien à coller à la main.
  if (bridge.token) host.storageSet({ token: bridge.token });

  const pwc = pageView.webContents;
  pwc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) navigate(url);
    return { action: "deny" };
  });
  for (const ev of ["did-start-loading", "did-stop-loading", "page-title-updated", "did-navigate"]) pwc.on(ev, pushState);
  pwc.on("did-finish-load", () => host.pageUpdated({ status: "complete" }));
  pwc.on("did-navigate-in-page", () => { host.pageUpdated({ status: "complete" }); pushState(); });
  pwc.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) console.log(`[page] échec de chargement ${url} : ${desc}`);
  });
  pwc.on("console-message", (e) => { if (e.level === "error" || /claude-bridge/.test(e.message)) console.log(`[page] ${e.message}`); });
  sidebarView.webContents.on("console-message", (e) => { if (e.level === "error") console.log(`[panneau] ${e.message}`); });

  shellView.webContents.loadFile(path.join(__dirname, "..", "renderer", "shell.html"));
  sidebarView.webContents.loadFile(path.join(EXT, "sidepanel.html"));
  win.on("resize", layout);
  win.on("closed", () => app.quit());
  layout();

  const initial = process.env.CLAUDE_APP_OPEN || process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith("-"));
  if (initial) openProject(initial.replace(/^~/, app.getPath("home")));
}

ipcMain.handle("app:do", (_e, action, arg) => actions[action]?.(arg));

// Fermeture : on arrête le serveur de dev qu'on a lancé, et le bridge s'il est à nous.
function cleanup() {
  devServer?.stop();
  try { bridge?.child?.kill("SIGTERM"); } catch {}
}
app.on("before-quit", cleanup);
app.on("window-all-closed", () => app.quit());
process.on("SIGINT", () => { cleanup(); app.quit(); });
process.on("SIGTERM", () => { cleanup(); app.quit(); });

main().catch((e) => { console.error(e); dialog.showErrorBox("Claude Code Bridge", String(e?.stack || e)); app.quit(); });
