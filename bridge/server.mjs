#!/usr/bin/env node
// Claude Bridge — serveur local (zéro dépendance) qui transforme chaque
// commentaire posé dans Chrome en session `claude`. Il garde les commentaires
// et fait tourner les sessions lui-même : rien ne dépend d'un onglet ouvert.
// Écoute uniquement sur 127.0.0.1.
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHistory } from "./history.mjs";

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 7823);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CONF_DIR = process.env.CLAUDE_BRIDGE_DIR || path.join(os.homedir(), ".claude-chrome-bridge");
const TOKEN_FILE = path.join(CONF_DIR, "token");
const DB_FILE = path.join(CONF_DIR, "comments.json");
const IMG_DIR = path.join(os.tmpdir(), "claude-chrome-bridge");
const MODES = new Set(["acceptEdits", "bypassPermissions"]);

fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(IMG_DIR, { recursive: true });
if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, randomBytes(24).toString("hex"), { mode: 0o600 });
const TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").trim();

// ---------- stockage des commentaires ----------
let comments = [];
try { comments = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {}
// Une session coupée par l'arrêt du bridge ne reprendra pas.
for (const c of comments) if (c.status === "running" || c.status === "queued") c.status = "error";
const MAX_CHILDREN = 8;
const isConv = (c) => c.kind === "conversation";
let saveTimer = null;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DB_FILE, JSON.stringify(comments)), 200);
};
const pageKey = (url) => String(url || "").split("#")[0];
const expandHome = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

// ---------- sessions claude ----------
const children = new Map(); // id commentaire -> process en cours
const queues = new Map();   // cwd -> Promise : un projet traite ses commentaires un par un

function enqueue(c, prompt) {
  c.status = "queued";
  persist();
  // Les conversations ne modifient rien : leur propre file, en parallèle des modifications.
  const key = isConv(c) ? c.cwd + "#conversation" : c.cwd;
  const next = (queues.get(key) || Promise.resolve()).then(() => run(c, prompt));
  queues.set(key, next.catch(() => {}));
}

function run(c, prompt) {
  if (!comments.includes(c)) return; // résolu entre-temps
  c.status = "running";
  persist();
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--add-dir", IMG_DIR];
  // Conversation : lecture seule (ce sont les commentaires enfants qui modifient le code).
  if (isConv(c)) args.push("--permission-mode", "default", "--disallowedTools", "Edit,Write,MultiEdit,NotebookEdit,Bash");
  else args.push("--permission-mode", c.mode);
  if (c.sessionId) args.push("--resume", c.sessionId);
  console.log(`[${isConv(c) ? "conversation" : "#" + c.n}] ${c.mode} @ ${c.cwd} — ${c.text.slice(0, 60)}`);

  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: c.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    children.set(c.id, child);
    const say = (role, text) => { c.messages.push({ role, text }); persist(); };
    let lastText = "";
    let buf = "", stderr = "", gotResult = false;

    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.session_id && c.sessionId !== ev.session_id) { c.sessionId = ev.session_id; persist(); }
        if (ev.type === "assistant") {
          for (const b of ev.message?.content || []) {
            if (b.type === "text" && b.text.trim()) {
              lastText = b.text;
              const shown = isConv(c) ? stripBlock(b.text) : b.text.trim();
              if (shown) say("assistant", shown);
            }
            if (b.type === "tool_use") {
              const i = b.input || {};
              let target = String(i.file_path || i.command || i.pattern || i.path || i.description || "");
              if (target.startsWith(c.cwd + "/")) target = target.slice(c.cwd.length + 1);
              c.messages.push({ role: "tool", id: b.id, name: b.name, target, running: true });
              persist();
            }
          }
        }
        // Résultat d'un outil : rattaché à sa ligne (affichée repliable dans le fil).
        if (ev.type === "user") {
          for (const b of ev.message?.content || []) {
            if (b.type !== "tool_result") continue;
            const m = c.messages.find((x) => x.id === b.tool_use_id);
            if (!m) continue;
            const out = Array.isArray(b.content) ? b.content.map((x) => x.text ?? "").join("\n") : String(b.content ?? "");
            Object.assign(m, { running: false, isError: !!b.is_error, output: out.slice(0, 2000) });
            persist();
          }
        }
        if (ev.type === "result") {
          gotResult = true;
          c.status = ev.is_error ? "error" : "done";
          if (ev.is_error && ev.result) say("error", ev.result);
          if (isConv(c) && !ev.is_error) applyBlock(c, String(ev.result || lastText));
          c.stats = [ev.total_cost_usd != null && `$${ev.total_cost_usd.toFixed(3)}`, ev.duration_ms && `${Math.round(ev.duration_ms / 1000)} s`].filter(Boolean).join(" · ");
          persist();
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { say("error", e.message); });
    child.on("close", (code) => {
      children.delete(c.id);
      for (const m of c.messages) if (m.running) m.running = false;
      c.finishedAt = Date.now(); // sert à marquer le commentaire « non lu »
      if (!gotResult) {
        c.status = "error";
        if (comments.includes(c)) say("error", stderr.trim().slice(-1500) || `claude s'est arrêté (code ${code})`);
      }
      persist();
      resolve();
    });
    child.stdin.end(prompt);
  });
}

