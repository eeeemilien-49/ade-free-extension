#!/usr/bin/env node
// Injecteur sans extension : l'app glisse le calque de commentaires (extension/comment.js)
// dans l'onglet actif du vrai navigateur via AppleScript « execute javascript », puis
// relaie ses requêtes vers le bridge. Marche sur n'importe quel site ; hors projet local,
// les commentaires sont en lecture seule (contexte pour Claude, aucune modification).
//
// Prérequis, une fois par navigateur : autoriser JavaScript depuis AppleScript
//   Chrome / Arc / Brave / Edge : Affichage › Développeur › Autoriser JavaScript dans les événements AppleScript
//   Safari : Réglages › Avancés › Afficher les fonctionnalités pour les développeurs, puis Développement › Autoriser JavaScript à partir des Apple Events
//
// Utilisation : `node injector/inject.mjs` (autonome), ou depuis l'app :
//   import { createInjector, bridgeDispatch } from "./inject.mjs";
//   const inj = createInjector({ dispatch: bridgeDispatch() }); inj.start();
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_FILE = path.join(HERE, "..", "extension", "comment.js");
const CONF_DIR = process.env.CLAUDE_BRIDGE_DIR || path.join(os.homedir(), ".claude-chrome-bridge");
const BRIDGE = `http://127.0.0.1:${process.env.CLAUDE_BRIDGE_PORT || 7823}`;

// Navigateurs pilotables. « chromium » : execute … javascript ; « safari » : do JavaScript.
const BROWSERS = {
  "Google Chrome": "chromium", Arc: "chromium", "Brave Browser": "chromium", "Microsoft Edge": "chromium", Safari: "safari",
};

export const pageKey = (url) => String(url || "").split("#")[0];
export function isLocal(url) {
  try {
    const h = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(h) || h.endsWith(".localhost") || h.endsWith(".test");
  } catch { return false; }
}

// ---------- AppleScript ----------
function osa(source, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const p = spawn("osascript", ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out.replace(/\n$/, "")) : reject(new Error(err.trim() || `osascript ${code}`)); });
    p.stdin.end(source);
  });
}
const asString = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

// Exécute du JS dans l'onglet actif ; renvoie { url, result }.
async function runInTab(browser, js) {
  const kind = BROWSERS[browser];
  const src = kind === "safari"
    ? `tell application "Safari"
  if (count of windows) = 0 then return ""
  set t to current tab of front window
  set u to URL of t
  set r to do JavaScript ${asString(js)} in t
  if r is missing value then set r to ""
  return u & linefeed & r
end tell`
    : `tell application ${asString(browser)}
  if (count of windows) = 0 then return ""
  set t to active tab of front window
  set u to URL of t
  set r to execute t javascript ${asString(js)}
  if r is missing value then set r to ""
  return u & linefeed & r
end tell`;
  const out = await osa(src);
  if (!out) return null;
  const i = out.indexOf("\n");
  return { url: i < 0 ? out : out.slice(0, i), result: i < 0 ? "" : out.slice(i + 1) };
}

async function frontmostApp() {
  return osa('tell application "System Events" to get name of first application process whose frontmost is true', 3000).catch(() => "");
}

// ---------- injecteur ----------
const PROBE = `(function(){var b=window.__claudeBridge;if(b)return b.drain();return document.querySelector("claude-comments")?"EXT":"NONE";})()`;

export function createInjector({ dispatch, interval = 600, log = console.log } = {}) {
  let browser = null, timer = null, busy = false, lastError = "", script = null;
  const state = { browser: null, url: null, injected: false, error: "" };

  const setError = (msg) => {
    state.error = msg;
    if (msg && msg !== lastError) log(`⚠ ${msg}`);
    lastError = msg;
  };

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const front = await frontmostApp();
      if (BROWSERS[front]) browser = front; // on garde le dernier navigateur utilisé
      if (!browser) return;
      state.browser = browser;
      const res = await runInTab(browser, PROBE);
      if (!res || !/^https?:/.test(res.url)) { state.url = res?.url || null; state.injected = false; return; }
      state.url = res.url;
      if (res.result === "EXT") { state.injected = true; return setError(""); } // l'extension s'en charge déjà
      if (res.result === "NONE") {
        script ??= fs.readFileSync(SCRIPT_FILE, "utf8");
        await runInTab(browser, script + '\n;"ok"');
        state.injected = true;
        log(`calque injecté · ${browser} · ${res.url}`);
        return setError("");
      }
      state.injected = true;
      setError("");
      const requests = JSON.parse(res.result || "[]");
      if (!requests.length) return;
      // L'URL fait foi depuis le navigateur, jamais depuis la page.
      const page = { url: res.url, local: isLocal(res.url) };
      const replies = await Promise.all(requests.map(async ({ id, msg }) => {
        try { return { id, data: await dispatch(msg, page) }; }
        catch (e) { return { id, error: e.message }; }
      }));
      await runInTab(browser, `window.__claudeBridge&&window.__claudeBridge.deliver(${JSON.stringify(JSON.stringify(replies))})`);
    } catch (e) {
      const m = String(e.message);
      if (/désactivée|disabled|turned off|Allow JavaScript/i.test(m)) {
        setError(`${browser} : autorise JavaScript depuis AppleScript (Affichage › Développeur › Autoriser JavaScript dans les événements AppleScript).`);
      } else if (/-1743|not authori[sz]ed|pas autorisé/i.test(m)) {
        setError(`macOS : autorise cette app à contrôler ${browser} (Réglages Système › Confidentialité et sécurité › Automatisation).`);
      } else setError(m.split("\n")[0]);
    } finally { busy = false; }
  }

  return {
    state,
    start() { if (!timer) { timer = setInterval(tick, interval); tick(); } },
    stop() { clearInterval(timer); timer = null; },
    // Message vers le calque de l'onglet actif (cc:open, cc:snapshot, cc:describe).
    async command(msg) {
      if (!browser) throw new Error("Aucun navigateur actif");
      const res = await runInTab(browser, `window.__claudeBridge?window.__claudeBridge.command(${JSON.stringify(JSON.stringify(msg))}):"null"`);
      return res && { url: res.url, data: JSON.parse(res.result || "null") };
    },
  };
}

