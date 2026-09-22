import { $, show, hide, renderDice } from "./dom.js";
import { state, MAGIC_SCHOOLS, isItemActive, effectiveSchoolLevel } from "./state.js";
import { rollDice, rollPercentiles } from "./dice.js";
import { spawnScrabbleLetters, selectTilesWithBox, letterScore } from "./tiles.js";
import { showInfoResult } from "./results.js";

const schoolResultOverlay = $("schoolResultOverlay");
const spellLevelResult = $("spellLevelResult");
const resultActions = $("resultActions");
const resultBackButton = $("resultBackButton");
const doubleDamageResult = $("doubleDamageResult");

const spellControl = $("spellControl");
const spellLevelDisplay = $("spellLevelDisplay");

const braceletOverlay = $("braceletOverlay");

/*
 * What the dice in the school result window were rolled for:
 *   "school"   a magic school button: Cast gives letter tiles
 *   "bracelet" a school picked after a Green Gem Bracelet cast: Cast rolls the effect straight away
 *   "d6"       the generic D6 button: Cast gives letter tiles
 *   "effect"   the spell effect: no Cast, just the numbers
 */
let rollMode = "school";

let lastSpellLevel = 1;

const isHighRoll = value => value === 5 || value === 6;

const sum = values => values.reduce((total, value) => total + value, 0);

/* Every 5 or 6 adds a spell level (minimum 1). */
function calculateSpellResults(rolls) {
    return {
        highest: Math.max(...rolls),
        spellLevel: Math.max(1, rolls.filter(isHighRoll).length),
        total: sum(rolls)
    };
}

/* Blue Gem Necklace: spell effect and generic d6 windows also show double damage. */
function showsDoubleDamage(mode) {
    return (mode === "effect" || mode === "d6") && isItemActive("BGN");
}

function showSchoolResults(rolls) {
    const results = calculateSpellResults(rolls);

    $("highestRoll").textContent = results.highest;
    $("spellLevel").textContent = results.spellLevel;
    $("totalSum").textContent = results.total;
    $("doubleDamage").textContent = results.total * 2;

    lastSpellLevel = results.spellLevel;

    renderDice($("individualRolls"), rolls, isHighRoll);

    show(schoolResultOverlay);
}

async function rollSpellDice(count, mode) {
    const rolls = await rollDice(`${count}d6`);

    if (!rolls) {
        return;
    }

    rollMode = mode;

    const castable = mode !== "effect";

    spellLevelResult.classList.toggle("hidden", !castable);
    resultActions.classList.toggle("hidden", !castable);
    resultBackButton.classList.toggle("hidden", castable);
    doubleDamageResult.classList.toggle("hidden", !showsDoubleDamage(mode));

    showSchoolResults(rolls);
}

/*
 * =========================================================
 * MAIN SCREEN BUTTONS
 * =========================================================
 */

/* Updates the school buttons (Red Gem Ring) and swaps them out for the Green Gem Bracelet. */
export function renderSpellMenu() {
    for (const school of MAGIC_SCHOOLS) {
        const level = effectiveSchoolLevel(school);
        const button = $(`${school}Button`);

        $(`${school}Display`).textContent = level;

        button.disabled = level === 0;
        button.classList.toggle("roll-disabled", level === 0);
    }

    for (const button of braceletOverlay.querySelectorAll("[data-school]")) {
        const level = effectiveSchoolLevel(button.dataset.school);

        button.querySelector("[data-level]").textContent = level;

        button.disabled = level === 0;
        button.classList.toggle("roll-disabled", level === 0);
    }

    const braceletActive = isItemActive("GGB");

    $("spellButtons").classList.toggle("hidden", braceletActive);
    $("castSpellButton").classList.toggle("hidden", !braceletActive);
}

for (const school of MAGIC_SCHOOLS) {
    $(`${school}Button`).addEventListener("click", () => {
        rollSpellDice(effectiveSchoolLevel(school), "school");
    });
}

/*
 * =========================================================
 * SCHOOL RESULT OVERLAY
 * =========================================================
 */

$("castSchoolResult").addEventListener("click", () => {
    hide(schoolResultOverlay);

    if (rollMode === "bracelet") {
        rollSpellDice(lastSpellLevel, "effect");

        return;
    }

    spawnScrabbleLetters(Number($("totalSum").textContent) || 0);

    spellLevelDisplay.textContent = lastSpellLevel;
    show(spellControl);
});

$("closeSchoolResult").addEventListener("click", () => hide(schoolResultOverlay));
$("closeResults").addEventListener("click", () => hide(schoolResultOverlay));

/*
 * =========================================================
 * SPELL EFFECT
 * =========================================================
 */

/* Elixir of Grandiloquence: the effect is the score of the tiles used in the spell. */
async function scoreSelectedTiles() {
    const letters = await selectTilesWithBox();

    if (!letters) {
        show(spellControl);

        return;
    }

    const total = sum(letters.map(letterScore));
    const rows = [["Tiles used", letters.length], ["Total score", total]];

    if (isItemActive("BGN")) {
        rows.push(["Damage ×2 (Blue Gem Necklace)", total * 2]);
    }

    showInfoResult("Spell Effect", rows, { title: "Letters", values: letters });
}

$("spellEffectButton").addEventListener("click", () => {
    hide(spellControl);

    if (isItemActive("EG")) {
        scoreSelectedTiles();
    } else {
        rollSpellDice(lastSpellLevel, "effect");
    }
});

/*
 * =========================================================
 * GREEN GEM BRACELET
 * =========================================================
 */

$("castSpellButton").addEventListener("click", async () => {
    const values = await rollPercentiles(3);

    if (!values) {
        return;
    }

    const rows = $("braceletRolls");

    rows.innerHTML = "";

    values.forEach((value, index) => {
        const row = document.createElement("div");

        row.className = "result-row";
        row.innerHTML = `<span class="result-label">Roll ${index + 1}</span><strong>${value}</strong>`;

        rows.appendChild(row);
    });

    show(braceletOverlay);
});

for (const button of braceletOverlay.querySelectorAll("[data-school]")) {
    button.addEventListener("click", () => {
        hide(braceletOverlay);
        rollSpellDice(effectiveSchoolLevel(button.dataset.school), "bracelet");
    });
}

$("closeBracelet").addEventListener("click", () => hide(braceletOverlay));

/*
 * =========================================================
 * GENERIC D6
 * =========================================================
 */

/* The generic d6 roll (see dicePanel.js) uses the spell result window, so it can be cast. */
export function rollGenericD6(count) {
    rollSpellDice(count, "d6");
}
