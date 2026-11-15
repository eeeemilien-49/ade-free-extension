// Bridge intégré : réutilise celui qui écoute déjà sur le port, sinon lance
// bridge/server.mjs (inchangé) comme processus enfant avec le Node d'Electron.
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SERVER = path.join(__dirname, "..", "..", "bridge", "server.mjs");

function isListening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

async function ensureBridge({ port, log = console.log }) {
  const dir = process.env.CLAUDE_BRIDGE_DIR || path.join(os.homedir(), ".claude-chrome-bridge");
  let child = null;
  if (!(await isListening(port))) {
    log(`[bridge] rien sur 127.0.0.1:${port} : lancement de ${SERVER}`);
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CLAUDE_BRIDGE_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const relay = (chunk) => String(chunk).split("\n").filter(Boolean)
      .forEach((l) => log("[bridge] " + l.replace(/(Token[^:]*: ).*/, "$1***")));
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("exit", (code) => log(`[bridge] arrêté (code ${code})`));
    for (let i = 0; i < 50 && !(await isListening(port)); i++) await new Promise((r) => setTimeout(r, 100));
  } else {
    log(`[bridge] déjà actif sur 127.0.0.1:${port} : réutilisé`);
  }
  let token = "";
  try { token = fs.readFileSync(path.join(dir, "token"), "utf8").trim(); } catch {}
  return { url: `http://127.0.0.1:${port}`, token, child };
}

module.exports = { ensureBridge, isListening };
