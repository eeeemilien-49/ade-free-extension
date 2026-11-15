// Script de page : ⌘+clic (Ctrl+clic hors Mac) sur un élément pour le commenter.
// Les commentaires non résolus ont une pastille ; leur élément scintille pendant le travail.
// Cliquer la pastille ouvre le fil de discussion avec Claude.
// UI inspirée de shadcn AI Elements (Prompt Input, Message, Trace/Tool, Shimmer),
// dans un shadow DOM fermé, isolé des styles de la page (y compris les !important hérités).
(() => {
  if (window.__claudeComments || window.top !== window) return;
  window.__claudeComments = true;

  // Icônes Lucide (24×24, trait).
  const ICON = {
    send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
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
    steps: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    sparkles: '<path d="M9.94 14.06 4 20M14.06 9.94 20 4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  };
  const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  // Libellés des outils : présent pendant l'exécution, passé une fois fini ; famille pour le résumé.
  const TOOLS = {
    Read: ["file", "Lecture de", "Lu", "read"],
    Edit: ["edit", "Modification de", "Modifié", "edit"], MultiEdit: ["edit", "Modification de", "Modifié", "edit"],
    Write: ["edit", "Écriture de", "Écrit", "edit"], NotebookEdit: ["edit", "Modification de", "Modifié", "edit"],
    Bash: ["terminal", "Exécution de", "Exécuté", "bash"],
    Grep: ["search", "Recherche de", "Recherché", "search"], Glob: ["search", "Recherche de", "Recherché", "search"],
  };
  const STATE = { proposed: "Proposé", queued: "En attente", running: "En cours", done: "Terminé", error: "Erreur" };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const scrollBehavior = () => (reduceMotion.matches ? "auto" : "smooth");

  const host = document.createElement("claude-comments");
  host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      /* Les !important du shadow DOM l'emportent sur ceux de la page : rien n'est hérité d'elle. */
      :host { all: initial !important; display: block !important; position: fixed !important; inset: 0 !important;
        z-index: 2147483647 !important; pointer-events: none !important; visibility: visible !important;
        /* Jetons shadcn (neutral) */
        --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); --popover: oklch(1 0 0);
        --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
        --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
        --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0);
        --accent: oklch(0.97 0 0); --destructive: oklch(0.577 0.245 27.325);
        --success: oklch(0.627 0.17 149);
        --radius: 10px; --field: oklch(1 0 0);
        --shadow: 0 12px 40px -12px rgb(0 0 0 / .28), 0 4px 12px -6px rgb(0 0 0 / .14);
        /* Repères posés sur la page : couleur de marque, visible sur tout fond */
        --brand: #d97757;
        color-scheme: light;
      }
      :host([data-hidden]) { visibility: hidden !important; }
      @media (prefers-color-scheme: dark) {
        :host {
          --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0); --popover: oklch(0.205 0 0);
          --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0);
          --border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%); --ring: oklch(0.556 0 0);
          --primary: oklch(0.922 0 0); --primary-foreground: oklch(0.205 0 0);
          --accent: oklch(0.269 0 0); --destructive: oklch(0.704 0.191 22.216);
          --success: oklch(0.723 0.19 149); --field: oklch(1 0 0 / 4%);
          --shadow: 0 12px 40px -12px rgb(0 0 0 / .7), 0 0 0 1px rgb(255 255 255 / .04);
          color-scheme: dark;
        }
      }
      * { box-sizing: border-box; margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
        font-size: 13px; line-height: 1.5; letter-spacing: 0; -webkit-font-smoothing: antialiased; }
      code, pre, .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
      button { font: inherit; color: inherit; }
      .i { width: 14px; height: 14px; flex: none; }
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
      :focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }

      /* ---- survol ⌘ ---- */
      .hl { position: fixed; display: none; border: 1.5px solid var(--brand); background: color-mix(in oklch, var(--brand) 8%, transparent);
        border-radius: 4px; transition: left .06s, top .06s, width .06s, height .06s; }
      .hl .tag { position: absolute; bottom: 100%; left: -1.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; max-width: 320px;
        background: var(--brand); color: #fff; font-size: 11px; font-weight: 500; padding: 2px 7px; border-radius: 5px; white-space: nowrap;
        box-shadow: 0 2px 8px rgb(0 0 0 / .18); }
      .hl.below .tag { bottom: auto; top: 100%; margin: 4px 0 0; }
      .hl .tag .name { overflow: hidden; text-overflow: ellipsis; font-size: 11px; font-weight: 500; }
      .hl .tag .dim { opacity: .75; font-size: 10px; font-variant-numeric: tabular-nums; }
      .hl .tag .i { width: 11px; height: 11px; }

      /* ---- contours des éléments commentés ----
         Discrets par défaut ; scintillent seulement pendant le travail ; visibles au survol de la pastille. */
      .glow { position: fixed; display: none; border-radius: 4px; overflow: hidden; outline: 1px solid transparent; transition: outline-color .15s; }
      .glow.running { outline: 1px solid color-mix(in oklch, var(--brand) 45%, transparent); animation: breathe 2.4s ease-in-out infinite; }
      .glow.running::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(100deg, transparent 20%, color-mix(in oklch, var(--brand) 16%, transparent) 50%, transparent 80%);
        animation: sweep 2.4s ease-in-out infinite; }
      .glow.queued { outline: 1px dashed color-mix(in oklch, var(--brand) 40%, transparent); }
      .glow.proposed { outline: 1.5px dashed color-mix(in oklch, var(--brand) 55%, transparent); }
      .glow.error { outline: 1px solid color-mix(in oklch, var(--destructive) 55%, transparent); }
      .glow.lit { outline: 1.5px solid var(--brand); background: color-mix(in oklch, var(--brand) 6%, transparent); }
      .glow.lit.done { outline-color: var(--success); background: color-mix(in oklch, var(--success) 6%, transparent); }
      .glow.lit.error { outline-color: var(--destructive); }
      @keyframes sweep { to { transform: translateX(100%); } }
      @keyframes breathe { 50% { outline-color: color-mix(in oklch, var(--brand) 80%, transparent); } }

      /* ---- pastilles ---- */
      .pin { position: fixed; display: none; transform: translate(-50%, -100%); pointer-events: auto; cursor: pointer; border: 0; padding: 0 6px;
        min-width: 22px; height: 22px; border-radius: 11px 11px 11px 3px; place-items: center;
        background: var(--foreground); color: var(--background); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
        box-shadow: 0 0 0 2px var(--background), 0 3px 10px rgb(0 0 0 / .22);
        transition: transform .12s ease, min-width .12s ease, height .12s ease, font-size .12s ease; }
      .pin:hover, .pin:focus-visible, .pin.open { transform: translate(-50%, -100%) scale(1.12); z-index: 1; }
      .pin:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
      .pin.queued { background: var(--popover); color: var(--foreground); box-shadow: 0 0 0 1.5px var(--muted-foreground) inset, 0 0 0 2px var(--background), 0 3px 10px rgb(0 0 0 / .15); }
      .pin.running { background: var(--brand); color: #fff; animation: pulse 1.4s ease-in-out infinite; }
      .pin.done { background: var(--success); color: #fff; }
      .pin.error { background: var(--destructive); color: #fff; }
      .pin.proposed { background: var(--popover); color: var(--brand); box-shadow: 0 0 0 1.5px var(--brand) inset, 0 0 0 2px var(--background), 0 3px 10px rgb(0 0 0 / .15); }
      .pin.sending { background: var(--foreground); color: var(--background); }
      .pin.sending .i { width: 12px; height: 12px; }
      /* Beaucoup de pastilles : les terminées deviennent des points, reprennent leur taille au survol. */
      .pin.compact:not(:hover):not(:focus-visible):not(.open) { min-width: 10px; height: 10px; padding: 0; font-size: 0; border-radius: 5px;
        box-shadow: 0 0 0 2px var(--background), 0 1px 4px rgb(0 0 0 / .25); transform: translate(-50%, -150%); }
      @keyframes pulse { 50% { box-shadow: 0 0 0 2px var(--background), 0 0 0 6px color-mix(in oklch, var(--brand) 30%, transparent); } }
      .flash { position: fixed; border: 2px solid var(--brand); border-radius: 4px; animation: fade 1.2s forwards; }
      @keyframes fade { to { opacity: 0; } }

      /* Aperçu au survol d'une pastille */
      .peek { position: fixed; display: none; transform: translate(-50%, calc(-100% - 30px)); max-width: 260px; padding: 6px 9px;
        background: var(--popover); color: var(--foreground); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow);
        flex-direction: column; gap: 1px; }
      .peek.show { display: flex; animation: pop-in .1s ease-out; }
      .peek.below { transform: translate(-50%, 10px); }
      .peek .state { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted-foreground); }
      .peek .state::before { content: ""; width: 6px; height: 6px; border-radius: 3px; background: var(--muted-foreground); }
      .peek .state.running::before, .peek .state.proposed::before { background: var(--brand); }
      .peek .state.done::before { background: var(--success); } .peek .state.error::before { background: var(--destructive); }
      .peek .text { font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }

      /* ---- bulles ---- */
      .pop { position: fixed; width: min(360px, calc(100vw - 16px)); max-height: min(580px, calc(100vh - 16px)); display: none; flex-direction: column;
        pointer-events: auto; background: var(--popover); color: var(--foreground); border: 1px solid var(--border);
        border-radius: calc(var(--radius) * 1.4); box-shadow: var(--shadow); overflow: hidden; }
      .pop.open { display: flex; animation: pop-in .14s ease-out; }
      @keyframes pop-in { from { opacity: 0; transform: translateY(4px) scale(.98); } }
      .head { display: flex; align-items: center; gap: 6px; padding: 8px 6px 8px 10px; border-bottom: 1px solid var(--border); }
      .badge { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; height: 22px; padding: 0 8px; border: 0; border-radius: 6px;
        background: var(--muted); color: var(--muted-foreground); font-size: 11px; cursor: pointer; }
      .badge span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
      .badge .i { width: 12px; height: 12px; }
      .badge:hover { color: var(--foreground); }
      .badge.missing { text-decoration: line-through; cursor: default; }
      .num { flex: none; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px 10px 10px 3px; display: grid; place-items: center;
        background: var(--foreground); color: var(--background); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .num.running { background: var(--brand); color: #fff; } .num.error { background: var(--destructive); color: #fff; }
      .num.done { background: var(--success); color: #fff; }
      .num.queued { background: var(--popover); color: var(--foreground); box-shadow: 0 0 0 1.5px var(--muted-foreground) inset; }
      .num.proposed { background: var(--popover); color: var(--brand); box-shadow: 0 0 0 1.5px var(--brand) inset; }
      .grow { flex: 1; min-width: 0; display: flex; }
      .btn-icon { flex: none; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 6px;
        background: transparent; color: var(--muted-foreground); cursor: pointer; }
      .btn-icon:hover { background: var(--accent); color: var(--foreground); }
      .btn-icon.resolve:hover { color: var(--success); }
      .btn-icon.resolve.discard:hover { color: var(--destructive); }

      /* Prompt Input */
      .prompt { margin: 8px; border: 1px solid var(--input); border-radius: var(--radius); background: var(--field);
        transition: border-color .15s, box-shadow .15s; }
      .prompt:focus-within { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 30%, transparent); }
      .prompt textarea { display: block; width: 100%; min-height: 64px; max-height: 200px; resize: none; border: 0; outline: 0;
        background: transparent; color: var(--foreground); padding: 10px 12px 2px; }
      .prompt textarea::placeholder, input::placeholder { color: var(--muted-foreground); opacity: 1; }
      .prompt .bar { display: flex; align-items: center; gap: 6px; padding: 4px 6px 6px 12px; }
      .send { flex: none; width: 28px; height: 28px; border-radius: 999px; border: 0; display: grid; place-items: center; cursor: pointer;
        background: var(--primary); color: var(--primary-foreground); transition: opacity .15s; }
      .send:disabled { opacity: .3; cursor: default; }
      .cwd { display: none; gap: 4px; padding: 0 12px 6px; }
      .cwd.show { display: grid; }
      .cwd label { font-size: 11px; color: var(--muted-foreground); }
      .cwd input { border: 1px solid var(--input); border-radius: 6px; padding: 5px 8px; background: transparent; color: var(--foreground); outline: 0; }
      .cwd input:focus { border-color: var(--ring); }
      .composer .prompt { margin: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent; }
      .composer .chip-row { padding: 10px 10px 0; display: flex; }
      .head, .composer .chip-row { cursor: grab; user-select: none; }
      .pop.dragging { animation: none; box-shadow: 0 18px 50px -12px rgb(0 0 0 / .45); }
      .pop.dragging .head, .pop.dragging .chip-row { cursor: grabbing; }
      .thread .prompt { margin-top: 0; }

      /* Conversation */
      .conv { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .msg-user { align-self: flex-end; max-width: 88%; background: var(--muted); color: var(--foreground); padding: 7px 11px;
        border-radius: 14px 14px 4px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .msg-user.pending { opacity: .55; }
      .msg-user.proposal { background: transparent; border: 1px dashed color-mix(in oklch, var(--brand) 60%, var(--border)); }
      .msg-assistant { display: flex; flex-direction: column; gap: 2px; }
      .msg-assistant .body { white-space: pre-wrap; overflow-wrap: anywhere; }
      .msg-assistant code { background: var(--muted); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
      .msg-assistant code.block { display: block; padding: 8px; white-space: pre-wrap; margin: 4px 0; }
      .msg-assistant strong { font-weight: 600; }
      .msg-assistant .actions { display: flex; gap: 2px; margin-left: -6px; }
      .msg-assistant .actions .btn-icon { width: 24px; height: 24px; }
      .msg-error { display: flex; gap: 8px; align-items: flex-start; color: var(--destructive); font-size: 12px;
        background: color-mix(in oklch, var(--destructive) 8%, transparent); border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .msg-error .i { margin-top: 2px; }

      /* Trace (outils) */
      .trace { display: flex; flex-direction: column; gap: 1px; }
      .trace .rows { display: flex; flex-direction: column; gap: 1px; border-left: 1px solid var(--border); margin-left: 10px; padding-left: 6px; }
      .trace .rows:only-child { margin-left: 6px; }
      .row-trigger { display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 4px; border: 0; border-radius: 6px; background: none;
        color: var(--muted-foreground); text-align: left; cursor: default; font-size: 12px; }
      .row-trigger.collapsible { cursor: pointer; }
      .row-trigger.collapsible:hover { background: var(--accent); color: var(--foreground); }
      .row-trigger .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .row-trigger .title b { font-weight: 500; color: var(--foreground); font-size: 12px; }
      .row-trigger .title .err { color: var(--destructive); font-size: 12px; }
      .row-trigger .chev { width: 12px; height: 12px; opacity: 0; transition: transform .15s; }
      .row-trigger.collapsible .chev { opacity: .6; }
      .row-trigger[aria-expanded="true"] .chev { transform: rotate(90deg); }
      .row.error .row-trigger, .row.error .title b { color: var(--destructive); }
      .row pre { margin: 2px 0 6px 20px; max-height: 16rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
        background: var(--muted); color: var(--muted-foreground); border-radius: 6px; padding: 8px; font-size: 11px; }

      /* Changements d'un commentaire (diff + annulation) */
      .changes { display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: 8px; padding: 4px; }
      .changes .add { color: var(--success); } .changes .del { color: var(--destructive); } .changes .zero { color: var(--muted-foreground); }
      .changes .count { flex: none; font-size: 11px; display: flex; gap: 4px; }
      .changes .count span { font-size: 11px; }
      .changes .files { display: flex; flex-direction: column; gap: 1px; margin-left: 10px; padding-left: 6px; border-left: 1px solid var(--border); }
      .changes .files .title { direction: rtl; text-align: left; }
      .changes.reverted > .row-trigger .title, .changes.reverted > .row-trigger .count { text-decoration: line-through; opacity: .7; }
      pre.diff { margin: 2px 0 6px; max-height: 14rem; overflow: auto; white-space: pre; background: var(--muted); color: var(--foreground);
        border-radius: 6px; padding: 6px 0; font-size: 11px; line-height: 1.45; }
      pre.diff span { display: block; padding: 0 8px; min-width: max-content; font: inherit; }
      pre.diff .dl-add { background: color-mix(in oklch, var(--success) 16%, transparent); }
      pre.diff .dl-del { background: color-mix(in oklch, var(--destructive) 13%, transparent); }
      pre.diff .dl-hunk { color: var(--muted-foreground); }
      .btn-ghost { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer;
        color: var(--muted-foreground); font-size: 12px; padding: 3px 6px; border-radius: 6px; }
      .btn-ghost span { font-size: 12px; }
      .btn-ghost:hover { background: var(--accent); color: var(--foreground); }
      .btn-ghost.confirm, .btn-ghost.confirm:hover { color: var(--destructive); background: color-mix(in oklch, var(--destructive) 8%, transparent); }
      .btn-ghost:disabled { cursor: default; opacity: .6; }
      .changes .done-note { display: flex; align-items: center; gap: 6px; padding: 3px 6px; font-size: 12px; color: var(--muted-foreground); }

      /* Shimmer (texte qui scintille pendant le travail) */
      .shimmer { background: linear-gradient(110deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%);
        background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent !important;
        animation: shimmer 2s linear infinite; }
      .shimmer b { color: transparent !important; }
      @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }

      /* État courant du fil, en bas */
      .status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted-foreground); padding: 0 4px; }
      .status span { font-size: 12px; }
      .status .meta { margin-left: auto; font-size: 11px; font-variant-numeric: tabular-nums; }
      .status.done > .i { color: var(--success); }
      .status.error > .i, .status.error .label { color: var(--destructive); }
      .proposal { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; background: color-mix(in oklch, var(--brand) 7%, transparent); }
      .proposal .from { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted-foreground); }
      .proposal .from .i { color: var(--brand); width: 12px; height: 12px; }
      .proposal .from span { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .btn-primary { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 0; border-radius: 7px;
        background: var(--primary); color: var(--primary-foreground); font-size: 12px; font-weight: 500; cursor: pointer; }
      .btn-primary span { font-size: 12px; font-weight: 500; }
      .btn-primary .i { width: 12px; height: 12px; }
      .btn-primary:hover { opacity: .9; } .btn-primary:disabled { opacity: .5; cursor: default; }
      .netline { padding: 0 12px 4px; font-size: 11px; color: var(--destructive); }
      .netline:empty { display: none; }

      /* ---- toasts ---- */
      .toasts { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column-reverse; gap: 8px;
        align-items: center; width: max-content; max-width: min(440px, calc(100vw - 32px)); }
      .toast { display: flex; align-items: center; gap: 10px; pointer-events: auto; max-width: 100%; padding: 9px 8px 9px 12px; border-radius: var(--radius);
        background: var(--popover); color: var(--foreground); border: 1px solid var(--border); box-shadow: var(--shadow);
        animation: toast-in .18s ease-out; }
      .toast > span { font-size: 12px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .toast > .i { color: var(--muted-foreground); }
      .toast.error > .i { color: var(--destructive); } .toast.success > .i { color: var(--success); }
      .toast .act { flex: none; height: 26px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px;
        background: var(--background); color: var(--foreground); font-size: 12px; font-weight: 500; cursor: pointer; }
      .toast .act:hover { background: var(--accent); } .toast .act:disabled { opacity: .6; cursor: default; }
      .toast .btn-icon { width: 24px; height: 24px; }
      @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }

      @media (prefers-reduced-motion: reduce) {
        *, *::after, *::before { animation: none !important; transition: none !important; }
        .shimmer { color: var(--muted-foreground) !important; background: none; }
        .shimmer b { color: var(--foreground) !important; }
        .glow.running { outline: 1.5px solid var(--brand); }
        .pin.running { box-shadow: 0 0 0 2px var(--background), 0 0 0 4px color-mix(in oklch, var(--brand) 40%, transparent); }
      }
    </style>
    <div class="glows"></div>
    <div class="hl"><div class="tag">${icon("target")}<span class="name"></span><span class="dim"></span></div></div>
    <div class="pins" role="group" aria-label="Commentaires Claude"></div>
    <div class="peek" aria-hidden="true"><span class="state"></span><span class="text"></span></div>

    <div class="pop composer" role="dialog" aria-label="Nouveau commentaire">
      <div class="chip-row"><button class="badge el-chip" title="Montrer l'élément">${icon("target")}<span></span></button></div>
      <div class="prompt">
        <textarea rows="3" placeholder="Que faut-il changer ?" aria-label="Commentaire"></textarea>
        <div class="cwd"><label for="cwd">Dossier du projet pour ce site</label><input id="cwd" placeholder="~/mon-projet" spellcheck="false" /></div>
        <div class="bar"><span class="grow"></span>
          <button class="send" aria-label="Envoyer à Claude" disabled>${icon("send")}</button></div>
      </div>
    </div>

    <div class="pop thread" role="dialog" aria-label="Fil du commentaire">
      <div class="head">
        <span class="num"></span>
        <span class="grow"><button class="badge el-chip" title="Montrer l'élément">${icon("target")}<span></span></button></span>
        <button class="btn-icon resolve" title="Résoudre" aria-label="Résoudre">${icon("check")}</button>
        <button class="btn-icon close" title="Fermer" aria-label="Fermer">${icon("x")}</button>
      </div>
      <div class="conv"></div>
      <div class="netline" role="status"></div>
      <div class="prompt">
        <textarea rows="1" placeholder="Répondre…" aria-label="Réponse" style="min-height: 38px"></textarea>
        <div class="bar"><span class="grow"></span>
          <button class="send" aria-label="Envoyer" disabled>${icon("send")}</button></div>
      </div>
    </div>
    <div class="toasts"></div>
    <div class="sr" aria-live="polite"></div>`;
  document.documentElement.appendChild(host);
  // Les évènements de notre UI ne doivent pas atteindre la page (raccourcis, menus…).
  for (const t of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "pointerdown", "pointerup", "wheel", "focusin", "focusout", "input"]) {
    host.addEventListener(t, (e) => e.stopPropagation());
  }
  const setHidden = (on) => host.toggleAttribute("data-hidden", on);

  const q = (s, r = root) => r.querySelector(s);
  const hl = q(".hl"), glowsEl = q(".glows"), pinsEl = q(".pins"), toastsEl = q(".toasts"), peek = q(".peek"), live = q(".sr");
  const composer = q(".composer"), ta = q("textarea", composer), sendBtn = q(".send", composer);
  const cwdBox = q(".cwd", composer), cwdInput = q("input", cwdBox);
  const thread = q(".thread"), conv = q(".conv"), netEl = q(".netline"), replyTa = q("textarea", thread), replyBtn = q(".send", thread);
  const resolveBtn = q(".resolve", thread);

  let comments = [], knownCwd = "", target = null, openId = null, pageUrl = location.href, pollTimer = null;
  let lastStatus = null;   // id -> statut au dernier poll (pour annoncer les fins)
  let pageFocus = null;    // élément de la page qui avait le focus avant d'ouvrir une bulle
  const openRows = new Set(); // lignes d'outil / groupes dépliés par l'utilisateur
  const announce = (text) => { live.textContent = ""; setTimeout(() => (live.textContent = text), 50); };

  // ---------- liaison avec le service worker ----------
  async function call(type, payload = {}) {
    let res;
    try { res = await chrome.runtime.sendMessage({ type, ...payload }); }
    catch { throw new Error("Extension rechargée : recharge la page."); }
    if (res?.error) throw Object.assign(new Error(res.error), { code: res.code });
    return res?.data;
  }

  // ---------- toasts ----------
  // toast(texte, code) pour une erreur ; toast(texte, { kind, action: { label, run }, duration }) sinon.
  // code "noapp" : l'app est fermée, on propose de l'ouvrir.
  function toast(text, opts) {
    if (typeof opts !== "object" || !opts) opts = { code: opts };
    const kind = opts.kind || "error";
    let action = opts.action;
    if (opts.code === "noapp") action = { label: "Ouvrir l'app", run: openApp };
    const duration = opts.duration ?? (opts.code === "noapp" ? 10000 : kind === "error" ? 6000 : 4000);
    for (const old of toastsEl.children) if (old.dataset.text === text) old.remove();
    while (toastsEl.children.length >= 3) toastsEl.firstElementChild.remove();
    const t = document.createElement("div");
    t.className = "toast " + kind;
    t.dataset.text = text;
    t.setAttribute("role", kind === "error" ? "alert" : "status");
    t.innerHTML = `${icon(kind === "error" ? "alert" : kind === "success" ? "check" : "sparkles")}<span></span>`;
    q("span", t).textContent = text;
    if (action) {
      const b = document.createElement("button");
      b.className = "act";
      b.textContent = action.label;
      b.onclick = async () => { b.disabled = true; try { await action.run(t); } finally { dismiss(); } };
      t.appendChild(b);
    }
    const x = document.createElement("button");
    x.className = "btn-icon";
    x.setAttribute("aria-label", "Fermer");
    x.innerHTML = icon("x");
    x.onclick = () => dismiss();
    t.appendChild(x);
    toastsEl.appendChild(t);
    let timer = 0;
    const arm = () => { clearTimeout(timer); if (duration) timer = setTimeout(dismiss, duration); };
    function dismiss() { clearTimeout(timer); t.remove(); }
    t.addEventListener("mouseenter", () => clearTimeout(timer));
    t.addEventListener("mouseleave", arm);
    arm();
    return t;
  }
  async function openApp(t) {
    q("span", t).textContent = "Ouverture de l'app…";
    try { await call("openApp"); poll(0); }
    catch (err) { toast(err.message, err.code === "noapp" ? undefined : err.code); }
  }

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
  const find = (selector) => { try { return selector ? document.querySelector(selector) : null; } catch { return null; } };

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

  // ---------- placement ----------
  function place(box, el) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px" });
    return r;
  }
  function placeHl(el) {
    const r = place(hl, el);
    hl.classList.toggle("below", r.top < 26);
    q(".tag .name", hl).textContent = label(el);
    q(".tag .dim", hl).textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
  }
  // Position choisie à la main (glisser l'en-tête) : prioritaire sur le placement automatique.
  const manualPos = new Map(); // clé (id du fil, ou "composer") -> { left, top }
  const side = new Map();      // bulle -> côté retenu tant qu'elle reste ouverte (évite les sauts)
  const popKey = (pop) => (pop === thread ? openId : "composer");
  const PAD = 8, GAP = 12;
  const clampPos = (pop, left, top) => ({
    left: Math.min(Math.max(PAD, left), Math.max(PAD, innerWidth - pop.offsetWidth - PAD)),
    top: Math.min(Math.max(PAD, top), Math.max(PAD, innerHeight - Math.min(pop.offsetHeight, 120) - PAD)),
  });
  // À droite de l'élément, sinon à gauche, dessous, dessus ; sinon du côté le plus dégagé.
  function placePop(pop, el) {
    const manual = manualPos.get(popKey(pop));
    if (manual) {
      const { left, top } = clampPos(pop, manual.left, manual.top);
      return Object.assign(pop.style, { left: left + "px", top: top + "px" });
    }
    const w = pop.offsetWidth || 360, h = pop.offsetHeight || 220, vw = innerWidth, vh = innerHeight;
    const cx = (x) => Math.min(Math.max(PAD, x), Math.max(PAD, vw - w - PAD));
    const cy = (y) => Math.min(Math.max(PAD, y), Math.max(PAD, vh - h - PAD));
    if (!el) return Object.assign(pop.style, { left: cx(vw - w - 16) + "px", top: cy(16) + "px" });
    const r = el.getBoundingClientRect();
    const spots = {
      // La pastille est centrée sur le coin haut droit : on laisse sa demi-largeur de marge.
      right: [r.right + GAP + 8, cy(r.top), r.right + GAP + 8 + w <= vw - PAD],
      left: [r.left - GAP - w, cy(r.top), r.left - GAP - w >= PAD],
      below: [cx(r.left), r.bottom + GAP, r.bottom + GAP + h <= vh - PAD],
      above: [cx(r.left), r.top - GAP - h, r.top - GAP - h >= PAD],
    };
    let s = side.get(pop);
    if (!s || !spots[s][2]) s = Object.keys(spots).find((k) => spots[k][2]);
    if (!s) {
      const room = { right: vw - r.right, left: r.left, below: vh - r.bottom, above: r.top };
      s = Object.keys(room).reduce((a, b) => (room[b] > room[a] ? b : a));
    }
    side.set(pop, s);
    Object.assign(pop.style, { left: cx(spots[s][0]) + "px", top: cy(spots[s][1]) + "px" });
  }

  // ---------- ⌘+clic ----------
  const isOurs = (e) => e.composedPath().includes(host);
  const mod = (e) => e.metaKey || e.ctrlKey;
  let hovered = null;

  addEventListener("mousemove", (e) => {
    if (target) return;
    if (!mod(e) || isOurs(e)) { hl.style.display = "none"; return; }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host || el === document.documentElement) return;
    hovered = el;
    placeHl(el);
  }, true);
  addEventListener("keyup", (e) => { if ((e.key === "Meta" || e.key === "Control") && !target) hl.style.display = "none"; }, true);
  addEventListener("blur", () => { if (!target) hl.style.display = "none"; });

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
    if (openId) closeThread(false);
    if (target && !ta.value.trim()) closeComposer(false);
  }, true);

  function makeDraggable(pop, handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button, textarea, input")) return;
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
    // Double-clic sur la poignée : la bulle revient près de son élément.
    handle.addEventListener("dblclick", (e) => {
      if (e.target.closest("button, textarea, input")) return;
      manualPos.delete(popKey(pop));
      side.delete(pop);
      position();
    });
  }

  // Tab / ⇧Tab tournent dans la bulle ouverte.
  function trapTab(pop) {
    pop.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const f = [...pop.querySelectorAll("button:not([disabled]), textarea, input")].filter((x) => x.tabIndex >= 0 && x.getClientRects().length);
      if (!f.length) return;
      const i = f.indexOf(root.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
  }
  function rememberPageFocus() {
    if (!root.activeElement) pageFocus = document.activeElement;
  }
  function restorePageFocus() {
    if (!root.activeElement) return;
    root.activeElement.blur();
    try { pageFocus?.focus?.({ preventScroll: true }); } catch {}
    pageFocus = null;
  }

  function autoGrow(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 200) + "px"; }

  function openComposer(el, keepText = "") {
    if (!el || el === host) return;
    rememberPageFocus();
    closeThread(false);
    target = el;
    manualPos.delete("composer");
    side.delete(composer);
    placeHl(el);
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
  function closeComposer(restore = true) {
    target = null;
    composer.classList.remove("open");
    hl.style.display = "none";
    if (restore) restorePageFocus();
  }
  async function submit() {
    const text = ta.value.trim();
    const cwd = cwdInput.value.trim();
    if (!text || !target) return;
    const el = target, info = describe(target);
    if (cwd) knownCwd = cwd;
    closeComposer(false);
    // Pastille provisoire, le temps que le bridge réponde.
    const temp = { id: "sending", n: "", status: "sending", selector: info.selector, text, messages: [] };
    comments.push(temp);
    render();
    // On masque l'UI pendant que le service worker fait la capture d'écran (au début de « create »).
    setHidden(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const reveal = setTimeout(() => setHidden(false), 700);
    try {
      const created = await call("create", { comment: { ...info, text }, cwd });
      comments = comments.filter((c) => c !== temp && c.id !== created.id);
      comments.push(created);
      lastStatus?.set(created.id, created.status);
      render();
      openThread(created.id);
    } catch (e) {
      comments = comments.filter((c) => c !== temp);
      render();
      setHidden(false);
      // Rien n'est perdu : la bulle revient avec le texte.
      openComposer(el, text);
      if (/dossier du projet/.test(e.message)) {
        knownCwd = "";
        cwdBox.classList.add("show");
        cwdInput.value = "";
        setTimeout(() => cwdInput.focus(), 0);
      }
      toast(e.message, e.code);
    } finally {
      clearTimeout(reveal);
      setHidden(false);
    }
    poll(0);
  }
  ta.addEventListener("input", () => { sendBtn.disabled = !ta.value.trim(); autoGrow(ta); });
  sendBtn.onclick = submit;
  composer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === "Escape") { e.preventDefault(); closeComposer(); }
  });
  q(".el-chip", composer).onclick = () => target && flashEl(target);
  makeDraggable(composer, q(".chip-row", composer));
  makeDraggable(thread, q(".head", thread));
  trapTab(composer);
  trapTab(thread);

  // ---------- fil de discussion ----------
  function openThread(id, focus = true) {
    rememberPageFocus();
    closeComposer(false);
    if (openId !== id) side.delete(thread);
    openId = id;
    call("seen", { id }).catch(() => {}); // plus « non lu » dans le side panel
    thread.classList.add("open");
    hidePeek();
    render();
    renderThread(true);
    if (focus) setTimeout(() => replyTa.focus(), 0);
  }
  // restore : true = on rend le focus (à la pastille si elle existe, sinon à la page).
  function closeThread(restore = true) {
    const id = openId;
    openId = null;
    thread.classList.remove("open");
    netEl.textContent = "";
    for (const p of pinsEl.children) p.classList.remove("open");
    for (const g of glowsEl.children) g.classList.remove("lit");
    if (!restore || !id) return;
    const pin = [...pinsEl.children].find((p) => p.dataset.id === id && p.style.display !== "none");
    if (pin && root.activeElement) pin.focus({ preventScroll: true });
    else restorePageFocus();
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
    row.innerHTML = `<button class="row-trigger${collapsible ? " collapsible" : ""}" data-k="r:${esc(m.id || "")}" ${collapsible ? `aria-expanded="${open}"` : "tabindex=-1"}>
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

  // Résumé d'un groupe d'outils terminé : « 2 fichiers lus · 1 fichier modifié · 1 commande ».
  function summarize(tools) {
    const n = { read: new Set(), edit: new Set(), search: 0, bash: 0, other: 0 };
    let errors = 0;
    for (const m of tools) {
      if (m.isError) errors++;
      const fam = TOOLS[m.name]?.[3] || "other";
      if (fam === "read" || fam === "edit") n[fam].add(m.target || m.id);
      else n[fam]++;
    }
    const plural = (k, one, many) => (k ? `${k} ${k > 1 ? many : one}` : "");
    const parts = [
      plural(n.read.size, "fichier lu", "fichiers lus"), plural(n.edit.size, "fichier modifié", "fichiers modifiés"),
      plural(n.search, "recherche", "recherches"), plural(n.bash, "commande", "commandes"), plural(n.other, "outil", "outils"),
    ].filter(Boolean).map(esc);
    if (errors) parts.push(`<span class="err">${plural(errors, "échec", "échecs")}</span>`);
    return parts.join(" · ");
  }

  // Groupe de lignes d'outils (Trace). Fini : replié derrière son résumé.
  // En cours : les 3 dernières lignes, les précédentes repliées.
  function traceBlock(tools, liveGroup) {
    const box = document.createElement("div");
    box.className = "trace";
    const key = "g:" + (tools[0].id || tools[0].text || "");
    const expanded = openRows.has(key);
    let rows = tools, toggle = null;
    if (tools.length > 1 && !liveGroup) {
      toggle = summarize(tools);
      rows = expanded ? tools : [];
    } else if (liveGroup && tools.length > 4) {
      toggle = `${tools.length - 3} étapes précédentes`;
      rows = expanded ? tools : tools.slice(-3);
    }
    if (toggle) {
      const b = document.createElement("button");
      b.className = "row-trigger collapsible";
      b.dataset.k = key;
      b.setAttribute("aria-expanded", expanded);
      b.innerHTML = `${icon("steps")}<span class="title">${toggle}</span>${icon("chevron", "chev")}`;
      b.onclick = () => { expanded ? openRows.delete(key) : openRows.add(key); renderThread(false); };
      box.appendChild(b);
    }
    if (rows.length) {
      const list = document.createElement("div");
      list.className = "rows";
      for (const m of rows) list.appendChild(toolRow(m));
      box.appendChild(list);
    }
    return box;
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
    pre.tabIndex = 0;
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
    box.innerHTML = `<button class="row-trigger collapsible" data-k="d:${esc(c.id)}" aria-expanded="${open}">${icon("diff")}
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
        row.dataset.k = "f:" + f.path;
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
      note.innerHTML = `${icon("undo")}<span>Changement annulé</span>`;
      box.appendChild(note);
    } else {
      const confirming = confirmRevert === c.id;
      const b = document.createElement("button");
      b.className = "btn-ghost" + (confirming ? " confirm" : "");
      b.dataset.k = "u:" + c.id;
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
        b.innerHTML = `${icon("loader", "spin")}<span>Annulation…</span>`;
        try {
          const data = await call("revert", { id: c.id });
          diffs.set(c.id, { key: String(c.finishedAt || ""), data });
          announce("Changement annulé");
        } catch (e) { toast(e.message, e.code); }
        renderThread(false);
      };
      box.appendChild(b);
    }
    return box;
  }

  // Bas du fil : ce qui se passe maintenant (ou comment ça s'est fini).
  function statusLine(c, last) {
    const s = document.createElement("div");
    s.className = "status " + c.status;
    if (c.status === "queued") s.innerHTML = `${icon("clock")}<span>En attente d'un autre commentaire…</span>`;
    else if (c.status === "running") {
      if (last.role === "tool" && last.running) return null; // la ligne d'outil scintille déjà
      s.innerHTML = `<span class="shimmer">Claude réfléchit…</span>`;
    } else if (c.status === "done") s.innerHTML = `${icon("check")}<span class="label">Terminé</span>`;
    else if (c.status === "error") {
      if (last.role === "error") { if (!c.stats) return null; s.innerHTML = ""; }
      else s.innerHTML = `${icon("alert")}<span class="label">Échec</span>`;
    } else return null;
    if (c.stats && (c.status === "done" || c.status === "error")) {
      const m = document.createElement("span");
      m.className = "meta";
      m.textContent = c.stats;
      s.appendChild(m);
    }
    return s;
  }

  function proposalCard(c) {
    const parent = comments.find((x) => x.id === c.parentId);
    const box = document.createElement("div");
    box.className = "proposal";
    box.innerHTML = `<div class="from">${icon("sparkles")}<span></span></div>
      <button class="btn-primary" data-k="launch">${icon("play")}<span>Lancer</span></button>`;
    q(".from span", box).textContent = parent?.text ? `Proposé par « ${parent.text.split("\n")[0]} »` : "Proposé par la conversation";
    q(".from", box).title = parent?.text || "";
    const b = q("button", box);
    b.onclick = () => launch(b);
    return box;
  }

  function renderThread(scrollDown) {
    const c = comments.find((x) => x.id === openId);
    if (!c) return closeThread(false);
    // Fini pendant que le fil était ouvert : déjà lu.
    if (c.finishedAt && renderThread.seen !== c.id + c.finishedAt) { renderThread.seen = c.id + c.finishedAt; call("seen", { id: c.id }).catch(() => {}); }
    for (const p of pinsEl.children) p.classList.toggle("open", p.dataset.id === c.id);
    for (const g of glowsEl.children) g.classList.toggle("lit", g.dataset.id === c.id);
    const num = q(".num", thread);
    num.className = "num " + c.status;
    num.textContent = c.n;
    num.title = STATE[c.status] || "";
    thread.setAttribute("aria-label", `Commentaire ${c.n} — ${STATE[c.status] || ""}`);
    const el = find(c.selector);
    const chip = q(".el-chip", thread);
    q("span", chip).textContent = c.label || "élément";
    chip.classList.toggle("missing", !el);
    chip.title = el ? "Montrer l'élément" : "Élément introuvable sur la page";
    const proposed = c.status === "proposed";
    resolveBtn.classList.toggle("discard", proposed);
    resolveBtn.innerHTML = icon(proposed ? "trash" : "check");
    resolveBtn.title = proposed ? "Écarter" : "Résoudre";
    resolveBtn.setAttribute("aria-label", resolveBtn.title);

    // Focus conservé à travers le re-rendu.
    const fk = root.activeElement && conv.contains(root.activeElement) ? root.activeElement.dataset?.k : null;
    const atBottom = conv.scrollHeight - conv.scrollTop - conv.clientHeight < 24;
    const keep = conv.scrollTop;
    conv.innerHTML = "";
    const messages = [{ role: "user", text: c.text, first: true }, ...(c.messages || [])];
    const lastAssistant = messages.map((m) => m.role).lastIndexOf("assistant");
    // Messages consécutifs d'outils regroupés.
    const blocks = [];
    messages.forEach((m, idx) => {
      if (m.role === "tool") {
        const prev = blocks[blocks.length - 1];
        if (prev?.tools) prev.tools.push(m); else blocks.push({ tools: [m] });
      } else blocks.push({ m, idx });
    });
    const finished = c.status === "done" || c.status === "error";
    let changesShown = false;
    blocks.forEach((b, bi) => {
      if (b.tools) return conv.appendChild(traceBlock(b.tools, c.status === "running" && bi === blocks.length - 1));
      const { m, idx } = b;
      const d = document.createElement("div");
      if (m.role === "user") {
        d.className = "msg-user" + (m.pending ? " pending" : "") + (m.first && proposed ? " proposal" : "");
        d.textContent = m.text;
      } else if (m.role === "error") { d.className = "msg-error"; d.innerHTML = icon("alert") + `<span>${esc(m.text)}</span>`; }
      else {
        d.className = "msg-assistant";
        d.innerHTML = `<div class="body">${md(m.text)}</div>`;
        if (idx === lastAssistant && c.status !== "running") {
          const actions = document.createElement("div");
          actions.className = "actions";
          actions.innerHTML = `<button class="btn-icon" data-k="copy" title="Copier" aria-label="Copier">${icon("copy")}</button>`;
          const btn = q("button", actions);
          btn.onclick = async () => {
            await navigator.clipboard.writeText(m.text).catch(() => {});
            btn.innerHTML = icon("check");
            setTimeout(() => (btn.innerHTML = icon("copy")), 2000);
          };
          d.appendChild(actions);
        }
      }
      conv.appendChild(d);
      if (idx === lastAssistant && finished) {
        const ch = changesBlock(c);
        if (ch) { conv.appendChild(ch); changesShown = true; }
      }
    });
    if (finished && !changesShown && lastAssistant < 0) { const ch = changesBlock(c); if (ch) conv.appendChild(ch); }
    const last = messages[messages.length - 1];
    if (proposed) conv.appendChild(proposalCard(c));
    const s = statusLine(c, last);
    if (s) conv.appendChild(s);
    replyTa.placeholder = proposed ? "Préciser et lancer…" : "Répondre…";
    conv.scrollTop = scrollDown || atBottom ? conv.scrollHeight : keep;
    if (fk) q(`[data-k="${CSS.escape(fk)}"]`, conv)?.focus({ preventScroll: true });
    placePop(thread, el);
  }
  q(".close", thread).onclick = () => closeThread();
  async function launch(btn) {
    const c = comments.find((x) => x.id === openId);
    if (!c) return;
    if (btn) { btn.disabled = true; btn.innerHTML = `${icon("loader", "spin")}<span>Lancement…</span>`; }
    try {
      const updated = await call("launch", { id: c.id, url: location.href, selectors: { [c.id]: c.selector } });
      if (updated?.id) comments = comments.map((x) => (x.id === updated.id ? updated : x));
      else c.status = "queued";
      lastStatus?.set(c.id, "queued");
      render();
    } catch (e) {
      toast(e.message, e.code);
      renderThread(false);
    }
    poll(0);
  }
  q(".el-chip", thread).onclick = () => { const c = comments.find((x) => x.id === openId); if (c) flashEl(find(c.selector)); };
  resolveBtn.onclick = async () => {
    const id = openId;
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    const proposed = c.status === "proposed";
    closeThread();
    comments = comments.filter((x) => x.id !== id);
    render();
    try {
      await call("resolve", { id });
      toast(`Commentaire ${c.n} ${proposed ? "écarté" : "résolu"}`, {
        kind: "success",
        action: { label: "Annuler", run: async () => { try { await call("reopen", { id }); } catch (e) { toast(e.message, e.code); } poll(0); } },
      });
    } catch (e) { toast(e.message, e.code); poll(0); }
  };
  async function reply() {
    const text = replyTa.value.trim();
    const c = comments.find((x) => x.id === openId);
    if (!text || !c) return;
    replyTa.value = "";
    replyBtn.disabled = true;
    autoGrow(replyTa);
    // Affichage immédiat ; le bridge confirme ensuite.
    const proposed = c.status === "proposed";
    const el = proposed && find(c.selector);
    const pending = { role: "user", text, pending: true };
    if (!proposed) { c.messages = [...(c.messages || []), pending]; c.status = "queued"; }
    else c.status = "queued";
    renderThread(true);
    try {
      const updated = await call("reply", { id: c.id, text, detail: el ? describe(el) : undefined });
      comments = comments.map((x) => (x.id === updated.id ? updated : x));
      lastStatus?.set(updated.id, updated.status);
      render();
      renderThread(true);
    } catch (err) {
      poll(0);
      if (!replyTa.value) { replyTa.value = text; replyBtn.disabled = false; autoGrow(replyTa); }
      toast(err.message, err.code);
      return;
    }
    poll(0);
  }
  replyTa.addEventListener("input", () => { replyBtn.disabled = !replyTa.value.trim(); autoGrow(replyTa); });
  replyBtn.onclick = reply;
  thread.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); return closeThread(); }
    if (e.target === replyTa && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); reply(); }
  });

  function flashEl(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    setTimeout(() => {
      const f = document.createElement("div");
      f.className = "flash";
      root.appendChild(f);
      place(f, el);
      setTimeout(() => f.remove(), 1300);
    }, reduceMotion.matches ? 0 : 350);
  }

  // ---------- pastilles + contours ----------
  function hidePeek() { peek.classList.remove("show"); for (const g of glowsEl.children) if (g.dataset.id !== openId) g.classList.remove("lit"); }
  function showPeek(pin, c) {
    if (openId === c.id || c.status === "sending") return;
    const st = q(".state", peek);
    st.className = "state " + c.status;
    st.textContent = STATE[c.status] || "";
    q(".text", peek).textContent = c.text;
    const r = pin.getBoundingClientRect();
    const below = r.top < 90;
    peek.classList.toggle("below", below);
    Object.assign(peek.style, { left: Math.min(Math.max(140, r.left + r.width / 2), innerWidth - 140) + "px", top: r.bottom + "px" });
    peek.classList.add("show");
    for (const g of glowsEl.children) if (g.dataset.id === c.id) g.classList.add("lit");
  }

  function render() {
    pinsEl.innerHTML = "";
    glowsEl.innerHTML = "";
    hidePeek();
    const shown = comments.filter((c) => c.kind !== "conversation" && c.selector);
    const compact = shown.length >= 6;
    for (const c of shown) {
      const g = document.createElement("div");
      g.className = "glow " + c.status + (openId === c.id ? " lit" : "");
      g.dataset.selector = c.selector;
      g.dataset.id = c.id;
      glowsEl.appendChild(g);
      const p = document.createElement("button");
      p.className = "pin " + c.status + (openId === c.id ? " open" : "") + (compact && c.status === "done" ? " compact" : "");
      p.innerHTML = c.status === "sending" ? icon("loader", "spin") : esc(c.n);
      p.setAttribute("aria-label", c.status === "sending" ? "Envoi du commentaire" : `Commentaire ${c.n}, ${STATE[c.status] || ""} : ${c.text}`);
      p.dataset.selector = c.selector;
      p.dataset.id = c.id;
      if (c.status !== "sending") {
        p.onclick = () => (openId === c.id ? closeThread() : openThread(c.id));
        p.onmouseenter = p.onfocus = () => showPeek(p, c);
        p.onmouseleave = p.onblur = hidePeek;
      }
      pinsEl.appendChild(p);
    }
    if (openId) renderThread(false);
    position();
  }
  function position() {
    if (!host.isConnected) document.documentElement.appendChild(host); // page qui réécrit <html>
    const vw = innerWidth, vh = innerHeight, placed = [];
    for (const d of [...pinsEl.children, ...glowsEl.children]) {
      const el = find(d.dataset.selector);
      const r = el?.getBoundingClientRect();
      // Élément absent, masqué ou hors de l'écran : rien à montrer.
      if (!r || (r.width < 1 && r.height < 1) || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) { d.style.display = "none"; continue; }
      if (d.classList.contains("pin")) {
        // Coin haut droit de l'élément, gardé dans l'écran ; décalé à gauche si une autre pastille y est déjà.
        let x = Math.min(Math.max(14, r.right), vw - 14), y = Math.max(26, r.top);
        while (placed.some((o) => Math.abs(o.x - x) < 24 && Math.abs(o.y - y) < 22)) x -= 26;
        placed.push({ x, y });
        Object.assign(d.style, { display: "grid", left: x + "px", top: y + "px" });
      } else Object.assign(d.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px" });
    }
    if (target) { placeHl(target); placePop(composer, target); }
    const open = comments.find((c) => c.id === openId);
    if (open) placePop(thread, find(open.selector));
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; hidePeek(); position(); }); };
  addEventListener("scroll", schedule, true);
  addEventListener("resize", schedule);
  setInterval(position, 800); // la page peut bouger (HMR, rendu async)

  // Fin d'un commentaire dont le fil est fermé : on le signale.
  function notifyFinished(list) {
    const prev = lastStatus;
    lastStatus = new Map(list.map((c) => [c.id, c.status]));
    if (!prev) return;
    for (const c of list) {
      const was = prev.get(c.id);
      if (c.kind === "conversation" || (was !== "running" && was !== "queued") || (c.status !== "done" && c.status !== "error")) continue;
      const ok = c.status === "done";
      announce(`Commentaire ${c.n} ${ok ? "terminé" : "en erreur"}`);
      if (openId === c.id) continue;
      toast(ok ? `Commentaire ${c.n} terminé` : `Commentaire ${c.n} : échec`, {
        kind: ok ? "success" : "error",
        action: { label: "Voir", run: () => { find(c.selector)?.scrollIntoView({ block: "center", behavior: scrollBehavior() }); openThread(c.id); } },
      });
    }
  }

  // ---------- synchronisation avec le bridge ----------
  function poll(delay) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (location.href !== pageUrl) { pageUrl = location.href; closeThread(false); closeComposer(false); lastStatus = null; }
      let busy = false;
      if (document.visibilityState === "visible") {
        try {
          const { comments: list, cwd } = await call("list", { url: location.href });
          notifyFinished(list);
          const sending = comments.filter((c) => c.status === "sending");
          const changed = JSON.stringify(list) !== JSON.stringify(comments.filter((c) => c.status !== "sending"));
          comments = [...list, ...sending];
          knownCwd = cwd || knownCwd;
          netEl.textContent = "";
          if (changed) render();
          // Fil demandé depuis le side panel avant d'arriver sur cette page.
          const { pendingOpen } = await chrome.storage.local.get("pendingOpen");
          if (pendingOpen?.url === location.href.split("#")[0] && list.some((c) => c.id === pendingOpen.id)) {
            chrome.storage.local.remove("pendingOpen");
            const c = list.find((x) => x.id === pendingOpen.id);
            find(c.selector)?.scrollIntoView({ block: "center" });
            openThread(pendingOpen.id);
          }
          busy = list.some((c) => c.status === "queued" || c.status === "running");
        } catch (e) {
          if (/rechargée/.test(e.message)) { // extension rechargée : ce script est mort
            toast("Extension mise à jour : recharge la page (⌘R).", { kind: "info", duration: 0 });
            return;
          }
          if (openId) netEl.textContent = e.message;
        }
      }
      poll(busy || openId ? 1500 : 6000);
    }, delay);
  }
  // Le side panel demande d'ouvrir un fil sur cette page.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Instantané demandé pour une conversation : on masque notre UI le temps de la capture.
    if (msg.type === "cc:snapshot") {
      closeComposer(false);
      const data = { snapshot: snapshot(), url: location.href, title: document.title };
      setHidden(true);
      clearTimeout(unhide);
      unhide = setTimeout(() => setHidden(false), 2000);
      requestAnimationFrame(() => requestAnimationFrame(() => sendResponse(data)));
      return true;
    }
    if (msg.type === "cc:show") { clearTimeout(unhide); setHidden(false); poll(0); return; }
    if (msg.type === "cc:describe") {
      const out = {};
      for (const [id, sel] of Object.entries(msg.selectors || {})) { const el = find(sel); if (el) out[id] = describe(el); }
      sendResponse(out);
      return;
    }
    if (msg.type !== "cc:open") return;
    const c = comments.find((x) => x.id === msg.id);
    if (c) { find(c.selector)?.scrollIntoView({ block: "center", behavior: scrollBehavior() }); setTimeout(() => openThread(c.id), reduceMotion.matches ? 0 : 300); }
    else poll(0);
  });
  let unhide = 0;
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && poll(0));
  poll(0);

  // ---------- utilitaires ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function md(src) {
    return esc(src)
      .replace(/```\w*\n?([\s\S]*?)```/g, (_, c) => `<code class="block">${c}</code>`)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/^#{1,6} (.+)$/gm, "<strong>$1</strong>");
  }
})();
