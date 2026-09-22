/*
 * Every item, keyed by the code you type to add it. What items do is never
 * shown to the player; they find out by using them.
 *
 * behaviour:
 *   toggle     Activate / Deactivate. The effect is applied wherever it matters (see isItemActive):
 *                BGN  Blue Gem Necklace: spell effect and d6 results also show the damage ×2,
 *                     and max HP is halved (rounded up)
 *                GGB  Green Gem Bracelet: schools and spell slots are replaced by a d100 spell cast
 *                RGR  Red Gem Ring: spell slots +1 level (up to 7), magic schools −2 (minimum 0)
 *   discard    The action removes the item.
 *   charges    The action lowers the count; the item is removed at 0.
 *   potion     Like charges, but heals 1d6 + 4.
 *   pipette    Rolls a d4. The player edits the uses left themselves; it is never removed at 0.
 *   elixir     Drinking it starts a countdown that goes down with the End of turn button. While it
 *              runs, a spell's effect is the score of the letter tiles used.
 *
 * stacks:          adding one you already have increases its count instead of adding a new entry
 * startingCount:   count of a newly added item (otherwise the amount typed after the code)
 * variants:        the item comes in several kinds; you pick one when adding it
 */
export const ITEM_TYPES = {
    BGN: {
        name: "Blue Gem Necklace",
        behaviour: "toggle"
    },
    BBO: {
        name: "Bottle of Boggle Oil",
        behaviour: "discard",
        action: "Use",
        variants: ["Hardened", "Slippery", "Sticky"]
    },
    EG: {
        name: "Elixir of Grandiloquence",
        behaviour: "elixir",
        action: "Drink"
    },
    EB: {
        name: "Etched Brick",
        behaviour: "discard",
        action: "Remove"
    },
    GR: {
        name: "Gate Ruby",
        behaviour: "discard",
        action: "Remove"
    },
    GGB: {
        name: "Green Gem Bracelet",
        behaviour: "toggle"
    },
    LG: {
        name: "Large Goodberry",
        behaviour: "charges",
        action: "Eat",
        stacks: true
    },
    PLB: {
        name: "Pipette of Liquid Bane",
        behaviour: "pipette",
        action: "Use"
    },
    PH: {
        name: "Potion of Healing",
        behaviour: "potion",
        action: "Use",
        stacks: true
    },
    RGR: {
        name: "Red Gem Ring",
        behaviour: "toggle"
    },
    RHM: {
        name: "Reversing Hand Mirror",
        behaviour: "charges",
        action: "Use",
        startingCount: 3
    },
    RK: {
        name: "Rusted Key",
        behaviour: "discard",
        action: "Remove"
    },
    SK: {
        name: "Silver Key",
        behaviour: "discard",
        action: "Remove"
    }
};

export const ELIXIR_TURNS = 4;

/* "Bottle of Boggle Oil (Sticky)" for items with a variant, otherwise just the name. */
export function itemName(item) {
    const name = ITEM_TYPES[item.code].name;

    return item.variant ? `${name} (${item.variant})` : name;
}
