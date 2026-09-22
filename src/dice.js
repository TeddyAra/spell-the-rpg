import DiceBox from "@3d-dice/dice-box-threejs";
import { $, show, hide } from "./dom.js";

const DICE_COLORS = [
    "#00ffcb",
    "#ff6600",
    "#1d66af",
    "#7028ed",
    "#c4c427",
    "#d81128"
];

const animationOverlay = $("animationOverlay");

function diceColorset(background) {
    return {
        background,
        foreground: "#ffffff",
        texture: "none",
        material: "metal"
    };
}

function randomDiceColor() {
    return DICE_COLORS[Math.floor(Math.random() * DICE_COLORS.length)];
}

const diceBox = new DiceBox("#diceBox", {
    theme_customColorset: diceColorset(DICE_COLORS[0]),

    gravity_multiplier: 350,
    strength: 0.5,

    light_intensity: 1,
    baseScale: 100
});

let diceBoxReady = false;

diceBox.initialize().then(() => {
    diceBoxReady = true;

    console.log("3D DiceBox initialized.");

    requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
    });
}).catch(error => {
    console.error("Failed to initialize DiceBox:", error);
});

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

/* Returns the rolled values per dice set, e.g. "3d100+3d10" gives [[..3..], [..3..]]. */
function extractDiceResults(results) {
    if (!results || !Array.isArray(results.sets)) {
        console.error("Unexpected DiceBox result:", results);

        return [];
    }

    return results.sets.map(set => {
        const rolls = [];

        const dice = Array.isArray(set.rolls)
            ? set.rolls
            : Array.isArray(set.dice)
                ? set.dice
                : [];

        for (const die of dice) {
            if (typeof die === "number") {
                rolls.push(die);
            } else if (typeof die?.value === "number") {
                rolls.push(die.value);
            }
        }

        return rolls;
    });
}

/*
 * Plays the full-screen 3D dice animation for `notation` (e.g. "3d6") and
 * resolves with the rolled values, or null if the roll couldn't happen.
 */
export async function rollDice(notation) {
    const sets = await rollDiceSets(notation);

    return sets ? sets.flat() : null;
}

/* Combines a tens die (10–100, where "00" is 100) and a d10 (1–10) into 1–100. */
function percentile(tens, units) {
    return (tens % 100) + (units % 10) || 100;
}

/* Rolls `count` percentile dice (a d100 + d10 pair each). Resolves with values 1–100, or null. */
export async function rollPercentiles(count) {
    const sets = await rollDiceSets(`${count}d100+${count}d10`);

    if (!sets) {
        return null;
    }

    const [tens, units] = sets;

    return tens.map((value, index) => percentile(value, units[index]));
}

/* Like rollDice, but keeps the values of each dice set (e.g. "2d100+2d10") separate. */
export async function rollDiceSets(notation) {
    if (!diceBoxReady) {
        console.warn("DiceBox is not ready yet.");

        return null;
    }

    // Remove the previous roll's dice first, or they flash up when the overlay appears.
    diceBox.clearDice();

    show(animationOverlay);

    await diceBox.updateConfig({
        theme_customColorset: diceColorset(randomDiceColor())
    });

    // The dice box only knows its real size once it's visible. DiceBox handles
    // "resize" one frame later, and a roll is simulated first and then replayed on
    // screen, so the size must be settled before rolling or the dice that land
    // won't match the results.
    await nextFrame();
    window.dispatchEvent(new Event("resize"));
    await nextFrame();

    try {
        const sets = extractDiceResults(await diceBox.roll(notation));

        if (!sets.flat().length) {
            throw new Error("No dice results were returned.");
        }

        return sets;
    } catch (error) {
        console.error(`Dice roll (${notation}) failed:`, error);

        return null;
    } finally {
        hide(animationOverlay);
    }
}