// ---------- relais vers le bridge (version autonome de background.js) ----------
export function bridgeDispatch() {
  const token = () => fs.readFileSync(path.join(CONF_DIR, "token"), "utf8").trim();
  const confFile = path.join(CONF_DIR, "app.json");
  const conf = () => { try { return { mode: "acceptEdits", projects: {}, seen: {}, ...JSON.parse(fs.readFileSync(confFile, "utf8")) }; } catch { return { mode: "acceptEdits", projects: {}, seen: {} }; } };
  const save = (c) => fs.writeFileSync(confFile, JSON.stringify(c, null, 2));
  // Dossier de travail des commentaires hors projet local (lecture seule).
  const contextDir = path.join(CONF_DIR, "context");
  fs.mkdirSync(contextDir, { recursive: true });

  async function bridge(method, pathname, body) {
    let res;
    try {
      res = await fetch(BRIDGE + pathname, { method, headers: { "content-type": "application/json", "x-bridge-token": token() }, body: body && JSON.stringify(body) });
    } catch { throw new Error("Bridge injoignable — lance : node bridge/server.mjs"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  async function projectFor(url) {
    const origin = new URL(url).origin;
    const saved = conf().projects[origin];
    if (saved) return saved;
    const u = new URL(url);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return (await bridge("GET", "/detect?port=" + port).catch(() => ({}))).cwd || "";
  }
  // Une page ne peut agir que sur les commentaires de sa propre URL.
  async function own(page, id) {
    const list = await bridge("GET", "/comments?url=" + encodeURIComponent(pageKey(page.url)));
    if (!list.some((c) => c.id === id)) throw new Error("commentaire introuvable sur cette page");
  }

  const handlers = {
    async list(_, page) {
      const comments = await bridge("GET", "/comments?url=" + encodeURIComponent(page.url));
      return { comments, cwd: page.local ? await projectFor(page.url) : contextDir };
    },
    async create({ comment, cwd }, page) {
      const c = conf();
      const body = { ...comment, url: page.url, mode: c.mode };
      if (!page.local) return bridge("POST", "/comments", { ...body, cwd: contextDir, readOnly: true });
      const origin = new URL(page.url).origin;
      for (const dir of [cwd, await projectFor(page.url)].map((d) => (d || "").trim()).filter(Boolean)) {
        try {
          const created = await bridge("POST", "/comments", { ...body, cwd: dir });
          c.projects[origin] = dir;
          save(c);
          return created;
        } catch (e) { if (!/dossier introuvable/.test(e.message)) throw e; }
      }
      throw new Error("Indique le dossier du projet.");
    },
    async reply({ id, text, detail }, page) { await own(page, id); return bridge("POST", "/reply", { id, text, detail, mode: conf().mode }); },
    async resolve({ id }, page) { await own(page, id); return bridge("POST", "/resolve", { id }); },
    async launch({ id, selectors }, page) { await own(page, id); return bridge("POST", "/launch", { id, mode: conf().mode }); },
    async seen({ id }) { const c = conf(); c.seen[id] = Date.now(); save(c); },
  };
  return (msg, page) => {
    const h = handlers[msg?.type];
    if (!h) throw new Error(`action non disponible : ${msg?.type}`);
    return h(msg, page);
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform !== "darwin") { console.error("macOS uniquement (AppleScript)."); process.exit(1); }
  const inj = createInjector({ dispatch: bridgeDispatch() });
  inj.start();
  console.log(`Injecteur actif → ${BRIDGE}. ⌘+clic sur un élément dans Chrome, Arc ou Safari.`);
}