function buildPrompt(b, imagePath) {
  return `Commentaire laissé dans Chrome sur un élément de la page ${b.url} (« ${b.title || ""} »).
Le code source de cette page se trouve dans le dossier courant. Trouve le code qui produit cet élément et applique la demande, en ne modifiant que le nécessaire. Termine par une ou deux phrases qui résument ce que tu as changé (et dans quel fichier).

Demande : ${b.text}

Élément ciblé :
- sélecteur CSS : ${b.selector}
- élément : ${b.label}
- ancêtres : ${b.ancestors || "—"}
- texte visible : ${b.visible || "—"}
- HTML rendu :
\`\`\`html
${String(b.html || "").slice(0, 4000)}
\`\`\`` + (imagePath ? `\n\nCapture d'écran de l'élément (contour orange) — lis-la avec l'outil Read :\n${imagePath}` : "");
}

// ---------- conversations ----------
// Une conversation (session « parente », lecture seule) analyse la page et propose
// des commentaires ancrés sur des éléments ; chacun devient une session enfant.
const BLOCK_RE = /<comments>\s*([\s\S]*?)\s*<\/comments>/g;
const stripBlock = (text) => text.replace(BLOCK_RE, "").replace(/<comments>[\s\S]*$/, "").trim();

const childrenOf = (conv) => comments.filter((x) => x.parentId === conv.id);
const nextN = (url) => Math.max(0, ...comments.filter((x) => x.url === url && !isConv(x)).map((x) => x.n || 0)) + 1;

function applyBlock(conv, text) {
  const blocks = [...String(text).matchAll(BLOCK_RE)];
  if (!blocks.length) return;
  let data;
  try {
    const raw = blocks[blocks.length - 1][1].replace(/^```\w*\s*|```$/g, "");
    data = JSON.parse(raw);
  } catch (e) {
    conv.messages.push({ role: "error", text: `Liste de commentaires illisible : ${e.message}` });
    return;
  }
  for (const n of Array.isArray(data.cancel) ? data.cancel : []) {
    const child = childrenOf(conv).find((x) => x.n === Number(n));
    if (child) removeComment(child.id);
  }
  const room = MAX_CHILDREN - childrenOf(conv).length;
  for (const item of (Array.isArray(data.add) ? data.add : []).slice(0, Math.max(0, room))) {
    const selector = String(item?.selector || "").trim();
    const request = String(item?.request || "").trim();
    if (!selector || !request) continue;
    const snap = conv.snapIndex?.[selector];
    comments.push({
      id: randomUUID(), n: nextN(conv.url), parentId: conv.id, kind: "comment",
      url: conv.url, cwd: conv.cwd, selector, label: String(item.label || snap?.label || selector.split(" > ").pop()),
      text: request, mode: conv.childMode || "acceptEdits",
      status: conv.autoLaunch ? "queued" : "proposed", sessionId: null, messages: [], createdAt: Date.now(),
    });
    const child = comments[comments.length - 1];
    if (conv.autoLaunch) enqueue(child, buildChildPrompt(child, conv, null));
  }
  persist();
}

