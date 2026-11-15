// Service worker : relaie la page vers le bridge local (la page elle-même ne
// peut pas l'appeler) et fait la capture d'écran de l'élément commenté.
const BRIDGE = "http://127.0.0.1:7823";

// L'icône de l'extension ouvre le side panel.
// (Protégé : une erreur ici ne doit jamais empêcher le reste du service worker de démarrer.)
try { chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })?.catch(console.error); } catch (e) { console.error(e); }

async function config() {
  return { token: "", mode: "acceptEdits", projects: {}, ...(await chrome.storage.local.get(["token", "mode", "projects"])) };
}

async function bridge(method, pathname, body) {
  const { token } = await config();
  if (!token) throw new Error("Token manquant : clique l'icône de l'extension pour le renseigner.");
  let res;
  try {
    res = await fetch(BRIDGE + pathname, {
      method, headers: { "content-type": "application/json", "x-bridge-token": token },
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new Error("Bridge injoignable — lance : node bridge/server.mjs");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Dossier du projet pour une page : celui mémorisé pour le site, sinon (en local)
// celui du serveur de dev qui écoute sur le port de la page.
async function projectFor(pageUrl) {
  const { projects } = await config();
  return projects[new URL(pageUrl).origin] || (await detect(pageUrl));
}
async function detect(pageUrl) {
  const u = new URL(pageUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "";
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const { cwd } = await bridge("GET", "/detect?port=" + port).catch(() => ({}));
  return cwd || "";
}
async function remember(origin, cwd) {
  const { projects } = await config();
  if (cwd) projects[origin] = cwd; else delete projects[origin];
  await chrome.storage.local.set({ projects });
}

const handlers = {
  async list({ url }) {
    const comments = await bridge("GET", "/comments?url=" + encodeURIComponent(url));
    return { comments, cwd: await projectFor(url) };
  },
  async create({ comment, cwd }, sender) {
    const { mode } = await config();
    const origin = new URL(comment.url).origin;
    const image = await captureElement(sender.tab, comment.rect, comment.dpr).catch(() => null);
    // Essais dans l'ordre : dossier saisi/mémorisé, puis dossier détecté du serveur local.
    const tried = new Set();
    for (const candidate of [cwd, await projectFor(comment.url), await detect(comment.url)]) {
      const dir = (candidate || "").trim();
      if (!dir || tried.has(dir)) continue;
      tried.add(dir);
      try {
        const created = await bridge("POST", "/comments", { ...comment, cwd: dir, mode, image });
        await remember(origin, dir); // mémorisé seulement quand il est valide
        return created;
      } catch (e) {
        if (!/dossier introuvable/.test(e.message)) throw e;
      }
    }
    await remember(origin, ""); // un dossier invalide ne doit pas rester collé au site
    throw new Error("Indique le dossier du projet" + (tried.size ? ` (introuvable : ${[...tried].join(", ")})` : "") + ".");
  },
  async reply({ id, text }) {
    const { mode } = await config();
    return bridge("POST", "/reply", { id, text, mode });
  },
  resolve: ({ id }) => bridge("POST", "/resolve", { id }),

  // Conversation sur la page d'un onglet : instantané du DOM + capture, puis session parente.
  async converse({ tabId, text, cwd }) {
    const { mode } = await config();
    const tab = await chrome.tabs.get(tabId);
    const ctx = await pageContext(tab);
    const dir = (cwd || "").trim() || (await projectFor(tab.url));
    if (!dir) throw new Error("Indique le dossier du projet dans les réglages (⚙).");
    const conv = await bridge("POST", "/conversations", { url: tab.url, title: tab.title, text, cwd: dir, mode, ...ctx });
    await remember(new URL(tab.url).origin, dir);
    return conv;
  },
  // Suite d'une conversation : instantané frais si la page est ouverte (elle a pu changer).
  async converseReply({ id, url, text }) {
    const { mode } = await config();
    const tab = await tabFor(url);
    const ctx = tab ? await pageContext(tab).catch(() => ({})) : {};
    return bridge("POST", "/reply", { id, text, mode, ...ctx });
  },
  // Lance des commentaires proposés, avec la description de leurs éléments si la page est ouverte.
  async launch({ id, parentId, url, selectors }) {
    const { mode } = await config();
    let details = {};
    const tab = url && (await tabFor(url));
    if (tab && selectors) details = await chrome.tabs.sendMessage(tab.id, { type: "cc:describe", selectors }).catch(() => ({})) || {};
    return bridge("POST", "/launch", { id, parentId, mode, details });
  },
  diff: ({ id }) => bridge("GET", "/diff?id=" + encodeURIComponent(id)),
  revert: ({ id }) => bridge("POST", "/revert", { id }),
  // Historique : éléments résolus (archivés), détail complet, réouverture.
  history({ q, cwd, url, offset, limit }) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, cwd, url, offset, limit })) if (v != null && v !== "") p.set(k, v);
    return bridge("GET", "/history?" + p);
  },
  comment: ({ id }) => bridge("GET", "/comment?id=" + encodeURIComponent(id)),
  reopen: ({ id, text }) => bridge("POST", "/reopen", { id, text }),
  health: () => bridge("GET", "/health"),
  all: () => bridge("GET", "/all"),
  async seen({ id }) {
    const { seen = {} } = await chrome.storage.local.get("seen");
    seen[id] = Date.now();
    await chrome.storage.local.set({ seen });
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve(h(msg, sender)).then(
    (data) => sendResponse({ data }),
    (e) => sendResponse({ error: e.message }),
  );
  return true; // réponse asynchrone
});

const pageKey = (url) => String(url || "").split("#")[0];
async function tabFor(url) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => t.active && pageKey(t.url) === pageKey(url)) || tabs.find((t) => pageKey(t.url) === pageKey(url));
}

// Instantané (le script de page masque son UI) puis capture de la partie visible.
async function pageContext(tab) {
  let snap;
  try { snap = await chrome.tabs.sendMessage(tab.id, { type: "cc:snapshot" }); }
  catch { throw new Error("Recharge la page (⌘R) pour que l'extension puisse la lire."); }
  let image = null;
  try {
    if (tab.active) image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch {}
  chrome.tabs.sendMessage(tab.id, { type: "cc:show" }).catch(() => {});
  return { snapshot: snap?.snapshot || "", title: snap?.title || tab.title, image };
}

// Capture de l'onglet recadrée sur l'élément, avec un contour.
async function captureElement(tab, rect, dpr) {
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const img = await createImageBitmap(await (await fetch(shot)).blob());
  const pad = 40;
  const sx = Math.max(0, (rect.x - pad) * dpr), sy = Math.max(0, (rect.y - pad) * dpr);
  const w = Math.round(Math.min(img.width, (rect.x + rect.width + pad) * dpr) - sx);
  const h = Math.round(Math.min(img.height, (rect.y + rect.height + pad) * dpr) - sy);
  if (w < 4 || h < 4) return null;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  ctx.strokeStyle = "#c96442";
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(rect.x * dpr - sx, rect.y * dpr - sy, rect.width * dpr, rect.height * dpr);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "data:image/png;base64," + btoa(bin);
}
