# Claude Code Bridge pour Chrome

⌘+clic sur un élément d'une page → une session Claude Code locale modifie le code.

1. Lancer le bridge : `node bridge/server.mjs` (affiche le token, stocké dans `~/.claude-chrome-bridge/token`).
2. Charger `extension/` dans chrome://extensions (mode développeur → « Charger l'extension non empaquetée »).
3. Icône de l'extension : token, mode, dossier du projet pour le site (aussi demandé au premier commentaire).

Les commentaires et les sessions vivent dans le bridge (`~/.claude-chrome-bridge/comments.json`) :
fermer l'onglet n'interrompt rien. Le bridge n'écoute que sur 127.0.0.1 et exige le token.

## Conversations
Dans le side panel, écris une demande large pour la page de l'onglet actif (« passe en revue les espacements »).
Une session en lecture seule reçoit l'URL, une capture et un instantané du DOM, répond, puis propose des
commentaires ancrés sur des éléments (pastilles en pointillé). Lance-les (tous ou un par un) : chacun devient
une session qui modifie le code. La conversation continue (« ajoute aussi… », « annule le 3 »).

## Sans extension (prototype, macOS)
`node injector/inject.mjs` glisse le calque dans l'onglet actif de Chrome, Arc, Brave, Edge ou Safari via AppleScript,
sur n'importe quel site. Il faut cocher une fois, dans le navigateur, « Autoriser JavaScript dans les événements AppleScript »
(Chrome : Affichage › Développeur). Projet local : les commentaires modifient le code. Autre site : lecture seule,
l'élément sert de contexte à Claude. Le token reste dans l'injecteur ; la page ne peut agir que sur ses propres commentaires.