function removeComment(id) {
  const c = comments.find((x) => x.id === id);
  if (!c) return;
  const ids = new Set([id, ...(isConv(c) ? childrenOf(c).map((x) => x.id) : [])]);
  comments = comments.filter((x) => !ids.has(x.id));
  for (const i of ids) children.get(i)?.kill("SIGTERM");
  persist();
}

// Instantané du DOM : on garde un index sélecteur → libellé pour nommer les enfants.
function indexSnapshot(conv, snapshot) {
  const index = {};
  for (const line of String(snapshot || "").split("\n")) {
    const m = /^\s*\[([^\]]+)\]\s+(\S+)/.exec(line);
    if (m) index[m[1]] = { label: m[2] };
  }
  conv.snapIndex = index;
}
function saveImage(id, dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const p = path.join(IMG_DIR, `${id}-${Date.now()}.png`);
  fs.writeFileSync(p, Buffer.from(m[1], "base64"));
  return p;
}
const childList = (conv) => {
  const list = childrenOf(conv);
  return list.length ? list.map((x) => `- n°${x.n} [${x.selector}] (${x.status}) : ${x.text}`).join("\n") : "aucun";
};
const pageContext = (b, imagePath) =>
  (imagePath ? `\nCapture d'écran de la partie visible de la page — lis-la avec l'outil Read :\n${imagePath}\n` : "") +
  (b.snapshot ? `\nInstantané du DOM (indentation = imbrication ; [sélecteur CSS] élément « texte » · boîte et styles utiles) :\n\`\`\`\n${String(b.snapshot).slice(0, 60000)}\n\`\`\`\n` : "");

const FORMAT = `Termine TOUJOURS ta réponse par ce bloc (JSON valide, rien après) :
<comments>
{"add": [{"selector": "…", "label": "…", "request": "…"}], "cancel": []}
</comments>
- selector : recopié tel quel depuis l'instantané (entre crochets) ; label : nom court de l'élément.
- request : consigne autonome et précise, en français, pour modifier cet élément (elle sera lue par une session sans autre contexte que l'élément et le code).
- Un commentaire par élément et par changement cohérent, ${MAX_CHILDREN} au maximum, sans doublon avec les commentaires existants.
- cancel : numéros (n°) de commentaires existants à retirer si l'utilisateur le demande.
- Rien à proposer : {"add": [], "cancel": []}.`;

function buildConversationPrompt(b, conv, imagePath) {
  return `Conversation ouverte depuis Chrome sur la page ${conv.url} (« ${b.title || ""} »).
Le code source de cette page se trouve dans le dossier courant. Tu peux le lire (Read, Grep, Glob) mais tu ne modifies AUCUN fichier : les changements sont faits par des commentaires que tu proposes, chacun ancré sur un élément de la page puis traité par une session Claude séparée, après validation de l'utilisateur.

Réponds en français, brièvement (quelques phrases ou une courte liste), puis propose les commentaires.

${FORMAT}

Demande de l'utilisateur : ${b.text}
${pageContext(b, imagePath)}`;
}

function buildFollowUpPrompt(b, conv, imagePath) {
  return `${b.text}

Commentaires actuels de cette conversation :
${childList(conv)}
${pageContext(b, imagePath)}
Rappel : ne modifie aucun fichier, et termine par le bloc <comments>…</comments> (add / cancel).`;
}

