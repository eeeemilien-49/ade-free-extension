// Historique : « Résoudre » archive au lieu de supprimer. Les éléments résolus
// quittent le tableau actif (routes /comments et /all inchangées) et vont dans
// history.json, à côté de comments.json (dont le format ne change pas).
import fs from "node:fs";
import path from "node:path";

const BUSY = new Set(["running", "queued"]);
const pageKey = (url) => String(url || "").split("#")[0];

/**
 * @param {object} o
 * @param {string} o.dir           dossier de données du bridge
 * @param {() => object[]} o.active  tableau des éléments actifs (muté sur place)
 * @param {(id: string) => void} o.stop     arrête la session en cours d'un élément
 * @param {() => void} o.persist   sauvegarde des éléments actifs
 * @param {(c: object) => object} o.view    vue publique d'un élément
 * @param {(url: string) => number} o.nextN prochain numéro libre sur une page
 * @param {(b: object) => [number, object]} o.reply  route POST /reply (reprise avec texte)
 */
export function createHistory({ dir, active, stop, persist, view, nextN, reply }) {
  const FILE = path.join(dir, "history.json");
  let archived = [];
  try { archived = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  if (!Array.isArray(archived)) archived = [];

  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fs.writeFileSync(FILE, JSON.stringify(archived)), 200);
  };

  const isConv = (c) => c.kind === "conversation";
  const finalText = (c) => [...(c.messages || [])].reverse().find((m) => m.role === "assistant")?.text || "";
  const summary = (c) => {
    const { messages, ...rest } = view(c);
    return { ...rest, resolvedAt: c.resolvedAt, final: finalText(c), children: archived.filter((x) => x.resolvedWith === c.id).length };
  };

  // Copie figée : la session arrêtée peut encore écrire dans l'objet actif.
  const freeze = (c, now, withId) => ({
    ...c,
    status: BUSY.has(c.status) ? "stopped" : c.status,
    messages: (c.messages || []).map((m) => (m.running ? { ...m, running: false } : m)),
    resolvedAt: now,
    ...(withId ? { resolvedWith: withId } : {}),
  });

  function resolve(id) {
    const list = active();
    const c = list.find((x) => x.id === id);
    if (!c) return [200, { ok: true }];
    const now = Date.now();
    const group = [c, ...(isConv(c) ? list.filter((x) => x.parentId === c.id) : [])];
    for (const x of group) {
      archived.push(freeze(x, now, x === c ? null : c.id));
      list.splice(list.indexOf(x), 1);
      stop(x.id);
    }
    persist();
    save();
    return [200, { ok: true, archived: group.length }];
  }

  // Remet un élément (et les enfants archivés avec lui) dans les actifs.
  function reopen(b) {
    const i = archived.findIndex((x) => x.id === b.id);
    if (i < 0) return [404, { error: "élément introuvable dans l'historique" }];
    const c = archived[i];
    const group = [c, ...archived.filter((x) => x.resolvedWith === c.id)];
    archived = archived.filter((x) => !group.includes(x));
    const list = active();
    for (const x of group) {
      const { resolvedAt, resolvedWith, ...rest } = x;
      if (rest.status === "stopped") rest.status = "error";
      // Numéro déjà repris par un autre commentaire de la page : on en prend un libre.
      if (!isConv(rest) && list.some((y) => y.url === rest.url && !isConv(y) && y.n === rest.n)) rest.n = nextN(rest.url);
      list.push(rest);
    }
    persist();
    save();
    const text = String(b.text || "").trim();
    const reopened = list.find((x) => x.id === c.id);
    if (text) return reply({ ...b, id: c.id, text });
    return [200, view(reopened)];
  }

  function history(_, url) {
    const p = url.searchParams;
    const cwd = p.get("cwd"), page = p.get("url") && pageKey(p.get("url"));
    const q = (p.get("q") || "").trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(p.get("limit")) || 50));
    const offset = Math.max(0, Number(p.get("offset")) || 0);
    const haystack = (c) => [c.text, c.label, ...(c.messages || []).filter((m) => m.role === "user" || m.role === "assistant").map((m) => m.text)]
      .join("\n").toLowerCase();
    const items = archived
      .filter((c) => !c.resolvedWith)
      .filter((c) => (!cwd || c.cwd === cwd) && (!page || c.url === page))
      .filter((c) => !q || haystack(c).includes(q) || archived.some((x) => x.resolvedWith === c.id && haystack(x).includes(q)))
      .sort((a, b) => b.resolvedAt - a.resolvedAt);
    return [200, { total: items.length, offset, limit, items: items.slice(offset, offset + limit).map(summary) }];
  }

  // Détail complet (actif ou archivé), avec les enfants d'une conversation.
  function detail(_, url) {
    const id = url.searchParams.get("id");
    const live = active().find((x) => x.id === id);
    const c = live || archived.find((x) => x.id === id);
    if (!c) return [404, { error: "élément introuvable" }];
    const kids = (live ? active().filter((x) => x.parentId === id) : archived.filter((x) => x.resolvedWith === id));
    return [200, { ...view(c), resolvedAt: c.resolvedAt || null, children: kids.map((x) => ({ ...view(x), resolvedAt: x.resolvedAt || null })) }];
  }

  return {
    routes: {
      "POST /resolve": (b) => resolve(b.id),
      "POST /reopen": reopen,
      "GET /history": history,
      "GET /comment": detail,
    },
  };
}
