# App de bureau Claude Code Bridge

```bash
cd app && npm install && npm start            # ou : npm start -- ~/penta-v4
```

- **Projets** (menu sous le nom du projet, ⌘O) : dossier natif, récents. Le serveur de dev est
  réutilisé s'il tourne déjà depuis le projet (« externe », jamais arrêté par l'app) ; sinon
  `<bun|pnpm|yarn|npm> run dev` selon le lockfile, à la racine ou dans chaque workspace qui a un
  script `dev` (monorepo). L'URL est lue dans la sortie ; arrêt du serveur lancé à la fermeture.
- **Page** : `WebContentsView` ; `extension/comment.js` y est exécuté tel quel dans le monde isolé
  du preload (`src/preload-page.js`), comme un content script.
- **Panneau de gauche** : `extension/sidepanel.html` tel quel.
- **Service** : `extension/background.js` tourne tel quel dans un contexte `vm` du processus
  principal (`src/chrome-host.js`), avec un shim `chrome.*` (storage → fichier JSON, onglet
  unique = la page, messages par IPC, capture par `webContents.capturePage`). Aucune logique
  dupliquée, extension et app restent synchronisées.
- **Bridge** : réutilisé s'il écoute sur 127.0.0.1:7823, sinon `bridge/server.mjs` est lancé
  (Node d'Electron) et arrêté à la fermeture. Token lu dans `~/.claude-chrome-bridge/token`.

Variables utiles pour tester sans toucher au bridge réel : `CLAUDE_BRIDGE_PORT`, `CLAUDE_BRIDGE_DIR`,
`CLAUDE_BIN` (faux claude), `CLAUDE_APP_DATA` (données de l'app), `CLAUDE_APP_OPEN` (projet à ouvrir).
Outils de dev : ⌥⌘I (page), ⌥⌘J (panneau).
