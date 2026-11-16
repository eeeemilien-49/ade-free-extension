#!/usr/bin/env node
// Installation sans app : `node install.mjs` (une seule fois). `node install.mjs --uninstall` pour retirer.
// Déclare l'hôte natif com.claude.code_bridge à chaque navigateur Chromium présent. Ensuite l'extension
// démarre elle-même le bridge local au besoin : rien à laisser ouvert.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.claude.code_bridge";
const EXTENSION_ID = "ihbpnieleoceojjdkdbcndheonfmljme"; // fixé par `key` dans extension/manifest.json
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST_SCRIPT = path.join(ROOT, "bridge", "native-host.mjs");
const EXTENSION_DIR = path.join(ROOT, "extension");
const DIR = process.env.CLAUDE_BRIDGE_DIR || path.join(os.homedir(), ".claude-chrome-bridge");
const home = os.homedir();

const BROWSERS = {
  darwin: [
    ["Chrome", "Library/Application Support/Google/Chrome"],
    ["Chrome Beta", "Library/Application Support/Google/Chrome Beta"],
    ["Chrome Canary", "Library/Application Support/Google/Chrome Canary"],
    ["Chromium", "Library/Application Support/Chromium"],
    ["Arc", "Library/Application Support/Arc/User Data"],
    ["Brave", "Library/Application Support/BraveSoftware/Brave-Browser"],
    ["Edge", "Library/Application Support/Microsoft Edge"],
    ["Vivaldi", "Library/Application Support/Vivaldi"],
  ],
  linux: [
    ["Chrome", ".config/google-chrome"],
    ["Chromium", ".config/chromium"],
    ["Brave", ".config/BraveSoftware/Brave-Browser"],
    ["Edge", ".config/microsoft-edge"],
    ["Vivaldi", ".config/vivaldi"],
  ],
}[process.platform];

if (!BROWSERS) {
  console.error(`Plateforme non prise en charge (${process.platform}) : macOS et Linux seulement pour l'instant.`);
  process.exit(1);
}

const targets = BROWSERS
  .map(([label, rel]) => [label, path.join(home, rel)])
  .filter(([, base]) => fs.existsSync(base))
  .map(([label, base]) => [label, path.join(base, "NativeMessagingHosts", HOST_NAME + ".json")]);

if (process.argv.includes("--uninstall")) {
  for (const [label, file] of targets) if (fs.existsSync(file)) { fs.rmSync(file); console.log(`✓ retiré de ${label}`); }
  fs.rmSync(path.join(DIR, "native-host"), { force: true });
  console.log(`Commentaires conservés dans ${DIR} (supprime le dossier pour tout effacer).`);
  process.exit(0);
}

// Chrome lance l'hôte avec un environnement minimal : on fige ici le PATH du shell de connexion
// et le chemin de `claude`, pour que le bridge trouve tout.
const shell = process.env.SHELL || "/bin/sh";
const fromShell = (cmd) => {
  try { return execFileSync(shell, ["-lc", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").pop(); }
  catch { return ""; }
};
const PATH = fromShell("echo $PATH") || process.env.PATH || "";
// Chemin stable (ex. /opt/homebrew/bin/node) plutôt que process.execPath, qui pointe dans le Cellar
// et casse à la prochaine mise à jour de Node.
const node = fromShell("command -v node") || process.execPath;
const claude = process.env.CLAUDE_BIN || fromShell("command -v claude");
if (!claude) {
  console.error("✗ Claude Code introuvable (commande `claude`). Installe-le : https://docs.claude.com/claude-code");
  process.exit(1);
}

const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const launcher = path.join(DIR, "native-host");
fs.writeFileSync(launcher, [
  "#!/bin/sh",
  "# Généré par install.mjs : hôte natif de l'extension Claude Code Bridge (sans app).",
  `export PATH=${q(PATH)}`,
  `export CLAUDE_BIN=${q(claude)}`,
  `export CLAUDE_BRIDGE_DIR=${q(DIR)}`,
  `exec ${q(node)} ${q(HOST_SCRIPT)} "$@"`,
  "",
].join("\n"), { mode: 0o755 });
fs.chmodSync(launcher, 0o755);

const manifest = JSON.stringify({
  name: HOST_NAME,
  description: "Claude Code Bridge : démarre le bridge local pour l'extension",
  path: launcher,
  type: "stdio",
  allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
}, null, 2);

const done = [];
for (const [label, file] of targets) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, manifest);
    done.push(label);
  } catch (e) { console.error(`✗ ${label} : ${e.message}`); }
}

if (!done.length) {
  console.error("✗ Aucun navigateur Chromium trouvé (Chrome, Arc, Brave, Edge…).");
  process.exit(1);
}
console.log(`✓ Hôte natif installé pour : ${done.join(", ")}`);
console.log(`✓ Claude Code : ${claude}`);
console.log(`
Dernière étape, dans le navigateur :
  1. ouvre chrome://extensions et active le « Mode développeur » ;
  2. « Charger l'extension non empaquetée » → choisis le dossier :
     ${EXTENSION_DIR}
  3. ⌘+clic (Ctrl+clic sous Linux) sur un élément d'une page pour le commenter.

Le bridge démarre tout seul au premier usage (journal : ${path.join(DIR, "bridge.log")}).
Ne déplace pas ce dossier après l'installation (ou relance node install.mjs).`);
