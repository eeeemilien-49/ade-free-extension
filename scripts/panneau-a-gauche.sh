#!/bin/zsh
# Met le side panel de Chrome à gauche (ou à droite : ./panneau-a-gauche.sh droite).
# Chrome n'expose ce réglage à aucune extension : on écrit la préférence
# side_panel.is_right_aligned dans le profil, Chrome fermé (sinon il l'écrase).
set -e
SIDE=${1:-gauche}
RIGHT=$([[ $SIDE == droite ]] && echo true || echo false)
DIR="$HOME/Library/Application Support/Google/Chrome"

was_running=false
if pgrep -x "Google Chrome" >/dev/null; then
  was_running=true
  echo "Fermeture de Chrome (les onglets seront restaurés)…"
  osascript -e 'tell application "Google Chrome" to quit'
  for i in {1..40}; do pgrep -x "Google Chrome" >/dev/null || break; sleep 0.25; done
  pgrep -x "Google Chrome" >/dev/null && { echo "Chrome ne s'est pas fermé, abandon."; exit 1; }
fi

for prefs in "$DIR"/*/Preferences(N); do
  python3 - "$prefs" "$RIGHT" <<'EOF'
import json, sys
path, right = sys.argv[1], sys.argv[2] == "true"
with open(path) as f: d = json.load(f)
d.setdefault("side_panel", {})["is_right_aligned"] = right
with open(path, "w") as f: json.dump(d, f, separators=(",", ":"))
print("ok :", path.split("/")[-2])
EOF
done

if $was_running; then open -a "Google Chrome" --args --restore-last-session; fi
echo "Panneau latéral : $SIDE."
