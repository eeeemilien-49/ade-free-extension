// Preload du panneau de gauche : extension/sidepanel.html tel quel, avec le shim `chrome`.
// (Page locale de l'app, sans isolation de contexte : sidepanel.js voit window.chrome directement.)
const { createChrome } = require("./chrome-shim");
window.chrome = createChrome();
