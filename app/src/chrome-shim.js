// Côté renderer du shim `chrome.*` (page et panneau de gauche) : chaque appel
// part en IPC vers chrome-host.js, qui fait tourner background.js.
const { ipcRenderer } = require("electron");

function event() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (f) => listeners.add(f),
    removeListener: (f) => listeners.delete(f),
    hasListener: (f) => listeners.has(f),
  };
}
const fire = (ev, ...args) => { for (const l of ev.listeners) try { l(...args); } catch (e) { console.error(e); } };

function createChrome() {
  const onMessage = event(), onChanged = event(), onUpdated = event(), onActivated = event();

  // chrome.tabs.sendMessage reçu : même contrat que Chrome (return true = réponse asynchrone).
  ipcRenderer.on("cc:message", (_e, id, msg) => {
    let answered = false, isAsync = false;
    const sendResponse = (data) => { if (!answered) { answered = true; ipcRenderer.send("cc:reply", id, data); } };
    for (const l of onMessage.listeners) {
      try { if (l(msg, { id: "claude-code-bridge" }, sendResponse) === true) isAsync = true; } catch (e) { console.error(e); }
    }
    if (!isAsync) sendResponse(undefined);
  });
  ipcRenderer.on("cc:storage-changed", (_e, changes) => fire(onChanged, changes, "local"));
  ipcRenderer.on("cc:tab-updated", (_e, id, info, tab) => fire(onUpdated, id, info, tab));

  const tabs = (op) => (...args) => ipcRenderer.invoke("cc:tabs", op, ...args);
  return {
    runtime: { id: "claude-code-bridge", sendMessage: (msg) => ipcRenderer.invoke("cc:runtime", msg), onMessage },
    storage: {
      local: {
        get: (keys) => ipcRenderer.invoke("cc:storage", "get", keys),
        set: (items) => ipcRenderer.invoke("cc:storage", "set", items),
        remove: (keys) => ipcRenderer.invoke("cc:storage", "remove", keys),
      },
      onChanged,
    },
    tabs: {
      query: tabs("query"), get: tabs("get"), update: tabs("update"), create: tabs("create"),
      sendMessage: tabs("sendMessage"), onUpdated, onActivated,
    },
    windows: { update: async () => ({}) },
    // Le panneau est toujours à gauche dans l'app : le lien vers les réglages de Chrome est masqué.
    sidePanel: { getLayout: async () => ({ side: "left" }), setPanelBehavior: async () => {} },
  };
}

module.exports = { createChrome };
