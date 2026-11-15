// Projet iOS (Xcode) : à la place d'un serveur de dev, on sert une page « miroir » du simulateur.
// Elle affiche l'écran du simulateur en direct ; au ⌘+clic, elle pose une petite zone à l'endroit
// touché, que le calque habituel (extension/comment.js) commente comme n'importe quel élément.
// Claude reçoit le point touché, une capture plein écran et le script pour recompiler et relancer.
// Même interface que DevServer : événement « change » avec { status, url, command, logs, error }.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");

const DATA = path.join(os.homedir(), ".claude-chrome-bridge", "ios");
const SHOTS = path.join(os.tmpdir(), "claude-chrome-bridge"); // dossier déjà autorisé aux sessions (--add-dir)
const RUNNER_SRC = path.join(__dirname, "..", "ios-runner");
const RUNNER_DIR = path.join(DATA, "Runner");
const RUNNER_DERIVED = path.join(DATA, "DerivedData", "BridgeRunner");
const RUNNER_PORT = 7830;
const WORKERS = 3; // captures en parallèle : ~10 images/s

const run = (cmd, args, opts = {}) => new Promise((resolve) =>
  execFile(cmd, args, { timeout: 20000, maxBuffer: 20 * 1024 * 1024, ...opts }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ""), err: String(errOut || err?.message || "") })));

// Un dossier est un projet iOS s'il a un .xcodeproj (ou un project.yml XcodeGen) et pas de package.json.
function isXcodeProject(dir) {
  if (fs.existsSync(path.join(dir, "package.json"))) return false;
  try { return fs.readdirSync(dir).some((f) => f.endsWith(".xcodeproj") || f === "project.yml"); } catch { return false; }
}

function projectInfo(dir) {
  const proj = fs.readdirSync(dir).find((f) => f.endsWith(".xcodeproj"));
  const name = proj ? proj.replace(/\.xcodeproj$/, "") : path.basename(dir);
  let bundle = "";
  try {
    const pbx = fs.readFileSync(path.join(dir, proj, "project.pbxproj"), "utf8");
    bundle = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g)].map((m) => m[1]).find((b) => !/tests?$/i.test(b)) || "";
  } catch {}
  return { name, proj, scheme: name, bundle };
}

// Port stable par projet (les commentaires sont rangés par adresse de page).
function stablePort(dir) {
  let h = 0;
  for (const c of dir) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 7840 + (h % 50);
}

