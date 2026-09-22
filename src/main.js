import { loadState } from "./state.js";
import { renderCharacter } from "./character.js";
import { renderSpellSlots } from "./spellSlots.js";
import { renderInventory } from "./inventory.js";
import "./spellcasting.js";
import "./dicePanel.js";
import "./tiles.js";
import "./overlays.js";

// The map opens in its own tab (reused if it's already open), e.g. for a second screen
document.getElementById("mapButton").addEventListener("click", () => {
    window.open("./map.html", "spell-the-rpg-map");
});

loadState();

renderCharacter();
renderSpellSlots();
renderInventory();