function buildChildPrompt(child, conv, d) {
  d = d || {};
  return `Commentaire proposé dans une revue de la page ${child.url}, sur un élément précis.
Le code source de cette page se trouve dans le dossier courant. Trouve le code qui produit cet élément et applique la demande, en ne modifiant que le nécessaire. Termine par une ou deux phrases qui résument ce que tu as changé (et dans quel fichier).

Demande : ${child.text}

Contexte de la revue : ${conv?.text || "—"}

Élément ciblé :
- sélecteur CSS : ${child.selector}
- élément : ${d.label || child.label}
- ancêtres : ${d.ancestors || "—"}
- texte visible : ${d.visible || "—"}` + (d.html ? `\n- HTML rendu :\n\`\`\`html\n${String(d.html).slice(0, 4000)}\n\`\`\`` : "");
}

// Dossier du projet servi sur un port local : dossier du process qui écoute,
// remonté jusqu'à la racine git (utile dans un monorepo).
function detectProject(port) {
  if (!/^\d+$/.test(port)) return null;
  try {
    const pid = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeout: 3000 }).toString().split("\n")[0].trim();
    const out = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { timeout: 3000 }).toString();
    let dir = out.split("\n").find((l) => l.startsWith("n"))?.slice(1);
    if (!dir) return null;
    for (let d = dir; d !== path.dirname(d); d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, ".git"))) return d;
    }
    return dir;
  } catch { return null; }
}

// ---------- HTTP ----------
function authorized(req) {
  // Chrome n'envoie pas toujours l'en-tête Origin depuis le service worker de l'extension :
  // on refuse seulement une origine web explicite. Le token reste la vraie protection.
  const origin = String(req.headers.origin || "");
  if (origin && !origin.startsWith("chrome-extension://")) return false;
  const got = Buffer.from(String(req.headers["x-bridge-token"] || ""));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 30_000_000) throw new Error("requête trop lourde");
  }
  return data ? JSON.parse(data) : {};
}
const publicView = ({ id, n, kind, parentId, url, title, selector, label, text, status, stats, messages, cwd, createdAt, finishedAt }) =>
  ({ id, n, kind: kind || "comment", parentId, url, title, selector, label, text, status, stats, messages, cwd, createdAt, finishedAt });

function launch(list, details, extra, mode) {
  for (const c of list) {
    const conv = comments.find((x) => x.id === c.parentId);
    if (MODES.has(mode)) c.mode = mode;
    if (extra) c.text += "\n\n" + extra;
    enqueue(c, buildChildPrompt(c, conv, details[c.id]));
  }
  return [200, list.length === 1 ? publicView(list[0]) : { launched: list.length }];
}

