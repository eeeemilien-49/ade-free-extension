// Faux chrome.runtime / chrome.storage pour la page de test du calque.
// Données réalistes dans tous les états ; progression simulée (désactivable : ?sim=0).
(() => {
  const params = new URLSearchParams(location.search);
  if (params.has("aggressive")) document.getElementById("aggressive").media = "all";
  const SIM = params.get("sim") !== "0";
  const url = location.href.split("#")[0];
  const now = Date.now();
  const tool = (id, name, target, extra = {}) => ({ role: "tool", id, name, target, ...extra });

  let comments = [
    {
      id: "c1", n: 1, kind: "comment", url, selector: "header nav a.cta", label: "a.cta",
      text: "Le bouton « Essayer » doit être plus visible : fond plein, coins arrondis 8px.",
      status: "done", stats: "$0.042 · 23 s", createdAt: now - 600000, finishedAt: now - 540000,
      messages: [
        tool("t1", "Grep", "cta", { output: "src/components/Header.tsx:18:  <a className=\"cta\" href=\"/essai\">Essayer</a>\nsrc/styles/header.css:42:.cta {" }),
        tool("t2", "Read", "src/components/Header.tsx", { output: "1  import { Link } from \"./Link\";\n2  …" }),
        tool("t3", "Read", "src/styles/header.css", { output: "40 nav a { color: var(--muted); }\n42 .cta { border: 1px solid; border-radius: 999px; }" }),
        tool("t4", "Edit", "src/styles/header.css"),
        tool("t5", "Edit", "src/components/Header.tsx"),
        { role: "assistant", text: "J'ai passé le bouton en fond plein (`--fg` sur `--bg`) avec `border-radius: 8px` et un padding de `8px 14px`.\n\nLe survol assombrit le fond de 8 %. Rien d'autre n'a bougé dans l'en-tête." },
      ],
    },
    {
      id: "c2", n: 2, kind: "comment", url, selector: ".hero h1", label: "h1",
      text: "Titre trop long : une seule ligne sur desktop, et un peu moins gros.",
      status: "running", createdAt: now - 60000,
      messages: [
        tool("t6", "Grep", "Des outils de céramique", { output: "src/pages/index.tsx:12" }),
        tool("t7", "Read", "src/pages/index.tsx", { output: "…" }),
        tool("t8", "Read", "src/styles/hero.css", { output: "…" }),
        tool("t9", "Bash", "npm run lint -- src/pages", { output: "✔ 0 problème" }),
        { role: "assistant", text: "Je raccourcis le titre et je passe la taille à 44px avec `text-wrap: balance`." },
        tool("t10", "Edit", "src/styles/hero.css", { running: true }),
      ],
    },
    {
      id: "c3", n: 3, kind: "comment", url, selector: ".hero p", label: "p",
      text: "Rapprocher ce paragraphe du titre (16px).", status: "queued", createdAt: now - 30000, messages: [],
    },
    {
      id: "c4", n: 4, kind: "comment", url, selector: ".cards > .card:nth-child(2) button", label: "button",
      text: "Mettre ce bouton en avant, c'est l'offre recommandée.", status: "error", stats: "$0.011 · 600 s", createdAt: now - 900000, finishedAt: now - 300000,
      messages: [
        tool("t11", "Read", "src/components/PricingCard.tsx", { output: "…" }),
        tool("t12", "Bash", "npm test -- PricingCard", { isError: true, output: "FAIL src/components/PricingCard.test.tsx\n  ✕ affiche le prix (12 ms)\n\n  Expected: \"29 €\"\n  Received: \"29€\"" }),
        { role: "error", text: "Session interrompue : délai dépassé (600 s)." },
      ],
    },
    {
      id: "conv1", n: 0, kind: "conversation", url, selector: "", label: "",
      text: "Rends la section tarifs plus lisible sur mobile.", status: "done", createdAt: now - 200000, finishedAt: now - 150000, messages: [],
    },
    {
      id: "c5", n: 5, kind: "comment", parentId: "conv1", url, selector: ".pricing h2", label: "h2",
      text: "Réduire le titre de section à 28px sous 640px de large.", status: "proposed", createdAt: now - 150000, messages: [],
    },
    {
      id: "c6", n: 6, kind: "comment", parentId: "conv1", url, selector: ".cards > .card:nth-child(1) ul", label: "ul",
      text: "Espacer les puces de 8px pour qu'elles respirent.", status: "proposed", createdAt: now - 150000, messages: [],
    },
    {
      id: "c7", n: 7, kind: "comment", url, selector: "footer a:nth-of-type(1)", label: "a", text: "Souligner au survol seulement.",
      status: "done", stats: "$0.008 · 9 s", finishedAt: now - 100000, messages: [tool("t13", "Edit", "src/styles/footer.css"), { role: "assistant", text: "Fait." }],
    },
    {
      id: "c8", n: 8, kind: "comment", url, selector: "footer a:nth-of-type(2)", label: "a", text: "Lien vers /contact au lieu de mailto.",
      status: "done", stats: "$0.006 · 7 s", finishedAt: now - 90000,
      messages: [
        tool("t14", "Edit", "src/components/Footer.tsx"), { role: "assistant", text: "Le lien pointe vers `/contact`." },
        { role: "user", text: "Et ouvre-le dans le même onglet." },
        tool("t15", "Edit", "src/components/Footer.tsx"), { role: "assistant", text: "C'est déjà le cas : pas de `target` sur le lien. Rien à changer." },
      ],
    },
    { id: "c9", n: 9, kind: "comment", url, selector: "footer a:nth-of-type(3)", label: "a", text: "CGV en PDF.", status: "done", finishedAt: now - 80000, messages: [{ role: "assistant", text: "Ok." }] },
    { id: "c10", n: 10, kind: "comment", url, selector: ".cards > .card:nth-child(3) .price", label: "div.price", text: "Prix en gras 800.", status: "done", finishedAt: now - 70000, messages: [{ role: "assistant", text: "Ok." }] },
  ];

  const patch = `diff --git a/src/styles/header.css b/src/styles/header.css
--- a/src/styles/header.css
+++ b/src/styles/header.css
@@ -40,6 +40,14 @@ nav a { color: var(--muted); }
 .cta {
-  border: 1px solid;
-  border-radius: 999px;
+  background: var(--fg);
+  color: var(--bg);
+  border: 0;
+  border-radius: 8px;
+  padding: 8px 14px;
+}
+.cta:hover {
+  background: color-mix(in oklch, var(--fg) 92%, black);
 }
diff --git a/src/components/Header.tsx b/src/components/Header.tsx
--- a/src/components/Header.tsx
+++ b/src/components/Header.tsx
@@ -16,3 +16,3 @@ export function Header() {
-      <a className="cta" href="/essai">Essayer</a>
+      <a className="cta" href="/essai" data-variant="solid">Essayer</a>
`;
  const diffs = {
    c1: { enabled: true, reverted: false, add: 9, del: 3, patch, files: [{ path: "src/styles/header.css", add: 8, del: 2 }, { path: "src/components/Header.tsx", add: 1, del: 1 }] },
    c8: { enabled: true, reverted: true, add: 1, del: 1, patch: "", files: [{ path: "src/components/Footer.tsx", add: 1, del: 1 }] },
    c4: { enabled: true, reverted: false, add: 0, del: 0, files: [] },
  };

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const find = (id) => comments.find((c) => c.id === id);
  const later = (ms, fn) => SIM && setTimeout(fn, ms);
  let nextN = 11;

  function run(c, steps) {
    c.status = "queued";
    later(1200, () => { c.status = "running"; });
    steps.forEach(([ms, fn]) => later(ms, fn));
  }

  const handlers = {
    list: () => ({ comments: clone(comments), cwd: "~/atelier" }),
    seen: () => null,
    diff: ({ id }) => clone(diffs[id] || { enabled: true, files: [] }),
    async revert({ id }) { await new Promise((r) => setTimeout(r, 700)); diffs[id].reverted = true; return clone(diffs[id]); },
    async create({ comment, cwd }) {
      await new Promise((r) => setTimeout(r, 400));
      if (params.has("nocwd") && !cwd) throw new Error("Indique le dossier du projet.");
      const c = { id: "n" + nextN, n: nextN++, kind: "comment", url, selector: comment.selector, label: comment.label, text: comment.text, status: "queued", messages: [], createdAt: Date.now() };
      comments.push(c);
      run(c, [
        [2000, () => c.messages.push(tool("x1" + c.id, "Grep", comment.label, { running: true }))],
        [3200, () => { c.messages.at(-1).running = false; c.messages.at(-1).output = "src/App.tsx:4"; c.messages.push(tool("x2" + c.id, "Edit", "src/App.tsx", { running: true })); }],
        [5200, () => { c.messages.at(-1).running = false; c.messages.push({ role: "assistant", text: "C'est fait : j'ai ajusté `src/App.tsx`." }); c.status = "done"; c.stats = "$0.010 · 5 s"; c.finishedAt = Date.now(); }],
      ]);
      return clone(c);
    },
    async reply({ id, text }) {
      await new Promise((r) => setTimeout(r, 300));
      if (text === "erreur") throw new Error("Bridge injoignable : l'app est-elle ouverte ?");
      const c = find(id);
      if (c.status === "proposed") { c.text += "\n\n" + text; c.status = "queued"; }
      else c.messages.push({ role: "user", text });
      run(c, [[3500, () => { c.messages.push({ role: "assistant", text: "Bien noté, c'est ajusté." }); c.status = "done"; c.finishedAt = Date.now(); }]]);
      return clone(c);
    },
    async launch({ id }) {
      await new Promise((r) => setTimeout(r, 300));
      const c = find(id);
      run(c, [[4000, () => { c.messages.push(tool("l" + id, "Edit", "src/styles/pricing.css"), { role: "assistant", text: "Appliqué." }); c.status = "done"; c.finishedAt = Date.now(); }]]);
      return clone(c);
    },
    resolve: ({ id }) => { const c = find(id); comments = comments.filter((x) => x !== c); handlers.resolved[id] = c; return { ok: true }; },
    resolved: {},
    reopen: ({ id }) => { const c = handlers.resolved[id]; if (c) comments.push(c); return clone(c); },
    async openApp() { await new Promise((r) => setTimeout(r, 800)); return {}; },
  };

  // c2 (en cours) finit tout seul : on voit le toast de fin.
  later(9000, () => {
    const c = find("c2");
    if (!c) return;
    c.messages.at(-1).running = false;
    c.messages.push(tool("t16", "Edit", "src/pages/index.tsx"), { role: "assistant", text: "Titre raccourci (« Outils de céramique pour la vie ») et passé à **44px**, sur une ligne au-delà de 1024px." });
    c.status = "done"; c.stats = "$0.031 · 71 s"; c.finishedAt = Date.now();
    diffs.c2 = { enabled: true, add: 4, del: 2, patch: "", files: [{ path: "src/styles/hero.css", add: 3, del: 1 }, { path: "src/pages/index.tsx", add: 1, del: 1 }] };
  });

  const listeners = [];
  window.chrome = {
    runtime: {
      async sendMessage(msg) {
        const h = handlers[msg.type];
        if (!h) return { error: "type inconnu : " + msg.type };
        try { return { data: await h(msg) }; } catch (e) { return { error: e.message, code: e.code }; }
      },
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
    storage: {
      local: {
        async get() { const n = params.get("open"); const c = n && comments.find((x) => String(x.n) === n); return c ? { pendingOpen: { url, id: c.id } } : {}; },
        async remove() { params.delete("open"); },
        async set() {},
      },
    },
  };
  window.__mock = { comments: () => comments, handlers };
})();
