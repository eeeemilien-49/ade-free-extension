# App de bureau Claude Code Bridge

Projets, preview, tableau de bord. La page du projet s'affiche dans la preview avec le calque
`extension/comment.js` (⌘ + clic) ; « Ouvrir dans Chrome » (⇧⌘O) l'ouvre dans le navigateur, où
l'extension fait la même chose. Même bridge, mêmes commentaires.

```bash
cd app && npm install && npm start            # ou : npm start -- ~/penta-v4
```

- **Projets** (menu sous le nom du projet, ⌘O) : dossier natif, récents. Le serveur de dev est
  réutilisé s'il tourne déjà depuis le projet (« externe », jamais arrêté par l'app) ; sinon
  `<bun|pnpm|yarn|npm> run dev` selon le lockfile (monorepo compris). L'URL est lue dans la sortie
  et chargée dans la preview ; clic sur le serveur : journaux.
- **Preview** : `WebContentsView` ; `src/preload-page.js` exécute `extension/comment.js` tel quel
  dans un monde isolé, avec le shim `chrome.*` (`src/chrome-shim.js`).
- **Panneau de gauche** : `extension/sidepanel.html` tel quel. Un clic sur un commentaire ouvre sa page dans la preview.
- **Service** : `extension/background.js` tourne tel quel dans un contexte `vm` (`src/chrome-host.js`) :
  storage → fichier JSON, onglet unique = la preview, capture via `capturePage`.
- **Bridge** : réutilisé s'il écoute déjà, sinon lancé (Node d'Electron) et arrêté à la fermeture.
- **Extension Chrome** : à chaque démarrage, `src/native-install.js` écrit le lanceur
  `~/.claude-chrome-bridge/native-host` (→ `src/native-host.js`), le manifeste
  `com.claude.code_bridge.json` dans `NativeMessagingHosts/` de chaque navigateur Chromium présent,
  et `app.json` (port, PID, commande pour rouvrir l'app). L'hôte répond `hello` (port, token) et
  `open` (rouvre l'app) ; il laisse `extension.json` pour que l'app sache l'extension connectée.
  Bouton « Installer l'extension Chrome » : ouvrir chrome://extensions, mode développeur, glisser le dossier.
- **Lien `claude-bridge://open?project=…|url=…`** : enregistré seulement par l'app empaquetée.

Variables pour tester sans toucher au réel : `CLAUDE_BRIDGE_PORT`, `CLAUDE_BRIDGE_DIR`, `HOME`
(manifestes natifs), `CLAUDE_BIN` (faux claude), `CLAUDE_APP_DATA` (données de l'app), `CLAUDE_APP_OPEN` (projet à ouvrir).
