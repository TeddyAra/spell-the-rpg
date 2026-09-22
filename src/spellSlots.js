import { $, show, hide, clamp, renderDice } from "./dom.js";
import {
    state,
    saveState,
    defaultSpellSlotName,
    effectiveSlotLevel,
    SPELL_SLOT_COUNT,
    MAX_SPELL_SLOT_LEVEL
} from "./state.js";
import { rollDice } from "./dice.js";

const spellSlotResultOverlay = $("spellSlotResultOverlay");
const spellSlotSuccessResultOverlay = $("spellSlotSuccessResultOverlay");

let activeSpellSlotIndex = null;

const slotButton = index => $(`spellSlot${index + 1}`);
const slotNameInput = index => $(`spellSlot${index + 1}NameInput`);
const slotLevelInput = index => $(`spellSlot${index + 1}LevelInput`);

/*
 * =========================================================
 * DISPLAY
 * =========================================================
 */

/* Updates the spell slot buttons on the main screen. Level 0 slots are disabled. */
function updateSpellSlotDisplay() {
    state.spellSlots.forEach((slot, index) => {
        const disabled = slot.level === 0;
        const button = slotButton(index);

        button.disabled = disabled;
        button.classList.toggle("roll-disabled", disabled);

        const name = disabled
            ? defaultSpellSlotName(index)
            : slot.name.trim() || defaultSpellSlotName(index);

        $(`spellSlot${index + 1}Name`).textContent = name;
        button.title = name; // long names are cut off on the button

        $(`spellSlot${index + 1}Display`).textContent = disabled ? "" : effectiveSlotLevel(slot);
    });
}

/* Copies the spell slots into the character settings inputs. */
function syncSpellSlotInputs() {
    state.spellSlots.forEach((slot, index) => {
        slotNameInput(index).value = slot.name;
        slotLevelInput(index).value = slot.level;
    });
}

export function renderSpellSlots() {
    syncSpellSlotInputs();
    updateSpellSlotDisplay();
}

/*
 * =========================================================
 * SETTINGS INPUTS
 * =========================================================
 */

function saveSpellSlotInput(index) {
    const levelInput = slotLevelInput(index);

    const level = clamp(parseInt(levelInput.value, 10) || 0, 0, MAX_SPELL_SLOT_LEVEL);

    state.spellSlots[index] = {
        name: slotNameInput(index).value.trim() || defaultSpellSlotName(index),
        level
    };

    levelInput.value = level;

    updateSpellSlotDisplay();
    saveState();
}

/*
 * =========================================================
 * ROLLING
 * =========================================================
 */

async function rollSpellSlot(index) {
    const slot = state.spellSlots[index];

    if (slot.level === 0) {
        return;
    }

    activeSpellSlotIndex = index;

    const rolls = await rollDice(`${effectiveSlotLevel(slot)}d6`);

    if (!rolls) {
        return;
    }

    $("spellSlotHighestRoll").textContent = Math.max(...rolls);
    $("spellSlotTotalSum").textContent = rolls.reduce((sum, value) => sum + value, 0);

    renderDice($("spellSlotIndividualRolls"), rolls);

    show(spellSlotResultOverlay);
}

function showLevelUpResult(roll, status) {
    $("spellSlotLevelUpRoll").textContent = roll;
    $("spellSlotLevelStatus").textContent = status;

    show(spellSlotSuccessResultOverlay);
}

/*
 * After a successful cast, roll 1d6: rolling at least the slot's level raises it by one.
 * With the Red Gem Ring on, the roll has to beat the raised level (so a level 6 slot can't go higher).
 */
async function rollSpellSlotLevelUpDie() {
    const spellSlot = state.spellSlots[activeSpellSlotIndex];

    if (!spellSlot) {
        return;
    }

    hide(spellSlotResultOverlay);

    if (spellSlot.level >= MAX_SPELL_SLOT_LEVEL) {
        showLevelUpResult("—", "Already at maximum level.");

        return;
    }

    const rolls = await rollDice("1d6");

    if (!rolls) {
        return;
    }

    const roll = rolls[0];
    const oldLevel = effectiveSlotLevel(spellSlot);

    if (roll >= oldLevel) {
        spellSlot.level++;

        saveState();
        renderSpellSlots();

        showLevelUpResult(roll, `${oldLevel} ➝ ${effectiveSlotLevel(spellSlot)}`);
    } else {
        showLevelUpResult(roll, oldLevel);
    }
}

/*
 * =========================================================
 * EVENT LISTENERS
 * =========================================================
 */

for (let i = 0; i < SPELL_SLOT_COUNT; i++) {
    slotButton(i).addEventListener("click", () => rollSpellSlot(i));

    slotNameInput(i).addEventListener("change", () => saveSpellSlotInput(i));
    slotLevelInput(i).addEventListener("change", () => saveSpellSlotInput(i));
}

$("successButton").addEventListener("click", rollSpellSlotLevelUpDie);
$("failButton").addEventListener("click", () => hide(spellSlotResultOverlay));
$("closeSpellSlotResult").addEventListener("click", () => hide(spellSlotSuccessResultOverlay));
