// Preload de la page du projet : monde isolé (comme un content script Chrome).
// On y installe le shim `chrome` puis on exécute extension/comment.js sans le modifier,
// au moment où Chrome l'aurait injecté (document_idle).
const path = require("node:path");
const { createChrome } = require("./chrome-shim");

globalThis.chrome = createChrome();

const COMMENT_JS = path.join(__dirname, "..", "..", "extension", "comment.js");
function inject() {
  if (window.top !== window) return;
  try { require(COMMENT_JS); } catch (e) { console.error("[claude-bridge] comment.js :", e); }
}
if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", inject, { once: true });
else inject();
