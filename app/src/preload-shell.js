// Preload de la coquille (barre du haut, accueil) : API minimale vers le processus principal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("app", {
  onState: (f) => ipcRenderer.on("app:state", (_e, s) => f(s)),
  onFocusAddress: (f) => ipcRenderer.on("app:focus-address", () => f()),
  do: (action, arg) => ipcRenderer.invoke("app:do", action, arg),
});
