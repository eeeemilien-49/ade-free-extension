# Claude Code Bridge

⌘+clic sur un élément d'une page → une session Claude Code locale modifie le code.

## Installation (sans app)

Prérequis : [Node](https://nodejs.org) et [Claude Code](https://docs.claude.com/claude-code) (commande `claude`), sur macOS ou Linux.

```bash
git clone https://github.com/eeeemilien-49/ade-free-extension
cd ade-free-extension
node install.mjs
```

Puis dans Chrome (ou Arc, Brave, Edge…) : `chrome://extensions` → **Mode développeur** →
**Charger l'extension non empaquetée** → dossier `extension/`.

C'est tout : au premier ⌘+clic, l'extension démarre elle-même le bridge local en arrière-plan
(rien à laisser ouvert). Ne déplace pas le dossier cloné ensuite, ou relance `node install.mjs`.
Désinstaller : `node install.mjs --uninstall`.

## Comment ça marche

- `install.mjs` déclare au navigateur un **hôte natif** (`com.claude.code_bridge`, Native Messaging),
  autorisé pour l'ID fixe de l'extension (`ihbpnieleoceojjdkdbcndheonfmljme`, clé `key` du manifeste).
- Quand l'extension a besoin du bridge, le navigateur lance l'hôte (`bridge/native-host.mjs`) : il démarre
  `bridge/server.mjs` s'il ne tourne pas, puis rend le port et le token.
- Le bridge n'écoute que sur 127.0.0.1 et exige le token. Commentaires et sessions vivent dans
  `~/.claude-chrome-bridge/` (journal : `bridge.log`) : fermer l'onglet n'interrompt rien.

## Conversations
Dans le panneau, écris une demande large pour la page affichée (« passe en revue les espacements »).
Une session en lecture seule reçoit l'URL, une capture et un instantané du DOM, répond, puis propose des
commentaires ancrés sur des éléments (pastilles en pointillé). Lance-les (tous ou un par un) : chacun devient
une session qui modifie le code. La conversation continue (« ajoute aussi… », « annule le 3 »).

## App de bureau (optionnelle)

`app/` (Electron) ajoute une preview intégrée et la gestion du serveur de dev :
`cd app && npm install && npm start`. Elle réinstalle son propre hôte natif à chaque lancement ;
relance `node install.mjs` pour revenir au mode sans app.