const routes = {
  "GET /health": () => [200, { ok: true, running: children.size }],

  "GET /detect": (_, url) => [200, { cwd: detectProject(url.searchParams.get("port")) }],

  // Tous les commentaires, sans le détail des messages (pour la vue d'ensemble).
  "GET /all": () => [200, comments.map(({ messages, ...c }) => publicView({ ...c, messages: undefined }))],

  "GET /comments": (_, url) => {
    const key = pageKey(url.searchParams.get("url"));
    return [200, comments.filter((c) => c.url === key).map(publicView)];
  },

  "POST /comments": (b) => {
    const text = String(b.text || "").trim();
    if (!text) return [400, { error: "commentaire vide" }];
    const cwd = path.resolve(expandHome(String(b.cwd || "").trim()));
    if (!b.cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return [400, { error: `dossier introuvable : ${b.cwd || "(vide)"}` }];
    const url = pageKey(b.url);
    const c = {
      id: randomUUID(), n: nextN(url), kind: "comment",
      url, cwd, selector: String(b.selector || ""), label: String(b.label || ""), text,
      mode: MODES.has(b.mode) ? b.mode : "acceptEdits", status: "queued", sessionId: null,
      messages: [], createdAt: Date.now(),
    };
    let imagePath = null;
    const m = /^data:image\/png;base64,(.+)$/.exec(String(b.image || ""));
    if (m) {
      imagePath = path.join(IMG_DIR, `${c.id}.png`);
      fs.writeFileSync(imagePath, Buffer.from(m[1], "base64"));
    }
    comments.push(c);
    enqueue(c, buildPrompt({ ...b, text }, imagePath));
    return [200, publicView(c)];
  },

  "POST /reply": (b) => {
    const c = comments.find((x) => x.id === b.id);
    const text = String(b.text || "").trim();
    if (!c || !text) return [404, { error: "commentaire introuvable" }];
    // Répondre à un commentaire proposé = le lancer avec cette précision.
    if (c.status === "proposed") return launch([c], { [c.id]: b.detail }, text, b.mode);
    c.messages.push({ role: "user", text });
    if (isConv(c)) {
      if (MODES.has(b.mode)) c.childMode = b.mode;
      if (b.snapshot) indexSnapshot(c, b.snapshot);
      enqueue(c, buildFollowUpPrompt({ ...b, text }, c, saveImage(c.id, b.image)));
    } else {
      if (MODES.has(b.mode)) c.mode = b.mode;
      enqueue(c, text);
    }
    return [200, publicView(c)];
  },

  // Nouvelle conversation sur une page : session parente en lecture seule.
  "POST /conversations": (b) => {
    const text = String(b.text || "").trim();
    if (!text) return [400, { error: "message vide" }];
    const cwd = path.resolve(expandHome(String(b.cwd || "").trim()));
    if (!b.cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return [400, { error: `dossier introuvable : ${b.cwd || "(vide)"}` }];
    const conv = {
      id: randomUUID(), kind: "conversation", url: pageKey(b.url), title: String(b.title || ""), cwd, selector: "", label: "",
      text, mode: "default", childMode: MODES.has(b.mode) ? b.mode : "acceptEdits", autoLaunch: !!b.autoLaunch,
      status: "queued", sessionId: null, messages: [], createdAt: Date.now(),
    };
    indexSnapshot(conv, b.snapshot);
    comments.push(conv);
    enqueue(conv, buildConversationPrompt({ ...b, text }, conv, saveImage(conv.id, b.image)));
    return [200, publicView(conv)];
  },

  // Lance des commentaires proposés : un seul (id) ou tous ceux d'une conversation (parentId).
  // details : { id: description de l'élément prise dans la page } (facultatif).
  "POST /launch": (b) => {
    const list = comments.filter((x) => x.status === "proposed" && (b.id ? x.id === b.id : b.parentId && x.parentId === b.parentId));
    if (!list.length) return [404, { error: "aucun commentaire à lancer" }];
    return launch(list, b.details || {}, String(b.text || "").trim(), b.mode);
  },

  "POST /resolve": (b) => {
    removeComment(b.id);
    return [200, { ok: true }];
  },
};

// Historique (bridge/history.mjs) : « Résoudre » archive ; /history, /comment, /reopen.
Object.assign(routes, createHistory({
  dir: CONF_DIR, active: () => comments, stop: (id) => children.get(id)?.kill("SIGTERM"),
  persist, view: publicView, nextN, reply: (b) => routes["POST /reply"](b),
}).routes);

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "");
  if (origin.startsWith("chrome-extension://")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-bridge-token");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (!authorized(req)) return json(res, 401, { error: "non autorisé (token ou origine)" });
  try {
    const url = new URL(req.url, "http://localhost");
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return json(res, 404, { error: "not found" });
    const [code, body] = route(req.method === "POST" ? await readBody(req) : null, url);
    json(res, code, body);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Claude Bridge → http://127.0.0.1:${PORT}`);
  console.log(`Token (à coller dans l'extension) : ${TOKEN}`);
});
