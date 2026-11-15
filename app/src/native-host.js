// Hôte natif (Native Messaging) : lancé par Chrome à la demande de l'extension.
// Appairage sans configuration : il lit le port et le token du bridge sur le disque
// et les rend à l'extension ; il sait aussi rouvrir l'app.
// Messages : { type: "hello" } → { ok, port, token, app } ; { type: "open" } → { ok }.
// Exécuté par le Node d'Electron (ELECTRON_RUN_AS_NODE), sans dépendance.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const DIR = process.env.CLAUDE_BRIDGE_DIR || path.join(os.homedir(), ".claude-chrome-bridge");
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); } catch { return null; } };

function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function handle(msg) {
  const info = readJson("app.json") || {};
  const port = Number(info.port) || 7823;
  const app = !!info.pid && alive(info.pid);
  if (msg?.type === "hello") {
    let token = "";
    try { token = fs.readFileSync(path.join(DIR, "token"), "utf8").trim(); } catch {}
    const ok = !!token && (await listening(port));
    return { ok, port, token: ok ? token : "", app, canOpen: !!info.launch };
  }
  if (msg?.type === "open") {
    if (app) return { ok: true, app: true };
    const l = info.launch;
    if (!l?.cmd) return { error: "App jamais lancée sur ce Mac." };
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawn(l.cmd, l.args || [], { cwd: l.cwd || os.homedir(), env, detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  }
  return { error: "message inconnu" };
}

// Trace de l'extension : l'app sait qu'elle est installée et connectée.
function seen(origin) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, "extension.json"), JSON.stringify({ origin, seenAt: Date.now() }));
  } catch {}
}

// Protocole Chrome : longueur sur 4 octets (ordre natif, little-endian sur Mac) puis JSON UTF-8.
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
seen(process.argv.find((a) => a.startsWith("chrome-extension://")) || "");
