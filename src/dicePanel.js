import { $, show, hide } from "./dom.js";
import { rollDice, rollPercentiles } from "./dice.js";
import { showInfoResult } from "./results.js";
import { rollGenericD6 } from "./spellcasting.js";

const rollDiceOverlay = $("rollDiceOverlay");
const rollDiceInput = $("rollDiceInput");

// The die whose "how many?" dialog is open
let dialogSides = 6;

/*
 * d6 rolls use the spell result window (spell level, Cast). Other dice just
 * show their numbers.
 */
async function rollGenericDice(sides, count) {
    if (sides === 6) {
        rollGenericD6(count);

        return;
    }

    const rolls = await rollDice(`${count}d${sides}`);

    if (!rolls) {
        return;
    }

    showInfoResult(`${rolls.length}d${sides}`, [
        ["Highest roll", Math.max(...rolls)],
        ["Total sum", rolls.reduce((sum, value) => sum + value, 0)]
    ], { title: "Individual rolls", values: rolls });
}

for (const cell of document.querySelectorAll(".dice-cell[data-sides]")) {
    const sides = Number(cell.dataset.sides);

    cell.querySelector(".dice-button").addEventListener("click", () => {
        dialogSides = sides;

        $("rollDiceTitle").textContent = `Roll d${sides}`;
        rollDiceInput.value = 1;

        show(rollDiceOverlay);
    });

    for (const button of cell.querySelectorAll(".quick-roll [data-count]")) {
        button.addEventListener("click", () => {
            button.blur();
            rollGenericDice(sides, Number(button.dataset.count));
        });
    }
}

$("cancelRollDice").addEventListener("click", () => hide(rollDiceOverlay));

$("confirmRollDice").addEventListener("click", () => {
    hide(rollDiceOverlay);
    rollGenericDice(dialogSides, rollDiceInput.value);
});

/* The d100 is always a single roll. */
$("rollD100Button").addEventListener("click", async () => {
    const values = await rollPercentiles(1);

    if (values) {
        showInfoResult("d100", [["Result", values[0]]]);
    }
});
