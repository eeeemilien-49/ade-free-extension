// Côté processus principal du shim `chrome.*`.
// Fait tourner extension/background.js tel quel (dans un contexte vm) : la logique
// list/reply/resolve/launch/converseReply/seen/all/health… n'existe qu'une fois,
// partagée par l'extension Chrome et l'app.
// L'app n'a pas de navigateur : le ⌘+clic et les bulles restent dans Chrome (extension).
// Ici, aucun onglet n'est ouvert ; « aller sur une page » l'ouvre dans le navigateur.
const vm = require("node:vm");
const fs = require("node:fs");
const { ipcMain, webContents } = require("electron");

function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (f) => listeners.add(f),
    removeListener: (f) => listeners.delete(f),
    hasListener: (f) => listeners.has(f),
  };
}

function createChromeHost({ storeFile, backgroundFile, bridgeUrl, openInBrowser }) {
  // ---------- chrome.storage.local (fichier JSON de l'app) ----------
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

  // ---------- onglets : aucun dans l'app ----------
  // Un pseudo-onglet sans URL : le panneau désactive « Demander sur cette page » (la conversation
  // se lance depuis Chrome) et un clic sur un commentaire ouvre sa page dans le navigateur.
  const NO_TAB = { id: 1, windowId: 1, index: 0, active: true, url: "", title: "", status: "complete" };
  const noPage = () => Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
  const tabs = {
    query: async () => [NO_TAB],
    get: async () => NO_TAB,
    update: async (_id, props = {}) => { if (props.url) openInBrowser(props.url); return NO_TAB; },
    create: async (props = {}) => { if (/^https?:/.test(props.url || "")) openInBrowser(props.url); return NO_TAB; },
    sendMessage: noPage,
    captureVisibleTab: noPage,
    onUpdated: event(),
    onActivated: event(),
  };

  // ---------- service : background.js de l'extension ----------
  const onMessage = event();
  const chrome = {
    runtime: { id: "claude-code-bridge", onMessage },
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

  // ---------- IPC du panneau ----------
  ipcMain.handle("cc:runtime", (e, msg) => dispatch(msg, { url: e.sender.getURL() }));
  ipcMain.handle("cc:storage", (_e, op, arg) => (op === "get" ? storageGet(arg) : op === "set" ? storageSet(arg) : storageRemove(arg)));
  ipcMain.handle("cc:tabs", async (_e, op, ...args) => {
    if (typeof tabs[op] !== "function") throw new Error("chrome.tabs." + op + " non disponible");
    return tabs[op](...args);
  });

  // dispatch(msg, sender) : même entrée que chrome.runtime.sendMessage vers background.js
  // (list, create, reply, resolve, launch…), pour tout autre transport (ex. injector/).
  return { storageGet, storageSet, storageRemove, dispatch };
}

module.exports = { createChromeHost };
