// Hôte natif autonome (Native Messaging), installé par `node install.mjs` : aucune app requise.
// Chrome le lance à la demande de l'extension. S'il n'y a pas de bridge sur le port, il démarre
// bridge/server.mjs en arrière-plan (détaché : il survit à l'hôte), puis rend port et token.
// Messages : { type: "hello" } → { ok, port, token } ; { type: "open" } → { ok } (démarre le bridge).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = process.env.CLAUDE_BRIDGE_DIR || path.join(os.homedir(), ".claude-chrome-bridge");
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.mjs");
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { return null; } };
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || readJson("app.json")?.port || 7823);

function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

async function ensureBridge() {
  if (await listening(PORT)) return true;
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(DIR, "bridge.log"), "a");
  spawn(process.execPath, [SERVER], {
    cwd: os.homedir(),
    env: { ...process.env, CLAUDE_BRIDGE_PORT: String(PORT), CLAUDE_BRIDGE_DIR: DIR },
    detached: true,
    stdio: ["ignore", log, log],
  }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await listening(PORT)) return true;
  }
  return false;
}

async function handle(msg) {
  if (msg?.type === "hello" || msg?.type === "open") {
    const ok = await ensureBridge();
    let token = "";
    try { token = fs.readFileSync(path.join(DIR, "token"), "utf8").trim(); } catch {}
    if (!ok || !token) return { ok: false, error: `Le bridge n'a pas démarré : voir ${path.join(DIR, "bridge.log")}` };
    return { ok: true, port: PORT, token, standalone: true };
  }
  return { error: "message inconnu" };
}

try {
  fs.mkdirSync(DIR, { recursive: true });
  const origin = process.argv.find((a) => a.startsWith("chrome-extension://")) || "";
  fs.writeFileSync(path.join(DIR, "extension.json"), JSON.stringify({ origin, seenAt: Date.now() }));
} catch {}

// Protocole Chrome : longueur sur 4 octets (little-endian) puis JSON UTF-8.
function write(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

let buf = Buffer.alloc(0), busy = Promise.resolve();
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const raw = buf.subarray(4, 4 + len).toString("utf8");
    buf = buf.subarray(4 + len);
    let msg = null;
    try { msg = JSON.parse(raw); } catch {}
    busy = busy.then(() => handle(msg)).then(write, (e) => write({ error: String(e?.message || e) }));
  }
});
process.stdin.on("end", () => busy.then(() => process.exit(0)));
