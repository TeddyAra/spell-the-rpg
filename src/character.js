import { $, show, hide, clamp, formatModifier, onNumberInput } from "./dom.js";
import { state, saveState, MAGIC_SCHOOLS, effectiveMaxHealth } from "./state.js";
import { rollDice } from "./dice.js";
import { renderSpellSlots } from "./spellSlots.js";
import { renderSpellMenu } from "./spellcasting.js";

const initiativeModifier = dexterity => Math.floor((dexterity - 10) / 2);

/*
 * =========================================================
 * HIT POINTS
 * =========================================================
 */

const hpManagerOverlay = $("hpManagerOverlay");
const healthAmountInput = $("healthAmountInput");
const tempHPInput = $("tempHPInput");
const maxHPInput = $("maxHPInput");

function clampHealth() {
    state.maxHealth = Math.max(1, Number(state.maxHealth) || 1);
    state.currentHealth = clamp(Number(state.currentHealth) || 0, 0, effectiveMaxHealth());
    state.temporaryHealth = Math.max(0, Number(state.temporaryHealth) || 0);
}

function updateHPDisplay() {
    clampHealth();

    $("hpCurrentDisplay").textContent = state.currentHealth;
    $("hpMaxDisplay").textContent = effectiveMaxHealth();
    $("tempHPDisplay").textContent = state.temporaryHealth > 0 ? `+${state.temporaryHealth}` : "";

    $("hpModalCurrent").textContent = state.currentHealth;
    $("hpModalMax").textContent = effectiveMaxHealth();

    tempHPInput.value = state.temporaryHealth;
}

/* Negative amounts are damage, which is taken from temporary HP first. */
export function updateCurrentHealth(amount) {
    if (amount < 0) {
        let damage = -amount;

        const tempDamage = Math.min(state.temporaryHealth, damage);

        state.temporaryHealth -= tempDamage;
        damage -= tempDamage;

        state.currentHealth = clamp(state.currentHealth - damage, 0, effectiveMaxHealth());
    } else {
        state.currentHealth = clamp(state.currentHealth + amount, 0, effectiveMaxHealth());
    }

    updateHPDisplay();
    saveState();
}

function healthAmount() {
    return parseInt(healthAmountInput.value, 10);
}

$("hpManagerButton").addEventListener("click", () => {
    healthAmountInput.value = 1;
    updateHPDisplay();

    show(hpManagerOverlay);
});

$("closeHPManager").addEventListener("click", () => hide(hpManagerOverlay));

$("damageHPButton").addEventListener("click", () => {
    const amount = healthAmount();

    if (!Number.isNaN(amount)) {
        updateCurrentHealth(-amount);
    }
});

$("healHPButton").addEventListener("click", () => {
    const amount = healthAmount();

    if (!Number.isNaN(amount)) {
        updateCurrentHealth(amount);
    }
});

onNumberInput(tempHPInput, 0, value => {
    state.temporaryHealth = value;

    updateHPDisplay();
    saveState();
});

onNumberInput(maxHPInput, 1, value => {
    // A character at full health stays at full health when max HP changes.
    const wasAtFullHealth = state.currentHealth === effectiveMaxHealth();

    state.maxHealth = value;
    state.currentHealth = wasAtFullHealth
        ? effectiveMaxHealth()
        : Math.min(state.currentHealth, effectiveMaxHealth());

    updateHPDisplay();
    saveState();
});

/*
 * =========================================================
 * CHARACTER STATS
 * =========================================================
 */

const acInput = $("acInput");
const dexInput = $("dexInput");

function renderStats() {
    $("acDisplay").textContent = state.ac;
    acInput.value = state.ac;

    dexInput.value = state.dexterity;
    $("initiativeDisplay").value = formatModifier(state.initiative);
    $("initiativeButtonDisplay").textContent = formatModifier(state.initiative);

    maxHPInput.value = state.maxHealth;

    for (const school of MAGIC_SCHOOLS) {
        $(`${school}Input`).value = state.schools[school];
    }

    renderSpellMenu();
}

onNumberInput(acInput, 1, value => {
    state.ac = value;

    renderStats();
    saveState();
});

onNumberInput(dexInput, 1, value => {
    state.dexterity = value;
    state.initiative = initiativeModifier(value);

    renderStats();
    saveState();
});

for (const school of MAGIC_SCHOOLS) {
    onNumberInput($(`${school}Input`), 1, value => {
        state.schools[school] = value;

        renderStats();
        saveState();
    });
}

export function renderCharacter() {
    updateHPDisplay();
    renderStats();
}

/*
 * =========================================================
 * CHARACTER SETTINGS OVERLAY
 * =========================================================
 */

const characterOverlay = $("characterOverlay");

$("characterButton").addEventListener("click", () => {
    renderCharacter();
    renderSpellSlots();

    show(characterOverlay);
});

$("closeCharacter").addEventListener("click", () => hide(characterOverlay));

/*
 * =========================================================
 * DEXTERITY (INITIATIVE) ROLL
 * =========================================================
 */

$("dexButton").addEventListener("click", async () => {
    const rolls = await rollDice("1d20");

    if (!rolls) {
        return;
    }

    const rawRoll = rolls[0];

    $("rawRollDisplay").textContent = rawRoll;
    $("modifierDisplay").textContent = formatModifier(state.initiative);
    $("dexResultDisplay").textContent = rawRoll + state.initiative;

    show($("dexResultOverlay"));
});

$("closeDexResult").addEventListener("click", () => hide($("dexResultOverlay")));
