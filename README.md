# Claude Code Bridge

⌘+clic sur un élément d'une page → une session Claude Code locale modifie le code.
Deux pièces : l'**app de bureau** (`app/`) et l'**extension Chrome** (`extension/`). Zéro configuration.

```bash
cd app && npm install && npm start            # ou : npm start -- ~/mon-projet
```

- L'app lance le bridge (`bridge/server.mjs`), le serveur de dev du projet, et affiche la page dans
  sa **preview** : ⌘+clic, bulles, fils, diffs y marchent comme dans Chrome. « Ouvrir dans Chrome »
  bascule sur le vrai navigateur ; les deux voient les mêmes commentaires.
- **Extension** : bouton « Installer l'extension Chrome » de l'app (3 étapes, en attendant le
  Chrome Web Store). Elle s'appaire seule via Native Messaging : l'app installe l'hôte
  `com.claude.code_bridge` (Chrome, Arc, Brave, Edge… présents) et l'extension, d'ID fixe
  `ihbpnieleoceojjdkdbcndheonfmljme` (clé `key` du manifeste), y récupère port et token.
  App fermée : l'extension le dit et propose « Ouvrir l'app ».

Les commentaires et les sessions vivent dans le bridge (`~/.claude-chrome-bridge/comments.json`) :
fermer l'onglet n'interrompt rien. Le bridge n'écoute que sur 127.0.0.1 et exige le token.

## Conversations
Dans le panneau, écris une demande large pour la page affichée (« passe en revue les espacements »).
Une session en lecture seule reçoit l'URL, une capture et un instantané du DOM, répond, puis propose des
commentaires ancrés sur des éléments (pastilles en pointillé). Lance-les (tous ou un par un) : chacun devient
une session qui modifie le code. La conversation continue (« ajoute aussi… », « annule le 3 »).
