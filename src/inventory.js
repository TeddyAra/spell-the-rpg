import { $, show, hide, clamp, element } from "./dom.js";
import { state, saveState, effectiveMaxHealth } from "./state.js";
import { ITEM_TYPES, ELIXIR_TURNS, itemName } from "./items.js";
import { rollDice } from "./dice.js";
import { showInfoResult } from "./results.js";
import { updateCurrentHealth, renderCharacter } from "./character.js";
import { renderSpellSlots } from "./spellSlots.js";

const inventoryOverlay = $("inventoryOverlay");
const inventoryList = $("inventoryList");
const addItemInput = $("addItemInput");
const addItemMessage = $("addItemMessage");
const boggleOilPicker = $("boggleOilPicker");
const endTurnButton = $("endTurnButton");

// Amount typed with "BBO", kept while the player picks which oil it is.
let pendingBoggleOilAmount = 1;

function removeItem(item) {
    state.inventory = state.inventory.filter(entry => entry !== item);
}

/* Items can change the main screen (HP, rings, bracelets, elixirs), so redraw everything. */
function inventoryChanged() {
    renderInventory();
    renderCharacter();
    renderSpellSlots();
    saveState();
}

/*
 * =========================================================
 * ADDING ITEMS
 * =========================================================
 */

function newItemId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* Adds `amount` of an item; returns the message to show. */
function addItem(code, amount, variant) {
    const type = ITEM_TYPES[code];

    if (type.stacks) {
        const existing = state.inventory.find(item => item.code === code);

        if (existing) {
            existing.count += amount;
        } else {
            state.inventory.push({ id: newItemId(), code, count: amount });
        }
    } else if (type.behaviour === "pipette") {
        // For the pipette the number typed is how many uses it has.
        state.inventory.push({ id: newItemId(), code, count: amount });
    } else {
        for (let i = 0; i < amount; i++) {
            const item = { id: newItemId(), code };

            if (variant) {
                item.variant = variant;
            }

            if (type.startingCount) {
                item.count = type.startingCount;
            }

            state.inventory.push(item);
        }
    }

    inventoryChanged();

    const name = variant ? `${type.name} (${variant})` : type.name;

    if (type.behaviour === "pipette") {
        return `Added ${name} with ${amount} ${amount === 1 ? "use" : "uses"}.`;
    }

    return amount > 1 ? `Added ${amount} × ${name}.` : `Added ${name}.`;
}

/* Reads input like "PH" or "PH 3". */
function handleAddInput() {
    const [code = "", amountText] = addItemInput.value.trim().toUpperCase().split(/\s+/);
    const type = ITEM_TYPES[code];

    hide(boggleOilPicker);

    if (!type) {
        addItemMessage.textContent = code
            ? `Unknown item code "${code}".`
            : "Type an item code.";

        return;
    }

    const amount = amountText === undefined
        ? 1
        : clamp(parseInt(amountText, 10) || 1, 1, 99);

    if (type.variants) {
        pendingBoggleOilAmount = amount;
        addItemMessage.textContent = "";

        show(boggleOilPicker);

        return;
    }

    addItemMessage.textContent = addItem(code, amount);
    addItemInput.value = "";
}

$("addItemForm").addEventListener("submit", event => {
    event.preventDefault();
    handleAddInput();
});

for (const button of boggleOilPicker.querySelectorAll("[data-variant]")) {
    button.addEventListener("click", () => {
        hide(boggleOilPicker);

        addItemMessage.textContent = addItem("BBO", pendingBoggleOilAmount, button.dataset.variant);
        addItemInput.value = "";
        addItemInput.focus();
    });
}

/*
 * =========================================================
 * USING ITEMS
 * =========================================================
 */

function useCharge(item) {
    item.count--;

    if (item.count <= 0) {
        removeItem(item);
    }
}

