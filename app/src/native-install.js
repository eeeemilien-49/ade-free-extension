// Installation de l'hôte natif : appelée à chaque démarrage de l'app (idempotent).
// - un lanceur shell (~/.claude-chrome-bridge/native-host) qui exécute native-host.js avec le Node d'Electron ;
// - le manifeste com.claude.code_bridge.json dans le dossier NativeMessagingHosts de chaque
//   navigateur Chromium présent (Chrome, Arc, Brave, Edge, Chromium…), autorisant l'ID fixe de l'extension ;
// - app.json : port du bridge, PID de l'app et commande pour la rouvrir.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOST_NAME = "com.claude.code_bridge";
// ID dérivé de la clé publique `key` de extension/manifest.json (stable en mode développeur).
const EXTENSION_ID = "ihbpnieleoceojjdkdbcndheonfmljme";

const BROWSERS = [
  ["Chrome", "Google/Chrome"], ["Chrome Beta", "Google/Chrome Beta"], ["Chrome Canary", "Google/Chrome Canary"],
  ["Chromium", "Chromium"], ["Arc", "Arc/User Data"], ["Brave", "BraveSoftware/Brave-Browser"],
  ["Edge", "Microsoft Edge"], ["Vivaldi", "Vivaldi"],
];

function bridgeDir() {
  return process.env.CLAUDE_BRIDGE_DIR || path.join(os.homedir(), ".claude-chrome-bridge");
}

function installNativeHost({ home = os.homedir(), electron = process.execPath } = {}) {
  const dir = bridgeDir();
  fs.mkdirSync(dir, { recursive: true });
  const launcher = path.join(dir, "native-host");
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(launcher, [
    "#!/bin/sh",
    "# Généré par l'app Claude Code Bridge : hôte natif de l'extension Chrome.",
    `export CLAUDE_BRIDGE_DIR=${q(dir)}`,
    `ELECTRON_RUN_AS_NODE=1 exec ${q(electron)} ${q(path.join(__dirname, "native-host.js"))} "$@"`,
    "",
  ].join("\n"), { mode: 0o755 });
  fs.chmodSync(launcher, 0o755);

  const manifest = JSON.stringify({
    name: HOST_NAME,
    description: "Claude Code Bridge : appairage de l'extension avec l'app",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  }, null, 2);
  const installed = [];
  for (const [label, rel] of BROWSERS) {
    const base = path.join(home, "Library", "Application Support", rel);
    if (!fs.existsSync(base)) continue;
    const target = path.join(base, "NativeMessagingHosts");
    try {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, HOST_NAME + ".json"), manifest);
      installed.push(label);
    } catch {}
  }
  return { launcher, installed };
}

function writeAppInfo(info) {
  const f = path.join(bridgeDir(), "app.json");
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  fs.mkdirSync(bridgeDir(), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...prev, ...info }, null, 2));
}

// L'extension s'est-elle déjà connectée (trace laissée par native-host.js) ?
function extensionSeen() {
  try { return JSON.parse(fs.readFileSync(path.join(bridgeDir(), "extension.json"), "utf8")); } catch { return null; }
}

module.exports = { installNativeHost, writeAppInfo, extensionSeen, HOST_NAME, EXTENSION_ID };