class SimServer extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.state = { status: "idle", url: "", command: "", logs: [], external: false, kind: "ios" };
    this.frame = null;        // { at, buf } dernière capture servie
    this.framing = null;      // capture en cours (une seule à la fois)
    this.build = { status: "idle", at: 0 };
    this.streams = new Set(); // clients du flux MJPEG
    this.seq = 0;
    this.runner = { status: "idle" }; // exécutant XCUITest (arbre des composants, touchers)
  }
  set(patch) { Object.assign(this.state, patch); this.emit("change", this.state); }
  log(line) {
    for (const l of String(line).split("\n")) if (l.trim()) this.state.logs.push(l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
    if (this.state.logs.length > 400) this.state.logs.splice(0, this.state.logs.length - 400);
    this.emit("change", this.state);
  }

  async start() {
    this.set({ status: "detecting", url: "", logs: [], error: "" });
    fs.mkdirSync(DATA, { recursive: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    this.info = projectInfo(this.dir);
    this.markersFile = path.join(DATA, `${this.info.name}-markers.json`);
    this.script = path.join(DATA, `${this.info.name}-relancer.sh`);

    this.device = await this.bootedDevice();
    if (!this.device) return this.set({ status: "error", error: "Aucun simulateur iOS disponible (Xcode est-il installé ?)." });
    this.writeScript();
    this.set({ command: `Simulateur · ${this.device.name}` });
    this.log(`Simulateur : ${this.device.name} (${this.device.udid})`);

    try { await this.listen(stablePort(this.dir)); }
    catch (e) { return this.set({ status: "error", error: `Impossible d'ouvrir le miroir : ${e.message}` }); }
    this.set({ status: "running", url: `http://127.0.0.1:${this.port}/` });

    // L'app est-elle déjà installée ? On la lance ; sinon on la compile.
    if (this.info.bundle) {
      const r = await run("xcrun", ["simctl", "launch", this.device.udid, this.info.bundle]);
      if (r.ok) this.log(`App lancée : ${this.info.bundle}`);
      else this.rebuild();
    }
    this.startRunner();
  }

  // ── Exécutant XCUITest : compilé une fois, puis lancé en tâche de fond tant que le projet est ouvert.
  async startRunner() {
    if (this.stopped || this.runner.status === "starting" || this.runner.status === "ready") return;
    this.runner = { status: "starting" };
    const products = path.join(RUNNER_DERIVED, "Build", "Products");
    const xctestrun = () => { try { return fs.readdirSync(products).find((f) => f.endsWith(".xctestrun")); } catch {} };
    const srcTime = Math.max(...["project.yml", "Runner/Runner.swift", "Host/Host.swift"].map((f) => fs.statSync(path.join(RUNNER_SRC, f)).mtimeMs));
    const builtTime = (() => { try { return fs.statSync(path.join(products, xctestrun())).mtimeMs; } catch { return 0; } })();
    if (!xctestrun() || builtTime < srcTime) {
      this.log("Préparation de la sélection des composants (une seule fois)…");
      const g = await run("xcodegen", ["generate", "--quiet", "--spec", path.join(RUNNER_SRC, "project.yml"), "--project", RUNNER_DIR], { timeout: 60000 });
      const b = g.ok && await run("xcodebuild", ["build-for-testing", "-project", path.join(RUNNER_DIR, "BridgeRunner.xcodeproj"),
        "-scheme", "BridgeHost", "-destination", `id=${this.device.udid}`, "-derivedDataPath", RUNNER_DERIVED, "-quiet"], { timeout: 600000 });
      if (!g.ok || !b?.ok || !xctestrun()) {
        this.log(`Sélection des composants indisponible : ${(g.ok ? b?.err : g.err || "xcodegen introuvable").slice(-400)}`);
        return (this.runner = { status: "error" });
      }
    }
    if (this.stopped) return;
    const p = spawn("xcodebuild", ["test-without-building", "-xctestrun", path.join(products, xctestrun()),
      "-destination", `id=${this.device.udid}`, "-only-testing:BridgeRunner/Runner/testServe"],
      { env: { ...process.env, TEST_RUNNER_BRIDGE_PORT: String(RUNNER_PORT), TEST_RUNNER_BRIDGE_APP: this.info.bundle } });
    this.runner = { status: "starting", proc: p };
    const cleanup = () => { try { p.kill("SIGINT"); } catch {} };
    process.once("exit", cleanup);
    p.on("close", () => process.removeListener("exit", cleanup));
    const onOut = (d) => { if (String(d).includes("BRIDGE_READY")) { this.runner.status = "ready"; this.log("Sélection des composants prête."); } };
    p.stdout.on("data", onOut); p.stderr.on("data", onOut);
    p.on("close", () => {
      const was = this.runner.status;
      this.runner = { status: "idle" };
      if (!this.stopped && was === "ready") setTimeout(() => this.startRunner(), 1000); // relance si l'exécutant tombe
    });
  }

  ui(route, params, body) {
    const qs = new URLSearchParams({ ...params, bundle: this.info.bundle });
    return fetch(`http://127.0.0.1:${RUNNER_PORT}${route}?${qs}`, { method: body === undefined ? "GET" : "POST", body, signal: AbortSignal.timeout(8000) })
      .then(async (r) => ({ code: r.status, text: await r.text() }));
  }

  async bootedDevice() {
    const list = async () => {
      const r = await run("xcrun", ["simctl", "list", "devices", "available", "-j"]);
      try { return Object.values(JSON.parse(r.out).devices).flat(); } catch { return []; }
    };
    let all = await list();
    let dev = all.find((d) => d.state === "Booted" && /iPhone/.test(d.name)) || all.find((d) => d.state === "Booted");
    if (!dev) {
      dev = all.filter((d) => /iPhone/.test(d.name)).pop();
      if (!dev) return null;
      this.log(`Démarrage du simulateur ${dev.name}…`);
      await run("xcrun", ["simctl", "boot", dev.udid], { timeout: 120000 });
    }
    run("open", ["-ga", "Simulator"]); // la fenêtre Simulator sert à naviguer dans l'app
    return { udid: dev.udid, name: dev.name };
  }

  // Script que les sessions Claude lancent après une modification (et le bouton « Recompiler »).
  writeScript() {
    const { name, proj, scheme, bundle } = this.info;
    const derived = path.join(DATA, "DerivedData", name);
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(this.script, `#!/bin/bash
# Recompile ${name} et le relance dans le simulateur ${this.device.name}.
set -eo pipefail
cd ${q(this.dir)}
# XcodeGen seulement si un fichier Swift ajouté manque au projet (le .pbxproj est versionné).
PBX=${q(path.join(proj, "project.pbxproj"))}
if [ -f project.yml ] && command -v xcodegen >/dev/null; then
  missing=$(find . -name '*.swift' -newer "$PBX" -not -path './build/*' -not -path '*/DerivedData/*' | while read -r f; do grep -qF "$(basename "$f")" "$PBX" || echo "$f"; done)
  if [ -n "$missing" ]; then echo "Nouveaux fichiers : régénération du projet"; xcodegen generate --quiet; fi
fi
xcodebuild -project ${q(proj)} -scheme ${q(scheme)} -configuration Debug \\
  -destination ${q("id=" + this.device.udid)} -derivedDataPath ${q(derived)} -quiet build
APP=$(find ${q(path.join(derived, "Build/Products/Debug-iphonesimulator"))} -maxdepth 1 -name '*.app' | head -1)
xcrun simctl install ${q(this.device.udid)} "$APP"
xcrun simctl launch --terminate-running-process ${q(this.device.udid)} ${q(bundle)}
echo "OK : ${name} relancé"
`, { mode: 0o755 });
  }

  rebuild() {
    if (this.build.status === "running") return;
    this.build = { status: "running", at: Date.now() };
    this.log("Compilation et relance…");
    const p = spawn("/bin/bash", [this.script], { env: process.env });
    p.stdout.on("data", (d) => this.log(d));
    p.stderr.on("data", (d) => this.log(d));
    p.on("close", (code) => {
      this.build = { status: code === 0 ? "ok" : "error", at: Date.now() };
      this.log(code === 0 ? "Relancé." : `Échec de la compilation (code ${code}).`);
    });
  }

  // Capture de l'écran (JPEG pour le miroir), une seule à la fois, réutilisée 150 ms.
  async capture() {
    if (this.frame && Date.now() - this.frame.at < 150) return this.frame.buf;
    if (!this.framing) {
      const file = path.join(SHOTS, `frame-${this.info.name}.jpg`);
      this.framing = run("xcrun", ["simctl", "io", this.device.udid, "screenshot", "--type=jpeg", file], { timeout: 8000 })
        .then((r) => { if (r.ok) this.frame = { at: Date.now(), buf: fs.readFileSync(file) }; })
        .finally(() => { this.framing = null; });
    }
    await this.framing;
    return this.frame?.buf;
  }

  // Flux MJPEG : plusieurs captures en vol, chaque nouvelle image est poussée aux clients.
  pump(worker) {
    if (!this.streams.size || this.stopped) return (this.pumping = Math.max(0, (this.pumping || 1) - 1));
    const file = path.join(SHOTS, `frame-${this.info.name}-${worker}.jpg`);
    const seq = ++this.seq;
    run("xcrun", ["simctl", "io", this.device.udid, "screenshot", "--type=jpeg", file], { timeout: 8000 }).then((r) => {
      if (r.ok && seq > (this.sent || 0)) {
        this.sent = seq;
        const buf = fs.readFileSync(file);
        this.frame = { at: Date.now(), buf };
        for (const res of this.streams) res.write(`--frame\r\ncontent-type: image/jpeg\r\ncontent-length: ${buf.length}\r\n\r\n`), res.write(buf), res.write("\r\n");
      }
      setTimeout(() => this.pump(worker), r.ok ? 0 : 500);
    });
  }

  markers() { try { return JSON.parse(fs.readFileSync(this.markersFile, "utf8")); } catch { return []; } }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res).catch((e) => { res.writeHead(500); res.end(e.message); }));
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE" && port < 7899) resolve(this.listen(port + 1));
        else reject(e);
      });
      server.listen(port, "127.0.0.1", () => { this.server = server; this.port = port; resolve(); });
    });
  }

  async handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const body = async () => { let d = ""; for await (const c of req) d += c; return d ? JSON.parse(d) : {}; };

    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(fs.readFileSync(path.join(__dirname, "..", "renderer", "sim.html"), "utf8"));
    }
    if (url.pathname === "/frame") {
      const buf = await this.capture();
      if (!buf) { res.writeHead(503); return res.end(); }
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
      return res.end(buf);
    }
    if (url.pathname === "/stream") {
      res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store", connection: "close" });
      this.streams.add(res);
      req.on("close", () => this.streams.delete(res));
      if (!this.pumping) { this.pumping = WORKERS; for (let w = 0; w < WORKERS; w++) setTimeout(() => this.pump(w), w * 70); }
      return;
    }
    if (url.pathname === "/info") {
      return json(200, { ...this.info, device: this.device, script: this.script, build: this.build, runner: this.runner.status });
    }
    // Arbre des composants et touchers, relayés à l'exécutant XCUITest.
    if (url.pathname.startsWith("/ui/")) {
      if (this.runner.status !== "ready") return json(503, { error: "runner", status: this.runner.status });
      const raw = req.method === "POST" ? await (async () => { let d = ""; for await (const c of req) d += c; return d; })() : undefined;
      const r = await this.ui(url.pathname.slice(3), Object.fromEntries(url.searchParams), raw).catch((e) => ({ code: 502, text: JSON.stringify({ error: e.message }) }));
      res.writeHead(r.code, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(r.text);
    }
    if (url.pathname === "/markers" && req.method === "GET") return json(200, this.markers());
    if (url.pathname === "/markers" && req.method === "POST") {
      const m = await body();
      const list = this.markers().filter((x) => x.id !== m.id);
      list.push({ id: String(m.id), x: Number(m.x), y: Number(m.y), w: Number(m.w) || 0, h: Number(m.h) || 0,
        box: !!m.box, desc: String(m.desc || "").slice(0, 4000), capture: String(m.capture || "") });
      fs.writeFileSync(this.markersFile, JSON.stringify(list.slice(-500)));
      return json(200, { ok: true });
    }
    // Capture plein écran en PNG au moment du ⌘+clic, jointe au commentaire.
    if (url.pathname === "/snap" && req.method === "POST") {
      const { id } = await body();
      const file = path.join(SHOTS, `ios-${String(id).replace(/[^\w-]/g, "")}.png`);
      const r = await run("xcrun", ["simctl", "io", this.device.udid, "screenshot", "--type=png", file], { timeout: 8000 });
      return json(r.ok ? 200 : 500, r.ok ? { path: file } : { error: r.err });
    }
    if (url.pathname === "/rebuild" && req.method === "POST") { this.rebuild(); return json(200, { ok: true }); }
    if (url.pathname === "/simulator" && req.method === "POST") { run("open", ["-a", "Simulator"]); return json(200, { ok: true }); }
    res.writeHead(404); res.end();
  }

  stop() {
    this.stopped = true;
    try { this.runner.proc?.kill("SIGINT"); } catch {}
    for (const res of this.streams) try { res.end(); } catch {}
    this.streams.clear();
    try { this.server?.close(); } catch {}
    this.server = null;
    if (this.state.status !== "error") this.set({ status: "stopped" });
  }
}

module.exports = { SimServer, isXcodeProject };
