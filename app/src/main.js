// Claude Code Bridge — app de bureau.
// Tableau de bord : le ⌘+clic et les bulles se font dans le vrai navigateur, où l'app injecte
// le calque (injector/, via AppleScript, sans extension) ; l'app montre
// l'arbre projets › pages › conversations › commentaires (extension/sidepanel.html) et gère
// les projets (serveur de dev). Pas de navigateur intégré.
const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, shell: electronShell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const { execFileSync, execFile } = require("node:child_process");
const { createChromeHost } = require("./chrome-host");
const { ensureBridge } = require("./bridge-process");
const { DevServer } = require("./dev-server");

const ROOT = path.join(__dirname, "..", "..");
const EXT = path.join(ROOT, "extension");
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 7823);
const TOP = 44, SIDE = 360;

app.setName("Claude Code Bridge");
if (process.env.CLAUDE_APP_DATA) app.setPath("userData", path.resolve(process.env.CLAUDE_APP_DATA));

// Lancée depuis le Finder, l'app n'a pas le PATH du terminal (bun, claude, node…).
try {
  const p = execFileSync(process.env.SHELL || "/bin/zsh", ["-lc", 'printf "%s" "$PATH"'], { timeout: 5000, encoding: "utf8" });
  if (p) process.env.PATH = [...new Set([...p.split(":"), ...(process.env.PATH || "").split(":")])].join(":");
} catch {}

let win, shellView, sidebarView, host, bridge, injector = null;
let devServer = null;
const state = { project: null, recents: [], server: { status: "idle" }, bridge: {}, injector: null };

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
  shellView.webContents.send("app:state", state);
  layout();
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  shellView.setBounds({ x: 0, y: 0, width, height });
  sidebarView.setBounds({ x: 0, y: TOP, width: SIDE, height: height - TOP });
}

// Les pages se regardent et se commentent dans le vrai navigateur : celui où l'injecteur
// a vu l'utilisateur en dernier, sinon Chrome.
function openInBrowser(url) {
  if (!/^https?:/.test(url)) return;
  const browser = injector?.state.browser || "Google Chrome";
  execFile("open", ["-a", browser, url], (err) => { if (err) electronShell.openExternal(url); });
}

// Injecteur : calque comment.js dans l'onglet actif du navigateur, relayé vers le bridge
// (bridgeDispatch garde les garde-fous : URL imposée, lecture seule hors local, actions limitées à la page).
async function startInjector() {
  if (process.platform !== "darwin" || process.env.CLAUDE_APP_NO_INJECTOR) return;
  const { createInjector, bridgeDispatch } = await import(pathToFileURL(path.join(ROOT, "injector", "inject.mjs")).href);
  injector = createInjector({ dispatch: bridgeDispatch(), log: (l) => console.log("[injecteur] " + l) });
  injector.start();
  let last = "";
  setInterval(() => {
    const s = JSON.stringify(injector.state);
    if (s !== last) { last = s; state.injector = { ...injector.state }; pushState(); }
  }, 700);
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
    state.server = { ...s, logs: s.logs.slice(-200) };
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
      ...(state.server.url ? [{ label: "Ouvrir dans le navigateur", click: () => openInBrowser(state.server.url) }] : []),
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
  openUrl: (url) => openInBrowser(String(url || "")),
  restart: () => state.project && openProject(state.project.dir),
  ready: () => pushState(),
};

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "Fichier", submenu: [
      { label: "Ouvrir un projet…", accelerator: "CmdOrCtrl+O", click: pickProject },
      { type: "separator" }, { role: "close" },
    ] },
    { role: "editMenu" },
    { label: "Présentation", submenu: [
      { label: "Recharger le panneau", accelerator: "CmdOrCtrl+R", click: () => sidebarView.webContents.reload() },
      { type: "separator" },
      { label: "Outils de développement (panneau)", accelerator: "Alt+CmdOrCtrl+I", click: () => sidebarView.webContents.toggleDevTools() },
      { label: "Outils de développement (coquille)", accelerator: "Alt+CmdOrCtrl+J", click: () => shellView.webContents.toggleDevTools() },
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
  startInjector().catch((e) => console.error("[injecteur]", e));

  win = new BaseWindow({
    width: 1440, height: 920, minWidth: 820, minHeight: 500,
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: "#ffffff", title: "Claude Code Bridge",
  });

  shellView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload-shell.js") } });
  sidebarView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "preload-sidebar.js"), contextIsolation: false, sandbox: false, nodeIntegration: false },
  });
  win.contentView.addChildView(shellView);
  win.contentView.addChildView(sidebarView);

  host = createChromeHost({
    storeFile: path.join(app.getPath("userData"), "storage.json"),
    backgroundFile: path.join(EXT, "background.js"),
    bridgeUrl: bridge.url,
    openInBrowser,
  });
  // Le token vient du bridge (~/.claude-chrome-bridge/token) : rien à coller à la main.
  if (bridge.token) host.storageSet({ token: bridge.token });

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
  injector?.stop();
  devServer?.stop();
  try { bridge?.child?.kill("SIGTERM"); } catch {}
}
app.on("before-quit", cleanup);
app.on("window-all-closed", () => app.quit());
process.on("SIGINT", () => { cleanup(); app.quit(); });
process.on("SIGTERM", () => { cleanup(); app.quit(); });

main().catch((e) => { console.error(e); dialog.showErrorBox("Claude Code Bridge", String(e?.stack || e)); app.quit(); });
