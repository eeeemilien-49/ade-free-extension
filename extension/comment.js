// Script de page : ⌘+clic (Ctrl+clic hors Mac) sur un élément pour le commenter.
// Les commentaires non résolus ont une pastille et font scintiller leur élément ;
// cliquer la pastille ouvre le fil de discussion avec Claude.
// UI inspirée de shadcn AI Elements (Prompt Input, Message, Trace/Tool, Shimmer),
// dans un shadow DOM pour ne pas hériter des styles de la page.
(() => {
  if (window.__claudeComments || window.top !== window) return;
  window.__claudeComments = true;

  // Icônes Lucide (24×24, trait).
  const ICON = {
    send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    target: '<circle cx="12" cy="12" r="10"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8M16 17H8M10 9H8"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    play: '<path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5Z"/>',
    diff: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6M12 13V7M9 17h6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  };
  const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  // Libellés des outils : présent pendant l'exécution, passé une fois fini.
  const TOOLS = {
    Read: ["file", "Lecture de", "Lu"],
    Edit: ["edit", "Modification de", "Modifié"], MultiEdit: ["edit", "Modification de", "Modifié"],
    Write: ["edit", "Écriture de", "Écrit"], NotebookEdit: ["edit", "Modification de", "Modifié"],
    Bash: ["terminal", "Exécution de", "Exécuté"],
    Grep: ["search", "Recherche de", "Recherché"], Glob: ["search", "Recherche de", "Recherché"],
  };

  const host = document.createElement("claude-comments");
  host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host {
        /* Jetons shadcn (neutral) */
        --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
        --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
        --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
        --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0);
        --accent: oklch(0.97 0 0); --destructive: oklch(0.577 0.245 27.325);
        --success: oklch(0.6 0.15 150);
        --radius: 10px;
        /* Repères posés sur la page : couleur de marque, visible sur tout fond */
        --brand: #d97757;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --background: oklch(0.205 0 0); --foreground: oklch(0.985 0 0);
          --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0);
          --border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%); --ring: oklch(0.556 0 0);
          --primary: oklch(0.922 0 0); --primary-foreground: oklch(0.205 0 0);
          --accent: oklch(0.269 0 0); --destructive: oklch(0.704 0.191 22.216);
          --success: oklch(0.72 0.15 150);
        }
      }
      * { box-sizing: border-box; margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        font-size: 13px; line-height: 1.5; letter-spacing: 0; }
      code, pre, .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
      .i { width: 14px; height: 14px; flex: none; }
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ---- repères sur la page ---- */
      .hl { position: fixed; display: none; border: 1.5px solid var(--brand); background: color-mix(in oklch, var(--brand) 8%, transparent); border-radius: 4px; }
      .hl .tag { position: absolute; bottom: 100%; left: -1.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;
        background: var(--brand); color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
      /* Contour de l'élément : scintille seulement pendant le travail, fixe sinon. */
      .glow { position: fixed; border-radius: 4px; overflow: hidden; outline: 1px solid color-mix(in oklch, var(--brand) 35%, transparent); }
      .glow.running { animation: breathe 2.4s ease-in-out infinite; }
      .glow.done { outline: 1.5px solid var(--success); }
      .glow.error { outline: 1.5px solid var(--destructive); }
      .glow:not(.running)::after { display: none; }
      .pin.done { background: var(--success); color: #fff; }
      .glow::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(100deg, transparent 20%, color-mix(in oklch, var(--brand) 16%, transparent) 50%, transparent 80%);
        animation: sweep 2.4s ease-in-out infinite; }
      @keyframes sweep { to { transform: translateX(100%); } }
      @keyframes breathe { 50% { outline-color: color-mix(in oklch, var(--brand) 70%, transparent); } }
      .pin { position: fixed; transform: translate(-50%, -100%); pointer-events: auto; cursor: pointer;
        min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px 12px 12px 3px; display: grid; place-items: center;
        background: var(--foreground); color: var(--background); font-size: 11px; font-weight: 600;
        box-shadow: 0 0 0 2px var(--background), 0 4px 12px rgb(0 0 0 / .2); transition: transform .12s ease; }
      .pin:hover, .pin.open { transform: translate(-50%, -100%) scale(1.12); }
      .pin.running { background: var(--brand); color: #fff; animation: pulse 1.4s ease-in-out infinite; }
      .pin.error { background: var(--destructive); color: #fff; }
      .pin.proposed { background: var(--background); color: var(--foreground); box-shadow: 0 0 0 1.5px var(--brand) inset, 0 0 0 2px var(--background), 0 4px 12px rgb(0 0 0 / .15); }
      .glow.proposed { animation: none; outline: 1.5px dashed color-mix(in oklch, var(--brand) 60%, transparent); }
      .glow.proposed::after { display: none; }
      @keyframes pulse { 50% { box-shadow: 0 0 0 2px var(--background), 0 0 0 6px color-mix(in oklch, var(--brand) 30%, transparent); } }
      .flash { position: fixed; border: 2px solid var(--brand); border-radius: 4px; animation: fade 1.2s forwards; }
      @keyframes fade { to { opacity: 0; } }

      /* ---- popovers ---- */
      .pop { position: fixed; width: 340px; max-height: min(560px, 80vh); display: none; flex-direction: column; pointer-events: auto;
        background: var(--background); color: var(--foreground); border: 1px solid var(--border); border-radius: calc(var(--radius) * 1.4);
        box-shadow: 0 10px 38px -10px rgb(0 0 0 / .35), 0 4px 12px -6px rgb(0 0 0 / .2); overflow: hidden;
        animation: pop-in .14s ease-out; }
      .pop.open { display: flex; }
      @keyframes pop-in { from { opacity: 0; transform: translateY(4px) scale(.98); } }
      .head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--border); }
      .badge { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; padding: 2px 8px; border-radius: 6px;
        background: var(--muted); color: var(--muted-foreground); font-size: 11px; cursor: pointer; }
      .badge span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .badge:hover { color: var(--foreground); }
      .num { flex: none; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px; display: grid; place-items: center;
        background: var(--foreground); color: var(--background); font-size: 11px; font-weight: 600; }
      .num.running { background: var(--brand); color: #fff; } .num.error { background: var(--destructive); color: #fff; }
      .num.proposed { background: var(--background); color: var(--foreground); box-shadow: 0 0 0 1.5px var(--brand) inset; }
      .btn-icon.launch { display: none; } .btn-icon.launch.show { display: grid; } .btn-icon.launch:hover { color: var(--brand); }
      .grow { flex: 1; min-width: 0; }
      .btn-icon { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 6px;
        background: transparent; color: var(--muted-foreground); cursor: pointer; }
      .btn-icon:hover { background: var(--accent); color: var(--foreground); }
      .btn-icon:focus-visible, .send:focus-visible, .row-trigger:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
      .btn-icon.resolve:hover { color: var(--success); }

      /* Prompt Input */
      .prompt { margin: 10px; border: 1px solid var(--input); border-radius: var(--radius); background: var(--background);
        transition: border-color .15s, box-shadow .15s; }
      .prompt:focus-within { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 35%, transparent); }
      .prompt textarea { display: block; width: 100%; min-height: 64px; max-height: 200px; resize: none; border: 0; outline: 0;
        background: transparent; color: var(--foreground); padding: 10px 12px 4px; }
      .prompt textarea::placeholder, input::placeholder { color: var(--muted-foreground); }
      .prompt .bar { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; }
      .send { flex: none; width: 28px; height: 28px; border-radius: 999px; border: 0; display: grid; place-items: center; cursor: pointer;
        background: var(--primary); color: var(--primary-foreground); transition: opacity .15s; }
      .send:disabled { opacity: .35; cursor: default; }
      .cwd { display: none; gap: 4px; padding: 0 12px 6px; }
      .cwd.show { display: grid; }
      .cwd label { font-size: 11px; color: var(--muted-foreground); }
      .cwd input { border: 1px solid var(--input); border-radius: 6px; padding: 5px 8px; background: transparent; color: var(--foreground); outline: 0; }
      .cwd input:focus { border-color: var(--ring); }
      .composer .prompt { margin: 0; border: 0; border-radius: 0; box-shadow: none; }
      .composer .chip-row { padding: 10px 12px 0; display: flex; }
      .head, .composer .chip-row { cursor: grab; user-select: none; }
      .pop.dragging { animation: none; box-shadow: 0 18px 50px -12px rgb(0 0 0 / .45); }
      .pop.dragging .head, .pop.dragging .chip-row { cursor: grabbing; }

      /* Conversation */
      .conv { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth; }
      .msg-user { align-self: flex-end; max-width: 85%; background: var(--muted); color: var(--foreground); padding: 8px 12px;
        border-radius: 14px 14px 4px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .msg-assistant { display: flex; flex-direction: column; gap: 4px; }
      .msg-assistant .body { white-space: pre-wrap; overflow-wrap: anywhere; }
      .msg-assistant code { background: var(--muted); padding: 1px 5px; border-radius: 4px; }
      .msg-assistant .actions { display: flex; gap: 2px; margin-left: -6px; }
      .msg-assistant .actions .btn-icon { width: 24px; height: 24px; }
      .msg-error { display: flex; gap: 8px; align-items: flex-start; color: var(--destructive); font-size: 12px;
        background: color-mix(in oklch, var(--destructive) 8%, transparent); border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .msg-error .i { margin-top: 2px; }

      /* Trace (outils) */
      .trace { display: flex; flex-direction: column; border-left: 1px solid var(--border); margin-left: 6px; padding-left: 10px; gap: 1px; }
      .row-trigger { display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 4px; border: 0; border-radius: 6px; background: none;
        color: var(--muted-foreground); text-align: left; cursor: default; font-size: 12px; }
      .row-trigger.collapsible { cursor: pointer; }
      .row-trigger.collapsible:hover { background: var(--accent); color: var(--foreground); }
      .row-trigger .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .row-trigger .title b { font-weight: 500; color: var(--foreground); font-size: 12px; }
      .row-trigger .chev { width: 12px; height: 12px; opacity: 0; transition: transform .15s; }
      .row-trigger.collapsible .chev { opacity: .6; }
      .row-trigger[aria-expanded="true"] .chev { transform: rotate(90deg); }
      .row.error .row-trigger, .row.error .title b { color: var(--destructive); }
      .row pre { margin: 2px 0 6px 20px; max-height: 16rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
        background: var(--muted); color: var(--muted-foreground); border-radius: 6px; padding: 8px; font-size: 11px; }

      /* Changements d'un commentaire (diff + annulation) */
      .changes { display: flex; flex-direction: column; gap: 1px; margin-top: -4px; }
      .changes .add { color: var(--success); } .changes .del { color: var(--destructive); } .changes .zero { color: var(--muted-foreground); }
      .changes .count { flex: none; font-size: 11px; display: flex; gap: 4px; }
      .changes .files { display: flex; flex-direction: column; gap: 1px; margin-left: 10px; padding-left: 10px; border-left: 1px solid var(--border); }
      .changes .files .title { direction: rtl; text-align: left; }
      .changes.reverted .title, .changes.reverted .count { text-decoration: line-through; opacity: .7; }
      pre.diff { margin: 2px 0 6px; max-height: 14rem; overflow: auto; white-space: pre; background: var(--muted); color: var(--foreground);
        border-radius: 6px; padding: 6px 0; font-size: 11px; line-height: 1.45; }
      pre.diff span { display: block; padding: 0 8px; min-width: max-content; font: inherit; }
      pre.diff .dl-add { background: color-mix(in oklch, var(--success) 16%, transparent); }
      pre.diff .dl-del { background: color-mix(in oklch, var(--destructive) 13%, transparent); }
      pre.diff .dl-hunk { color: var(--muted-foreground); }
      .btn-ghost { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer;
        color: var(--muted-foreground); font-size: 12px; padding: 3px 4px; border-radius: 6px; }
      .btn-ghost:hover { background: var(--accent); color: var(--foreground); }
      .btn-ghost.confirm, .btn-ghost.confirm:hover { color: var(--destructive); }
      .btn-ghost:disabled { cursor: default; opacity: .6; }
      .btn-ghost:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
      .changes .done-note { display: flex; align-items: center; gap: 6px; padding: 3px 4px; font-size: 12px; color: var(--muted-foreground); }

      /* Shimmer (texte qui scintille pendant le travail) */
      .shimmer { background: linear-gradient(110deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%);
        background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent !important;
        animation: shimmer 2s linear infinite; }
      .shimmer b { color: transparent !important; }
      @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
      .status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted-foreground); }
      .footer-meta { padding: 0 12px; font-size: 11px; color: var(--muted-foreground); }

      .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: none; align-items: center; gap: 8px;
        pointer-events: auto; max-width: min(440px, 90vw); padding: 10px 14px; border-radius: var(--radius);
        background: var(--background); color: var(--foreground); border: 1px solid var(--border); box-shadow: 0 10px 30px -10px rgb(0 0 0 / .35); font-size: 12px; }
      .toast.show { display: flex; animation: pop-in .14s ease-out; }
      .toast .i { color: var(--destructive); }
      .toast .open-app { flex: none; height: 26px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px;
        background: var(--background); color: var(--foreground); font: inherit; font-weight: 500; cursor: pointer; }
      .toast .open-app:hover { background: var(--accent); }
      .toast .open-app[hidden] { display: none; }

      @media (prefers-reduced-motion: reduce) {
        *, *::after { animation: none !important; transition: none !important; }
        .shimmer { color: var(--muted-foreground) !important; background: none; }
      }
    </style>
    <div class="glows"></div>
    <div class="hl"><div class="tag">${icon("target")}<span></span></div></div>
    <div class="pins"></div>

    <div class="pop composer" role="dialog" aria-label="Nouveau commentaire">
      <div class="chip-row"><span class="badge el-chip">${icon("target")}<span></span></span></div>
      <div class="prompt">
        <textarea rows="3" placeholder="Que faut-il changer ?"></textarea>
        <div class="cwd"><label>Dossier du projet pour ce site</label><input placeholder="~/mon-projet" spellcheck="false" /></div>
        <div class="bar"><span class="grow"></span>
          <button class="send" aria-label="Envoyer à Claude" disabled>${icon("send")}</button></div>
      </div>
    </div>

    <div class="pop thread" role="dialog" aria-label="Fil du commentaire">
      <div class="head">
        <span class="num"></span>
        <span class="grow"><span class="badge el-chip" title="Montrer l'élément">${icon("target")}<span></span></span></span>
        <button class="btn-icon launch" title="Lancer" aria-label="Lancer">${icon("play")}</button>
        <button class="btn-icon resolve" title="Résoudre" aria-label="Résoudre">${icon("check")}</button>
        <button class="btn-icon close" title="Fermer" aria-label="Fermer">${icon("x")}</button>
      </div>
      <div class="conv" aria-live="polite"></div>
      <div class="footer-meta"></div>
      <div class="prompt">
        <textarea rows="1" placeholder="Répondre…" style="min-height: 38px"></textarea>
        <div class="bar"><span class="grow"></span>
          <button class="send" aria-label="Envoyer" disabled>${icon("send")}</button></div>
      </div>
    </div>
    <div class="toast" role="status">${icon("alert")}<span></span><button class="open-app" hidden>Ouvrir l'app</button></div>`;
  document.documentElement.appendChild(host);
  // Les évènements de notre UI ne doivent pas atteindre la page (raccourcis, menus…).
  for (const t of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "pointerdown", "pointerup", "wheel"]) {
    host.addEventListener(t, (e) => e.stopPropagation());
  }

  const q = (s, r = root) => r.querySelector(s);
  const hl = q(".hl"), glowsEl = q(".glows"), pinsEl = q(".pins"), toastEl = q(".toast");
  const composer = q(".composer"), ta = q("textarea", composer), sendBtn = q(".send", composer);
  const cwdBox = q(".cwd", composer), cwdInput = q("input", cwdBox);
  const thread = q(".thread"), conv = q(".conv"), metaEl = q(".footer-meta"), replyTa = q("textarea", thread), replyBtn = q(".send", thread);

  let comments = [], knownCwd = "", target = null, openId = null, pageUrl = location.href, pollTimer = null;
  const openRows = new Set(); // lignes d'outil dépliées par l'utilisateur

  // ---------- liaison avec le service worker ----------
  async function call(type, payload = {}) {
    let res;
    try { res = await chrome.runtime.sendMessage({ type, ...payload }); }
    catch { throw new Error("Extension rechargée : recharge la page."); }
    if (res?.error) throw Object.assign(new Error(res.error), { code: res.code });
    return res?.data;
  }
  // code "noapp" : l'app est fermée, on propose de l'ouvrir.
  function toast(text, code) {
    q("span", toastEl).textContent = text;
    const btn = q("button", toastEl);
    btn.hidden = code !== "noapp";
    btn.disabled = false;
    toastEl.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove("show"), code === "noapp" ? 10000 : 4500);
  }
  q("button", toastEl).onclick = async (e) => {
    e.currentTarget.disabled = true;
    q("span", toastEl).textContent = "Ouverture de l'app…";
    try { await call("openApp"); toastEl.classList.remove("show"); poll(0); }
    catch (err) { toast(err.message, err.code); }
  };

  // ---------- description de l'élément ----------
  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) { parts.unshift("#" + CSS.escape(el.id)); break; }
      let s = el.tagName.toLowerCase();
      const same = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  const label = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].slice(0, 2).map((c) => "." + c).join("");
  function describe(el) {
    const ancestors = [];
    for (let p = el.parentElement; p && p !== document.body && ancestors.length < 5; p = p.parentElement) ancestors.push(label(p));
    const r = el.getBoundingClientRect();
    return {
      selector: cssPath(el), label: label(el), html: el.outerHTML.slice(0, 4000),
      visible: (el.innerText || "").trim().slice(0, 500), ancestors: ancestors.join(" < "),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }, dpr: devicePixelRatio,
      url: location.href, title: document.title,
    };
  }
  const find = (selector) => { try { return document.querySelector(selector); } catch { return null; } };

  // Instantané simplifié du DOM pour une conversation : une ligne par élément utile,
  // [sélecteur] élément « texte propre » · taille · espacements, indentée selon l'imbrication.
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "BR", "PATH", "G", "DEFS", "CLAUDE-COMMENTS"]);
  const KEY = /^(H[1-6]|P|A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|IMG|SVG|VIDEO|LI|TH|TD|FIGCAPTION|BLOCKQUOTE|SUMMARY|HEADER|NAV|MAIN|FOOTER|SECTION|ARTICLE|ASIDE|FORM|UL|OL|TABLE|DIALOG|FIELDSET)$/;
  function snapshot(maxLines = 450, maxChars = 55000) {
    const lines = [];
    let chars = 0;
    const box = (v) => v.split(" ").map((x) => Math.round(parseFloat(x)) || 0);
    const spacing = (name, cs) => {
      const v = box([cs[name + "Top"], cs[name + "Right"], cs[name + "Bottom"], cs[name + "Left"]].join(" "));
      if (v.every((x) => !x)) return "";
      const [t, r, b, l] = v;
      return `${name === "padding" ? "p" : "m"} ${t === b && r === l ? (t === r ? t : `${t}/${r}`) : v.join("/")}`;
    };
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    function walk(el, depth) {
      const tag = el.tagName.toUpperCase();
      if (lines.length >= maxLines || chars >= maxChars || SKIP.has(tag)) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1 && cs.display !== "contents") return;
      const text = ownText(el);
      const key = KEY.test(tag) || text || el.id || el.getAttribute("role");
      let next = depth;
      if (key) {
        const bits = [`${Math.round(r.width)}×${Math.round(r.height)}`];
        const p = spacing("padding", cs), m = spacing("margin", cs);
        if (p) bits.push(p);
        if (m) bits.push(m);
        if (cs.gap && cs.gap !== "normal") bits.push("gap " + cs.gap);
        if (text) bits.push(`fs ${Math.round(parseFloat(cs.fontSize))}`);
        const extra = el.getAttribute("placeholder") || el.getAttribute("alt") || el.getAttribute("aria-label") || (el.type && el.tagName === "INPUT" ? "type=" + el.type : "");
        const line = `${"  ".repeat(depth)}[${cssPath(el)}] ${label(el)}${text ? ` « ${text.slice(0, 120)} »` : ""}${extra ? ` (${extra.slice(0, 60)})` : ""} · ${bits.join(" · ")}`;
        lines.push(line);
        chars += line.length + 1;
        next = depth + 1;
      }
      if (tag === "SVG") return;
      for (const child of el.children) walk(child, next);
    }
    walk(document.body, 0);
    if (lines.length >= maxLines || chars >= maxChars) lines.push("… (instantané tronqué)");
    return lines.join("\n");
  }
  function place(box, el) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px" });
  }
  // Position choisie à la main (glisser l'en-tête) : prioritaire sur le placement automatique.
  const manualPos = new Map(); // clé (id du fil, ou "composer") -> { left, top }
  const popKey = (pop) => (pop === thread ? openId : "composer");
  const clampPos = (pop, left, top) => ({
    left: Math.min(Math.max(8, left), innerWidth - pop.offsetWidth - 8),
    top: Math.min(Math.max(8, top), innerHeight - 48),
  });
  function placePop(pop, el) {
    const manual = manualPos.get(popKey(pop));
    if (manual) {
      const { left, top } = clampPos(pop, manual.left, manual.top);
      return Object.assign(pop.style, { left: left + "px", top: top + "px" });
    }
    const r = el.getBoundingClientRect();
    const w = 340, h = pop.offsetHeight || 220, m = 12;
    let left = r.right + m, top = r.top;
    if (left + w > innerWidth - 8) left = r.left - w - m;             // à gauche de l'élément
    if (left < 8) { left = Math.min(Math.max(8, r.left), innerWidth - w - 8); top = r.bottom + m; } // dessous
    if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
    Object.assign(pop.style, { left: left + "px", top: Math.max(8, top) + "px" });
  }

  // ---------- ⌘+clic ----------
  const isOurs = (e) => e.composedPath().includes(host);
  const mod = (e) => e.metaKey || e.ctrlKey;
  let hovered = null;

  addEventListener("mousemove", (e) => {
    if (target) return;
    if (!mod(e) || isOurs(e)) { hl.style.display = "none"; return; }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host) return;
    hovered = el;
    place(hl, el);
    q(".tag span").textContent = label(el);
  }, true);
  addEventListener("keyup", (e) => { if ((e.key === "Meta" || e.key === "Control") && !target) hl.style.display = "none"; }, true);

  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"]) {
    addEventListener(type, (e) => {
      if (!mod(e) || isOurs(e) || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (type === "click") openComposer(document.elementFromPoint(e.clientX, e.clientY) || hovered);
    }, true);
  }
  // Clic hors de nos bulles : on ferme le fil, et la bulle de saisie si elle est vide.
  addEventListener("pointerdown", (e) => {
    if (isOurs(e) || mod(e)) return;
    if (openId) closeThread();
    if (target && !ta.value.trim()) closeComposer();
  }, true);

  function makeDraggable(pop, handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button, .badge, textarea, input")) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, left: pop.offsetLeft, top: pop.offsetTop };
      handle.setPointerCapture(e.pointerId);
      pop.classList.add("dragging");
      const move = (ev) => {
        const { left, top } = clampPos(pop, start.left + ev.clientX - start.x, start.top + ev.clientY - start.y);
        Object.assign(pop.style, { left: left + "px", top: top + "px" });
        manualPos.set(popKey(pop), { left, top });
      };
      const up = () => {
        pop.classList.remove("dragging");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  function autoGrow(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 200) + "px"; }

  function openComposer(el, keepText = "") {
    if (!el || el === host) return;
    closeThread();
    target = el;
    manualPos.delete("composer");
    place(hl, el);
    q(".tag span").textContent = label(el);
    q(".el-chip span", composer).textContent = label(el);
    cwdBox.classList.remove("show");
    cwdInput.value = knownCwd;
    ta.value = keepText;
    sendBtn.disabled = !keepText;
    composer.classList.add("open");
    autoGrow(ta);
    placePop(composer, el);
    setTimeout(() => ta.focus(), 0);
  }
  function closeComposer() {
    target = null;
    composer.classList.remove("open");
    hl.style.display = "none";
  }
  async function submit() {
    const text = ta.value.trim();
    const cwd = cwdInput.value.trim();
    if (!text || !target) return;
    const el = target, info = describe(target);
    if (cwd) knownCwd = cwd;
    closeComposer();
    // On masque l'UI pendant que le service worker fait la capture d'écran.
    host.style.visibility = "hidden";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const created = await call("create", { comment: { ...info, text }, cwd });
      comments.push(created);
      render();
      openThread(created.id);
    } catch (e) {
      host.style.visibility = "";
      if (/dossier du projet/.test(e.message)) {
        // Rien de détecté ni mémorisé : on rouvre la bulle (texte conservé) avec le champ dossier.
        knownCwd = "";
        openComposer(el, text);
        cwdBox.classList.add("show");
        cwdInput.value = "";
        setTimeout(() => cwdInput.focus(), 0);
      }
      toast(e.message, e.code);
    } finally {
      host.style.visibility = "";
    }
    poll(0);
  }
  ta.addEventListener("input", () => { sendBtn.disabled = !ta.value.trim(); autoGrow(ta); });
  sendBtn.onclick = submit;
  composer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === "Escape") closeComposer();
  });
  q(".el-chip", composer).onclick = () => target && flashEl(target);
  makeDraggable(composer, q(".chip-row", composer));
  makeDraggable(thread, q(".head", thread));

  // ---------- fil de discussion ----------
  function openThread(id) {
    closeComposer();
    openId = id;
    call("seen", { id }).catch(() => {}); // plus « non lu » dans le side panel
    thread.classList.add("open");
    renderThread(true);
    setTimeout(() => replyTa.focus(), 0);
  }
  function closeThread() {
    openId = null;
    thread.classList.remove("open");
    for (const p of pinsEl.children) p.classList.remove("open");
  }

  function toolRow(m) {
    // Anciennes lignes (avant le détail des outils) : seulement un texte.
    const [ic, doing, done] = TOOLS[m.name] || ["tool", m.name || "", m.name || ""];
    const verb = m.isError ? "Échec :" : m.running ? doing : done;
    if (!m.name) m = { ...m, target: m.text };
    const row = document.createElement("div");
    row.className = "row" + (m.isError ? " error" : "");
    const collapsible = !!m.output;
    const open = openRows.has(m.id);
    row.innerHTML = `<button class="row-trigger${collapsible ? " collapsible" : ""}" ${collapsible ? `aria-expanded="${open}"` : "tabindex=-1"}>
        ${m.running ? icon("loader", "spin") : icon(m.isError ? "alert" : ic)}
        <span class="title${m.running ? " shimmer" : ""}">${esc(verb)} <b class="mono">${esc(m.target || "")}</b></span>
        ${icon("chevron", "chev")}</button>`;
    if (collapsible && open) {
      const pre = document.createElement("pre");
      pre.textContent = m.output;
      row.appendChild(pre);
    }
    if (collapsible) q(".row-trigger", row).onclick = () => {
      open ? openRows.delete(m.id) : openRows.add(m.id);
      renderThread(false);
    };
    return row;
  }

  // ---------- changements du commentaire (diff + annulation) ----------
  const diffs = new Map();     // id -> { key, data } (key : fin de session, pour recharger après un nouveau run)
  const diffOpen = new Set();  // commentaires dont la liste de fichiers est dépliée
  const diffFile = new Map();  // id -> fichier dont le diff est affiché
  let confirmRevert = null;    // id en attente de confirmation

  function loadDiff(c) {
    const key = String(c.finishedAt || "");
    const cached = diffs.get(c.id);
    if (cached && cached.key === key && !cached.loading && !cached.data?.pending) return cached.data;
    if (cached?.loading) return cached.data;
    diffs.set(c.id, { key, loading: true, data: cached?.data });
    call("diff", { id: c.id }).then(
      (data) => {
        diffs.set(c.id, { key, data });
        if (data?.pending) setTimeout(() => openId === c.id && renderThread(false), 1000);
        else if (openId === c.id) renderThread(false);
      },
      () => diffs.set(c.id, { key, data: null }), // bridge sans diffs : on n'affiche rien
    );
    return cached?.data;
  }

  // Patch d'un seul fichier, lignes colorées.
  function fileDiff(patch, file) {
    const block = patch.split(/^(?=diff --git )/m).find((b) => b.split("\n")[0].endsWith(" b/" + file)) || "";
    const lines = block.split("\n");
    const start = lines.findIndex((l) => l.startsWith("@@") || l.startsWith("Binary") || l.startsWith("GIT binary"));
    const pre = document.createElement("pre");
    pre.className = "diff";
    pre.innerHTML = (start < 0 ? ["(pas de contenu texte)"] : lines.slice(start)).filter((l, i, a) => l || i < a.length - 1).map((l) => {
      const cls = l.startsWith("@@") ? "dl-hunk" : l.startsWith("+") ? "dl-add" : l.startsWith("-") ? "dl-del" : "";
      return `<span class="${cls}">${esc(l) || " "}</span>`;
    }).join("");
    return pre;
  }

  const counts = (x) => `<span class="${x.add ? "add" : "zero"}">+${x.add}</span><span class="${x.del ? "del" : "zero"}">−${x.del}</span>`;

  function changesBlock(c) {
    const d = loadDiff(c);
    if (!d?.enabled || !d.files?.length) return null;
    const n = d.files.length;
    const open = diffOpen.has(c.id);
    const box = document.createElement("div");
    box.className = "changes" + (d.reverted ? " reverted" : "");
    box.innerHTML = `<button class="row-trigger collapsible" aria-expanded="${open}">${icon("diff")}
        <span class="title">${n} fichier${n > 1 ? "s" : ""} modifié${n > 1 ? "s" : ""}</span>
        <span class="count mono">${counts(d)}</span>${icon("chevron", "chev")}</button>`;
    q(".row-trigger", box).onclick = () => { open ? diffOpen.delete(c.id) : diffOpen.add(c.id); renderThread(false); };
    if (open) {
      const files = document.createElement("div");
      files.className = "files";
      for (const f of d.files) {
        const shown = diffFile.get(c.id) === f.path;
        const row = document.createElement("button");
        row.className = "row-trigger collapsible";
        row.setAttribute("aria-expanded", shown);
        row.title = f.path;
        row.innerHTML = `<span class="title mono">‎${esc(f.path)}</span>
          <span class="count mono">${f.binary ? "binaire" : counts(f)}</span>`;
        row.onclick = () => { shown ? diffFile.delete(c.id) : diffFile.set(c.id, f.path); renderThread(false); };
        files.appendChild(row);
        if (shown) files.appendChild(fileDiff(d.patch || "", f.path));
      }
      box.appendChild(files);
    }
    if (d.reverted) {
      const note = document.createElement("div");
      note.className = "done-note";
      note.innerHTML = `${icon("check")}<span>Annulé</span>`;
      box.appendChild(note);
    } else {
      const confirming = confirmRevert === c.id;
      const b = document.createElement("button");
      b.className = "btn-ghost" + (confirming ? " confirm" : "");
      b.innerHTML = `${icon("undo")}<span>${confirming ? "Confirmer l'annulation" : "Annuler ce changement"}</span>`;
      b.onclick = async () => {
        if (!confirming) {
          confirmRevert = c.id;
          renderThread(false);
          clearTimeout(changesBlock.t);
          changesBlock.t = setTimeout(() => { if (confirmRevert === c.id) { confirmRevert = null; renderThread(false); } }, 4000);
          return;
        }
        confirmRevert = null;
        b.disabled = true;
        q("span", b).textContent = "Annulation…";
        try {
          const data = await call("revert", { id: c.id });
          diffs.set(c.id, { key: String(c.finishedAt || ""), data });
        } catch (e) { toast(e.message, e.code); }
        renderThread(false);
      };
      box.appendChild(b);
    }
    return box;
  }

  function renderThread(scrollDown) {
    const c = comments.find((x) => x.id === openId);
    if (!c) return closeThread();
    // Fini pendant que le fil était ouvert : déjà lu.
    if (c.finishedAt && renderThread.seen !== c.id + c.finishedAt) { renderThread.seen = c.id + c.finishedAt; call("seen", { id: c.id }).catch(() => {}); }
    for (const p of pinsEl.children) p.classList.toggle("open", p.dataset.id === c.id);
    const num = q(".num", thread);
    num.className = "num " + c.status;
    num.textContent = c.n;
    q(".el-chip span", thread).textContent = c.label;

    const atBottom = conv.scrollHeight - conv.scrollTop - conv.clientHeight < 24;
    const keep = conv.scrollTop;
    conv.innerHTML = "";
    const messages = [{ role: "user", text: c.text }, ...c.messages];
    const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
    let trace = null;
    messages.forEach((m, idx) => {
      if (m.role === "tool") {
        if (!trace) { trace = document.createElement("div"); trace.className = "trace"; conv.appendChild(trace); }
        trace.appendChild(toolRow(m));
        return;
      }
      trace = null;
      const d = document.createElement("div");
      if (m.role === "user") { d.className = "msg-user"; d.textContent = m.text; }
      else if (m.role === "error") { d.className = "msg-error"; d.innerHTML = icon("alert") + `<span>${esc(m.text)}</span>`; }
      else {
        d.className = "msg-assistant";
        d.innerHTML = `<div class="body">${md(m.text)}</div>`;
        if (idx === lastAssistant && c.status !== "running") {
          const actions = document.createElement("div");
          actions.className = "actions";
          actions.innerHTML = `<button class="btn-icon" title="Copier" aria-label="Copier">${icon("copy")}</button>`;
          const b = q("button", actions);
          b.onclick = async () => {
            await navigator.clipboard.writeText(m.text).catch(() => {});
            b.innerHTML = icon("check");
            setTimeout(() => (b.innerHTML = icon("copy")), 2000);
          };
          d.appendChild(actions);
        }
      }
      conv.appendChild(d);
      if (idx === lastAssistant && (c.status === "done" || c.status === "error")) {
        const ch = changesBlock(c);
        if (ch) conv.appendChild(ch);
      }
    });
    // État courant : en attente, ou réflexion quand aucun outil ne tourne.
    const last = messages[messages.length - 1];
    q(".launch", thread).classList.toggle("show", c.status === "proposed");
    replyTa.placeholder = c.status === "proposed" ? "Préciser et lancer…" : "Répondre…";
    if (c.status === "proposed") {
      const s = document.createElement("div");
      s.className = "status";
      s.textContent = "Proposé par la conversation — à lancer";
      conv.appendChild(s);
    }
    if (c.status === "queued" || (c.status === "running" && !(last.role === "tool" && last.running))) {
      const s = document.createElement("div");
      s.className = "status";
      s.innerHTML = c.status === "queued"
        ? `${icon("loader", "spin")}<span>En attente d'un autre commentaire…</span>`
        : `<span class="shimmer">Claude réfléchit…</span>`;
      conv.appendChild(s);
    }
    metaEl.textContent = c.status === "done" ? ["Terminé", c.stats].filter(Boolean).join(" · ") : c.status === "error" ? "Erreur" : "";
    metaEl.style.paddingTop = metaEl.textContent ? "0" : "";
    conv.scrollTop = scrollDown || atBottom ? conv.scrollHeight : keep;
    const el = find(c.selector);
    if (el) placePop(thread, el);
  }
  q(".close", thread).onclick = closeThread;
  q(".launch", thread).onclick = async () => {
    const c = comments.find((x) => x.id === openId);
    if (!c) return;
    try {
      const updated = await call("launch", { id: c.id, url: location.href, selectors: { [c.id]: c.selector } });
      comments = comments.map((x) => (x.id === updated.id ? updated : x));
      render();
    } catch (e) { toast(e.message, e.code); }
    poll(0);
  };
  q(".el-chip", thread).onclick = () => { const c = comments.find((x) => x.id === openId); if (c) flashEl(find(c.selector)); };
  q(".resolve", thread).onclick = async () => {
    const id = openId;
    closeThread();
    comments = comments.filter((c) => c.id !== id);
    render();
    try { await call("resolve", { id }); } catch (e) { toast(e.message, e.code); }
  };
  async function reply() {
    const text = replyTa.value.trim();
    if (!text || !openId) return;
    replyTa.value = "";
    replyBtn.disabled = true;
    autoGrow(replyTa);
    try {
      const c = comments.find((x) => x.id === openId);
      const el = c?.status === "proposed" && find(c.selector);
      const updated = await call("reply", { id: openId, text, detail: el ? describe(el) : undefined });
      comments = comments.map((c) => (c.id === updated.id ? updated : c));
      render();
      renderThread(true);
    } catch (err) { toast(err.message, err.code); }
    poll(0);
  }
  replyTa.addEventListener("input", () => { replyBtn.disabled = !replyTa.value.trim(); autoGrow(replyTa); });
  replyBtn.onclick = reply;
  thread.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closeThread();
    if (e.target === replyTa && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); reply(); }
  });

  function flashEl(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      const f = document.createElement("div");
      f.className = "flash";
      root.appendChild(f);
      place(f, el);
      setTimeout(() => f.remove(), 1300);
    }, 350);
  }

  // ---------- pastilles + scintillement ----------
  function render() {
    pinsEl.innerHTML = "";
    glowsEl.innerHTML = "";
    for (const c of comments) {
      if (c.kind === "conversation" || !c.selector) continue;
      const g = document.createElement("div");
      g.className = "glow " + c.status;
      g.dataset.selector = c.selector;
      glowsEl.appendChild(g);
      const p = document.createElement("div");
      p.className = "pin " + c.status + (openId === c.id ? " open" : "");
      p.textContent = c.n;
      p.title = c.text;
      p.dataset.selector = c.selector;
      p.dataset.id = c.id;
      p.onclick = () => (openId === c.id ? closeThread() : openThread(c.id));
      pinsEl.appendChild(p);
    }
    if (openId) renderThread(false);
    position();
  }
  function position() {
    for (const d of [...pinsEl.children, ...glowsEl.children]) {
      const el = find(d.dataset.selector);
      if (!el) { d.style.display = "none"; continue; }
      const r = el.getBoundingClientRect();
      if (d.classList.contains("pin")) Object.assign(d.style, { display: "grid", left: r.right + "px", top: r.top + "px" });
      else Object.assign(d.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px" });
    }
    if (target) { place(hl, target); placePop(composer, target); }
    const open = comments.find((c) => c.id === openId);
    const el = open && find(open.selector);
    if (el) placePop(thread, el);
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; position(); }); };
  addEventListener("scroll", schedule, true);
  addEventListener("resize", schedule);
  setInterval(position, 800); // la page peut bouger (HMR, rendu async)

  // ---------- synchronisation avec le bridge ----------
  function poll(delay) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (location.href !== pageUrl) { pageUrl = location.href; closeThread(); closeComposer(); }
      let busy = false;
      if (document.visibilityState === "visible") {
        try {
          const { comments: list, cwd } = await call("list", { url: location.href });
          const changed = JSON.stringify(list) !== JSON.stringify(comments);
          comments = list;
          knownCwd = cwd || knownCwd;
          if (changed) render();
          // Fil demandé depuis le side panel avant d'arriver sur cette page.
          const { pendingOpen } = await chrome.storage.local.get("pendingOpen");
          if (pendingOpen?.url === location.href.split("#")[0] && list.some((c) => c.id === pendingOpen.id)) {
            chrome.storage.local.remove("pendingOpen");
            openThread(pendingOpen.id);
            const c = list.find((x) => x.id === pendingOpen.id);
            find(c.selector)?.scrollIntoView({ block: "center" });
          }
          busy = list.some((c) => c.status === "queued" || c.status === "running");
        } catch (e) {
          if (/rechargée/.test(e.message)) { // extension rechargée : ce script est mort
            toast("Extension mise à jour : recharge la page (⌘R).");
            clearTimeout(toast.t);
            return;
          }
          if (openId) metaEl.textContent = e.message;
        }
      }
      poll(busy || openId ? 1500 : 6000);
    }, delay);
  }
  // Le side panel demande d'ouvrir un fil sur cette page.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Instantané demandé pour une conversation : on masque notre UI le temps de la capture.
    if (msg.type === "cc:snapshot") {
      closeComposer();
      const data = { snapshot: snapshot(), url: location.href, title: document.title };
      host.style.visibility = "hidden";
      clearTimeout(unhide);
      unhide = setTimeout(() => (host.style.visibility = ""), 2000);
      requestAnimationFrame(() => requestAnimationFrame(() => sendResponse(data)));
      return true;
    }
    if (msg.type === "cc:show") { clearTimeout(unhide); host.style.visibility = ""; poll(0); return; }
    if (msg.type === "cc:describe") {
      const out = {};
      for (const [id, sel] of Object.entries(msg.selectors || {})) { const el = find(sel); if (el) out[id] = describe(el); }
      sendResponse(out);
      return;
    }
    if (msg.type !== "cc:open") return;
    const c = comments.find((x) => x.id === msg.id);
    if (c) { find(c.selector)?.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(() => openThread(c.id), 300); }
    else poll(0);
  });
  let unhide = 0;
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && poll(0));
  poll(0);

  // ---------- utilitaires ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function md(src) {
    return esc(src)
      .replace(/```\w*\n?([\s\S]*?)```/g, (_, c) => `<code style="display:block;padding:8px;white-space:pre-wrap">${c}</code>`)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  }
})();
