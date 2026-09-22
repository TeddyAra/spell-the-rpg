import { $, hide } from "./dom.js";

/* Overlays that close when clicking the backdrop or pressing Escape. */
const closableOverlays = [
    "characterOverlay",
    "hpManagerOverlay",
    "schoolResultOverlay",
    "tileCountOverlay",
    "dexResultOverlay",
    "inventoryOverlay",
    "infoResultOverlay",
    "braceletOverlay"
].map($);

for (const overlay of closableOverlays) {
    overlay.addEventListener("click", event => {
        if (event.target === overlay) {
            hide(overlay);
        }
    });
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closableOverlays.forEach(hide);
    }
});
