import { loadState } from "./state.js";
import { renderCharacter } from "./character.js";
import { renderSpellSlots } from "./spellSlots.js";
import { renderInventory } from "./inventory.js";
import "./spellcasting.js";
import "./dicePanel.js";
import "./tiles.js";
import "./overlays.js";

loadState();

renderCharacter();
renderSpellSlots();
renderInventory();
