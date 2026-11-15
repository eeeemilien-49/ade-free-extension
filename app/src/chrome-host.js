// Côté processus principal du shim `chrome.*`.
// Fait tourner extension/background.js tel quel (dans un contexte vm) : la logique
// list/create/reply/resolve/launch/converse/seen/all/health… n'existe qu'une fois,
// partagée par l'extension Chrome et l'app. Les API Chrome qu'il utilise sont
// fournies ici : stockage (fichier JSON), onglet unique = la WebContentsView de la
// page (preview), messages page ⇄ service (IPC), capture (webContents.capturePage).
// Chrome (extension) et la preview parlent au même bridge : mêmes commentaires des deux côtés.
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { ipcMain, nativeImage, webContents } = require("electron");

const TAB_ID = 1, WINDOW_ID = 1;

function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (f) => listeners.add(f),
    removeListener: (f) => listeners.delete(f),
    hasListener: (f) => listeners.has(f),
  };
}

function createChromeHost({ storeFile, backgroundFile, bridgeUrl, getPairing, getPage, getPageBounds, navigate }) {
  // ---------- chrome.storage.local ----------
  let store = {};
  try { store = JSON.parse(fs.readFileSync(storeFile, "utf8")); } catch {}
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFile(storeFile, JSON.stringify(store), () => {}), 150);
  };
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  const storageChanged = event();

  function storageGet(keys) {
    if (keys == null) return clone(store);
    if (typeof keys === "string") keys = [keys];
    const out = {};
    if (Array.isArray(keys)) { for (const k of keys) if (k in store) out[k] = clone(store[k]); }
    else for (const [k, def] of Object.entries(keys)) out[k] = k in store ? clone(store[k]) : def;
    return out;
  }
  function applyChanges(changes) {
    if (!Object.keys(changes).length) return;
    save();
    for (const l of storageChanged.listeners) try { l(changes, "local"); } catch (e) { console.error(e); }
    for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.send("cc:storage-changed", changes);
  }
  function storageSet(items) {
    const changes = {};
    for (const [k, v] of Object.entries(items || {})) {
      changes[k] = { oldValue: store[k], newValue: clone(v) };
      store[k] = clone(v);
    }
    applyChanges(changes);
  }
  function storageRemove(keys) {
    const changes = {};
    for (const k of [].concat(keys || [])) if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
    applyChanges(changes);
  }

  // ---------- onglet unique : la page ----------
  function tabInfo() {
    const wc = getPage();
    const url = wc && !wc.isDestroyed() ? wc.getURL() : "";
    return {
      id: TAB_ID, windowId: WINDOW_ID, index: 0, active: true, highlighted: true,
      url, title: url ? wc.getTitle() : "", status: wc?.isLoading() ? "loading" : "complete",
    };
  }

  // Messages vers la page (chrome.tabs.sendMessage) : le preload de la page répond par cc:reply.
  let nextReq = 1;
  const pending = new Map();
  function sendToPage(msg) {
    const wc = getPage();
    if (!wc || wc.isDestroyed() || !wc.getURL()) return Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
    const id = nextReq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("La page ne répond pas.")); }, 15000);
      pending.set(id, { wc, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      wc.send("cc:message", id, msg);
    });
  }
  ipcMain.on("cc:reply", (e, id, data) => {
    const p = pending.get(id);
    if (!p || p.wc !== e.sender) return;
    pending.delete(id);
    p.resolve(data);
  });

  async function captureVisibleTab() {
    const wc = getPage();
    if (!wc || wc.isDestroyed()) throw new Error("pas de page");
    return (await wc.capturePage()).toDataURL();
  }

  const tabs = {
    query: async () => [tabInfo()],
    get: async () => tabInfo(),
    update: async (_id, props = {}) => { if (props.url) navigate(props.url); return tabInfo(); },
    create: async (props = {}) => { if (/^https?:/.test(props.url || "")) navigate(props.url); return tabInfo(); },
    sendMessage: (_id, msg) => sendToPage(msg),
    captureVisibleTab,
    onUpdated: event(),
    onActivated: event(),
  };

  // ---------- service : background.js de l'extension ----------
  const onMessage = event();
  const chrome = {
    runtime: {
      id: "claude-code-bridge", onMessage,
      // Dans l'app, l'appairage est direct : port et token viennent du bridge lancé par l'app.
      sendNativeMessage: async (_host, msg) => (msg?.type === "hello" ? { ok: true, app: true, ...getPairing() } : { ok: true, app: true }),
    },
    storage: {
      local: {
        get: async (k) => storageGet(k),
        set: async (items) => storageSet(items),
        remove: async (k) => storageRemove(k),
      },
      onChanged: storageChanged,
    },
    tabs,
    windows: { update: async () => ({}) },
  };
  // L'URL du bridge est en dur dans background.js : on la redirige (port de test).
  const bridgeFetch = (url, opts) => fetch(String(url).replace("http://127.0.0.1:7823", bridgeUrl), opts);
  const ctx = vm.createContext({
    chrome, console, fetch: bridgeFetch, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    btoa, atob, TextEncoder, TextDecoder, structuredClone,
  });
  vm.runInContext(fs.readFileSync(backgroundFile, "utf8"), ctx, { filename: backgroundFile });
  // captureElement s'appuie sur OffscreenCanvas (absent de Node) : même rendu via capturePage.
  ctx.captureElement = captureElement;

  async function captureElement(_tab, rect) {
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    const wc = getPage();
    const view = getPageBounds();
    const pad = 40;
    const x = Math.max(0, Math.floor(rect.x - pad)), y = Math.max(0, Math.floor(rect.y - pad));
    const x2 = Math.min(view.width, Math.ceil(rect.x + rect.width + pad));
    const y2 = Math.min(view.height, Math.ceil(rect.y + rect.height + pad));
    if (x2 - x < 4 || y2 - y < 4) return null;
    const img = await wc.capturePage({ x, y, width: x2 - x, height: y2 - y });
    const size = img.getSize();
    const bmp = img.toBitmap(); // BGRA
    // Taille réelle du bitmap (pixels), puis échelle pixels / CSS (2 sur écran Retina).
    const k = Math.sqrt(bmp.length / 4 / (size.width * size.height)) || 1;
    const W = Math.round(size.width * k), H = Math.round(bmp.length / 4 / W);
    const s = W / (x2 - x);
    // Contour de l'élément (#c96442, 2 px logiques), comme l'extension.
    const t = Math.max(1, Math.round(2 * s));
    const rx = Math.round((rect.x - x) * s), ry = Math.round((rect.y - y) * s);
    const rw = Math.round(rect.width * s), rh = Math.round(rect.height * s);
    const px = (X, Y) => {
      if (X < 0 || Y < 0 || X >= W || Y >= H) return;
      const i = (Y * W + X) * 4;
      bmp[i] = 0x42; bmp[i + 1] = 0x64; bmp[i + 2] = 0xc9; bmp[i + 3] = 0xff;
    };
    for (let k = 0; k < t; k++) {
      for (let X = rx; X < rx + rw; X++) { px(X, ry + k); px(X, ry + rh - 1 - k); }
      for (let Y = ry; Y < ry + rh; Y++) { px(rx + k, Y); px(rx + rw - 1 - k, Y); }
    }
    const out = nativeImage.createFromBitmap(bmp, { width: W, height: H });
    return "data:image/png;base64," + out.toPNG().toString("base64");
  }

  function dispatch(msg, sender) {
    return new Promise((resolve) => {
      let done = false, isAsync = false;
      const send = (r) => { if (!done) { done = true; resolve(r); } };
      for (const l of onMessage.listeners) {
        try { if (l(msg, sender, send) === true) isAsync = true; } catch (e) { send({ error: e.message }); }
      }
      if (!isAsync) send(undefined);
    });
  }

  // ---------- IPC des renderers (page et panneau) ----------
  ipcMain.handle("cc:runtime", (e, msg) => {
    const fromPage = e.sender === getPage();
    return dispatch(msg, fromPage ? { tab: tabInfo(), frameId: 0, url: e.sender.getURL() } : { url: e.sender.getURL() });
  });
  ipcMain.handle("cc:storage", (_e, op, arg) => (op === "get" ? storageGet(arg) : op === "set" ? storageSet(arg) : storageRemove(arg)));
  ipcMain.handle("cc:tabs", async (_e, op, ...args) => {
    if (!(op in tabs) || typeof tabs[op] !== "function") throw new Error("chrome.tabs." + op + " non disponible");
    return tabs[op](...args);
  });

  // La page a changé (chargement terminé, navigation) : prévenir le panneau.
  function pageUpdated(info = { status: "complete" }) {
    const tab = tabInfo();
    for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && wc !== getPage()) wc.send("cc:tab-updated", TAB_ID, info, tab);
  }

  return { storageGet, storageSet, storageRemove, pageUpdated, dispatch };
}

module.exports = { createChromeHost };
