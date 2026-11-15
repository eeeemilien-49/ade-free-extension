// Diffs par commentaire : instantané git du projet avant / après chaque session,
// sans rien commiter ni toucher à l'index de l'utilisateur (index temporaire +
// `git write-tree` : les fichiers non suivis non ignorés sont inclus).
// Projet hors git : tout est désactivé silencieusement.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_PATCH = 256 * 1024; // patch stocké par session (au-delà : recalculé depuis les arbres)
const MAX_SHOWN = 200 * 1024; // patch renvoyé à l'extension

const git = (cwd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000, ...opts }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr) })) : resolve(String(stdout)));
  });
const gitSync = (cwd, args, input) =>
  execFileSync("git", ["-C", cwd, ...args], { input, maxBuffer: 64 * 1024 * 1024, timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] }).toString();

// Racine du dépôt, ou null hors git.
async function repoRoot(cwd) {
  try { return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null; } catch { return null; }
}

// Arbre git de l'état courant du dossier de travail (suivis + non suivis non ignorés).
async function snapshot(root) {
  const tmp = path.join(os.tmpdir(), `claude-bridge-index-${randomUUID()}`);
  try {
    // On part d'une copie de l'index réel : son cache stat évite de tout relire.
    const real = path.resolve(root, (await git(root, ["rev-parse", "--git-path", "index"])).trim());
    if (fs.existsSync(real)) fs.copyFileSync(real, tmp);
    const env = { ...process.env, GIT_INDEX_FILE: tmp };
    await git(root, ["add", "-A", "--", "."], { env });
    return (await git(root, ["write-tree"], { env })).trim();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function parseNumstat(out) {
  return out.split("\n").filter(Boolean).map((line) => {
    const [a, d, ...rest] = line.split("\t");
    let file = rest.join("\t");
    // Renommage « a => b » ou « dir/{a => b}/x » : on garde la destination.
    if (file.includes(" => ")) file = file.replace(/\{[^}]*? => ([^}]*)\}/, "$1").replace(/^.* => /, "").replace(/\/\//g, "/");
    return a === "-" ? { path: file, add: 0, del: 0, binary: true } : { path: file, add: Number(a), del: Number(d) };
  });
}

// Entoure une session : instantané avant, puis diff de ce seul run enregistré dans c.diffs.
export async function track(c, fn, save) {
  if (c.kind === "conversation") return fn();
  let root = null, before = null;
  try {
    root = await repoRoot(c.cwd);
    if (root) before = await snapshot(root);
  } catch (e) { console.warn(`[diff] instantané impossible : ${e.message}`); }
  if (!before) return fn();
  c.diffPending = true;
  try {
    await fn();
  } finally {
    try {
      const after = await snapshot(root);
      if (after !== before) {
        const files = parseNumstat(await git(root, ["diff", "--numstat", "-M", before, after]));
        const patch = await git(root, ["diff", "--binary", "--full-index", before, after]);
        (c.diffs ||= []).push({
          root, before, after, files, at: Date.now(),
          patch: patch.length <= MAX_PATCH ? patch : null,
        });
      }
    } catch (e) { console.warn(`[diff] diff impossible : ${e.message}`); }
    delete c.diffPending;
    save();
  }
}

const patchOf = (run) => run.patch ?? gitSync(run.root, ["diff", "--binary", "--full-index", run.before, run.after]);

// Vue agrégée des sessions non annulées d'un commentaire.
export function diffView(c) {
  const runs = c.diffs || [];
  const live = runs.filter((r) => !r.reverted);
  const shown = live.length ? live : runs; // tout annulé : on montre ce qui l'a été
  const byPath = new Map();
  for (const r of shown) for (const f of r.files) {
    const cur = byPath.get(f.path) || { path: f.path, add: 0, del: 0 };
    cur.add += f.add; cur.del += f.del; if (f.binary) cur.binary = true;
    byPath.set(f.path, cur);
  }
  const files = [...byPath.values()];
  let patch = "";
  try { patch = shown.map(patchOf).join(""); } catch { patch = ""; }
  return {
    enabled: runs.length > 0 || !!c.diffPending,
    pending: !!c.diffPending,
    reverted: runs.length > 0 && !live.length,
    files,
    add: files.reduce((s, f) => s + f.add, 0),
    del: files.reduce((s, f) => s + f.del, 0),
    patch: patch.length > MAX_SHOWN ? patch.slice(0, MAX_SHOWN) : patch,
    truncated: patch.length > MAX_SHOWN,
  };
}

// Annule les sessions non annulées, de la plus récente à la plus ancienne.
// Chaque patch inverse est vérifié avant d'être appliqué (dossier de travail seulement,
// l'index de l'utilisateur n'est pas touché) ; au moindre conflit on remet tout comme avant.
export function revert(c) {
  const live = (c.diffs || []).filter((r) => !r.reverted).reverse();
  if (!live.length) return [409, { error: c.diffs?.length ? "déjà annulé" : "aucun changement enregistré" }];
  const done = [];
  for (const r of live) {
    const patch = patchOf(r);
    try {
      gitSync(r.root, ["apply", "-R", "--check", "--whitespace=nowarn", "-"], patch);
      gitSync(r.root, ["apply", "-R", "--whitespace=nowarn", "-"], patch);
      done.push([r, patch]);
    } catch (e) {
      for (const [d, p] of done.reverse()) { try { gitSync(d.root, ["apply", "--whitespace=nowarn", "-"], p); } catch {} }
      const why = String(e.stderr || e.message).split("\n").find((l) => /error:/.test(l)) || "";
      return [409, { error: "Conflit : les fichiers ont changé depuis. " + why.replace(/^error:\s*/, "").trim() }];
    }
  }
  for (const [r] of done) r.reverted = Date.now();
  return [200, diffView(c)];
}

// Routes à ajouter au bridge : GET /diff?id=…  et  POST /revert {id}.
export function diffRoutes(getComments, save) {
  const byId = (id) => getComments().find((x) => x.id === id);
  for (const c of getComments()) delete c.diffPending; // run coupé par un redémarrage
  return {
    "GET /diff": (_, url) => {
      const c = byId(url.searchParams.get("id"));
      return c ? [200, diffView(c)] : [404, { error: "commentaire introuvable" }];
    },
    "POST /revert": (b) => {
      const c = byId(b.id);
      if (!c) return [404, { error: "commentaire introuvable" }];
      if (c.status === "running" || c.status === "queued" || c.diffPending) return [409, { error: "session en cours" }];
      const out = revert(c);
      if (out[0] === 200) save();
      return out;
    },
  };
}