async function useItem(item) {
    const type = ITEM_TYPES[item.code];

    switch (type.behaviour) {
        case "toggle":
            item.active = !item.active;
            break;

        case "discard":
            removeItem(item);
            break;

        case "charges":
            useCharge(item);
            break;

        case "elixir":
            item.active = true;
            item.turns = ELIXIR_TURNS;
            break;

        case "potion": {
            const rolls = await rollDice("1d6");

            if (!rolls) {
                return;
            }

            const healing = rolls[0] + 4;

            updateCurrentHealth(healing);
            useCharge(item);

            showInfoResult(type.name, [
                ["d6 roll", rolls[0]],
                ["Healed (d6 + 4)", healing],
                ["HP", `${state.currentHealth} / ${effectiveMaxHealth()}`]
            ]);
            break;
        }

        case "pipette": {
            const rolls = await rollDice("1d4");

            if (!rolls) {
                return;
            }

            showInfoResult(type.name, [["d4 roll", rolls[0]]]);
            break;
        }
    }

    inventoryChanged();
}

/*
 * =========================================================
 * ELIXIR OF GRANDILOQUENCE: END OF TURN
 * =========================================================
 */

function activeElixirs() {
    return state.inventory.filter(item => item.code === "EG" && item.active);
}

endTurnButton.addEventListener("click", () => {
    for (const elixir of activeElixirs()) {
        elixir.turns--;

        if (elixir.turns <= 0) {
            removeItem(elixir);
        }
    }

    inventoryChanged();
});

/*
 * =========================================================
 * RENDERING
 * =========================================================
 */

function countRow(label, value) {
    const row = element("div", "item-count");

    row.append(element("span", "result-label", label), element("strong", null, value));

    return row;
}

function renderItemCard(item) {
    const type = ITEM_TYPES[item.code];
    const drunkElixir = type.behaviour === "elixir" && Boolean(item.active);

    const card = element("div", "item-card");

    card.classList.toggle("active", type.behaviour === "toggle" && Boolean(item.active));
    card.classList.toggle("spent", drunkElixir);

    const discard = element("button", "item-discard", "×");

    discard.title = `Throw away ${itemName(item)}`;
    discard.setAttribute("aria-label", discard.title);
    discard.addEventListener("click", () => {
        removeItem(item);
        inventoryChanged();
    });

    card.append(element("div", "item-name", itemName(item)));

    if (drunkElixir) {
        card.append(countRow("Turns left", item.turns));
    } else if (type.behaviour === "pipette") {
        const row = element("label", "item-count");
        const input = element("input", "modal-input");

        input.type = "number";
        input.min = 0;
        input.step = 1;
        input.value = item.count;

        input.addEventListener("change", () => {
            item.count = Math.max(0, parseInt(input.value, 10) || 0);
            input.value = item.count;

            saveState();
        });

        row.append(element("span", "result-label", "Uses left"), input);
        card.append(row);
    } else if (item.count !== undefined) {
        card.append(countRow(type.stacks ? "Amount" : "Uses left", item.count));
    }

    if (!drunkElixir) {
        const label = type.behaviour === "toggle"
            ? (item.active ? "Deactivate" : "Activate")
            : type.action;

        const action = element("button", item.active ? null : "primary", label);

        action.addEventListener("click", () => useItem(item));

        card.append(action);
    }

    card.append(discard);

    return card;
}

export function renderInventory() {
    inventoryList.replaceChildren(...state.inventory.map(renderItemCard));

    $("inventoryEmpty").classList.toggle("hidden", state.inventory.length > 0);

    const elixirs = activeElixirs();

    endTurnButton.classList.toggle("hidden", elixirs.length === 0);

    if (elixirs.length) {
        $("endTurnCount").textContent = Math.min(...elixirs.map(elixir => elixir.turns));
    }
}

/*
 * =========================================================
 * INVENTORY OVERLAY
 * =========================================================
 */

$("inventoryButton").addEventListener("click", () => {
    renderInventory();

    addItemInput.value = "";
    addItemMessage.textContent = "";
    hide(boggleOilPicker);

    show(inventoryOverlay);
    addItemInput.focus();
});

$("closeInventory").addEventListener("click", () => hide(inventoryOverlay));
