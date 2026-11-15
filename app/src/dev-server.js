// Serveur de dev d'un projet : réutilise celui qui tourne déjà (processus à l'écoute
// dont le dossier est dans le projet), sinon lance `<pm> run dev` (selon le lockfile)
// à la racine, ou dans chaque workspace qui a un script dev (monorepo), et lit l'URL affichée.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");

const FRONT = /^(next|vite|astro|nuxt|@sveltejs\/kit|@remix-run\/dev|react-scripts|gatsby|webpack-dev-server|parcel|@angular\/cli|expo)$/;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s'"]*/;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

function packageManager(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  return "npm";
}

// Workspaces (motifs simples « apps/* » ou chemins directs).
function workspaces(dir, pkg) {
  const patterns = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages || [];
  const out = [];
  for (const p of patterns) {
    if (p.endsWith("/*")) {
      const base = path.join(dir, p.slice(0, -2));
      try { for (const d of fs.readdirSync(base)) out.push(path.join(base, d)); } catch {}
    } else out.push(path.join(dir, p));
  }
  return out.filter((d) => fs.existsSync(path.join(d, "package.json")));
}
const isFront = (pkg) => Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }).some((d) => FRONT.test(d));

// Ce qu'il faut lancer : [{ cwd, cmd, front }]
function plan(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  if (!pkg) return [];
  const pm = packageManager(dir);
  if (pkg.scripts?.dev) return [{ cwd: dir, cmd: `${pm} run dev`, front: true }];
  return workspaces(dir, pkg)
    .map((d) => ({ d, p: readJson(path.join(d, "package.json")) }))
    .filter(({ p }) => p?.scripts?.dev)
    .map(({ d, p }) => ({ cwd: d, cmd: `${pm} run dev`, front: isFront(p) }))
    .sort((a, b) => b.front - a.front);
}

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 5000 }, (_e, out) => resolve(String(out || ""))));

// Serveurs déjà lancés depuis le projet : [{ port, cwd }]
async function listening(dir) {
  const out = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]);
  const ports = new Map(); // pid -> Set(port)
  let pid = null;
  for (const l of out.split("\n")) {
    if (l[0] === "p") pid = l.slice(1);
    else if (l[0] === "n" && pid) {
      const port = Number(l.slice(l.lastIndexOf(":") + 1));
      if (port) (ports.get(pid) || ports.set(pid, new Set()).get(pid)).add(port);
    }
  }
  if (!ports.size) return [];
  const cwdOut = await run("lsof", ["-a", "-p", [...ports.keys()].join(","), "-d", "cwd", "-Fpn"]);
  const res = [];
  pid = null;
  for (const l of cwdOut.split("\n")) {
    if (l[0] === "p") pid = l.slice(1);
    else if (l[0] === "n" && pid) {
      const cwd = l.slice(1);
      if (cwd === dir || cwd.startsWith(dir + path.sep)) for (const port of ports.get(pid) || []) res.push({ port, cwd });
    }
  }
  return res;
}

async function servesHtml(port) {
  try {
    const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(4000), redirect: "manual" });
    const type = r.headers.get("content-type") || "";
    return type.includes("html") || (r.status >= 300 && r.status < 400);
  } catch { return false; }
}

class DevServer extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.procs = [];
    this.state = { status: "idle", url: "", command: "", logs: [], external: false };
  }
  set(patch) { Object.assign(this.state, patch); this.emit("change", this.state); }
  log(line) {
    this.state.logs.push(line);
    if (this.state.logs.length > 300) this.state.logs.splice(0, this.state.logs.length - 300);
    this.emit("change", this.state);
  }

  async start() {
    this.set({ status: "detecting", url: "", logs: [], external: false, command: "" });
    const steps = plan(this.dir);
    // 1. Déjà lancé (dans un terminal, par ex.) : on s'y branche sans rien lancer.
    const found = await listening(this.dir);
    const rank = (c) => steps.findIndex((s) => c.cwd === s.cwd || c.cwd.startsWith(s.cwd + path.sep));
    found.sort((a, b) => {
      const fa = steps[rank(a)]?.front ? 0 : 1, fb = steps[rank(b)]?.front ? 0 : 1;
      return fa - fb || a.port - b.port;
    });
    for (const c of found) {
      if (await servesHtml(c.port)) {
        this.log(`Serveur déjà actif sur le port ${c.port} (${path.relative(this.dir, c.cwd) || "."}) : réutilisé.`);
        return this.set({ status: "running", url: `http://localhost:${c.port}/`, external: true, command: "" });
      }
    }
    // 2. Sinon on le lance.
    if (!steps.length) {
      return this.set({ status: "error", error: "Aucun script « dev » trouvé dans package.json. Saisis l'adresse de la page dans la barre." });
    }
    this.set({ status: "starting", command: steps.map((s) => `${s.cmd}${s.cwd !== this.dir ? ` (${path.relative(this.dir, s.cwd)})` : ""}`).join(" + ") });
    const shell = process.env.SHELL || "/bin/zsh";
    for (const s of steps) {
      const tag = path.relative(this.dir, s.cwd) || path.basename(this.dir);
      this.log(`$ ${s.cmd}   # ${tag}`);
      const child = spawn(shell, ["-lc", s.cmd], {
        cwd: s.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", BROWSER: "none" },
      });
      this.procs.push(child);
      let buf = "";
      const onData = (chunk) => {
        buf += String(chunk);
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (let line of lines) {
          line = line.replace(ANSI, "");
          if (!line.trim()) continue;
          this.log(`[${tag}] ${line}`);
          const m = s.front && this.state.status === "starting" && URL_RE.exec(line);
          if (m) {
            let url = m[0].replace("0.0.0.0", "localhost").replace(/[).,]+$/, "");
            try { url = new URL(url).href; } catch {}
            this.set({ status: "running", url });
          }
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", (code) => {
        this.log(`[${tag}] terminé (code ${code})`);
        this.procs = this.procs.filter((p) => p !== child);
        if (this.state.status === "starting" && s.front) this.set({ status: "error", error: `${s.cmd} s'est arrêté (code ${code}).` });
      });
    }
    // Filet : URL jamais affichée mais un port HTML s'est ouvert depuis le projet.
    setTimeout(async () => {
      if (this.state.status !== "starting") return;
      for (const c of await listening(this.dir)) {
        if (await servesHtml(c.port)) return this.set({ status: "running", url: `http://localhost:${c.port}/` });
      }
    }, 20000);
    setTimeout(() => {
      if (this.state.status === "starting") this.set({ status: "error", error: "Le serveur n'a affiché aucune adresse après 90 s." });
    }, 90000);
  }

  // Arrête seulement ce qu'on a lancé (groupe de processus : shell + bun/next…).
  stop() {
    for (const p of this.procs) {
      try { process.kill(-p.pid, "SIGTERM"); } catch {}
      setTimeout(() => { try { process.kill(-p.pid, "SIGKILL"); } catch {} }, 3000).unref?.();
    }
    this.procs = [];
    if (!this.state.external) this.set({ status: "stopped" });
  }
}

module.exports = { DevServer, plan };
