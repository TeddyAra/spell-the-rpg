import { clamp } from "./dom.js";
import { ITEM_TYPES } from "./items.js";

export const MAGIC_SCHOOLS = [
    "harm",
    "aid",
    "change",
    "move",
    "control",
    "reveal",
    "passion",
    "create"
];

export const SPELL_SLOT_COUNT = 4;
export const MAX_SPELL_SLOT_LEVEL = 6;

export const state = {
    schools: {
        harm: 1,
        aid: 1,
        change: 1,
        move: 1,
        control: 1,
        reveal: 1,
        passion: 6,
        create: 1
    },

    spellSlots: [
        { name: "Spell slot 1", level: 3 },
        { name: "Spell slot 2", level: 5 },
        { name: "Spell slot 3", level: 0 },
        { name: "Spell slot 4", level: 0 }
    ],

    ac: 1,
    dexterity: 10,
    initiative: 0,

    maxHealth: 40,
    currentHealth: 40,
    temporaryHealth: 0,

    // Entries: { id, code, variant?, count?, active?, turns? } — see items.js
    inventory: []
};

/*
 * =========================================================
 * ITEM EFFECTS
 * =========================================================
 */

export function isItemActive(code) {
    return state.inventory.some(item => item.code === code && item.active);
}

/* Blue Gem Necklace: max HP is halved, rounded up. */
export function effectiveMaxHealth() {
    return isItemActive("BGN") ? Math.ceil(state.maxHealth / 2) : state.maxHealth;
}

/* Red Gem Ring: magic schools are 2 lower (minimum 0). */
export function effectiveSchoolLevel(school) {
    const level = state.schools[school];

    return isItemActive("RGR") ? Math.max(0, level - 2) : level;
}

/* Red Gem Ring: spell slots in use are 1 higher (up to 7). */
export function effectiveSlotLevel(slot) {
    if (slot.level === 0) {
        return 0;
    }

    return isItemActive("RGR") ? slot.level + 1 : slot.level;
}

export function defaultSpellSlotName(index) {
    return `Spell slot ${index + 1}`;
}

/* Makes sure there are exactly four valid spell slots, e.g. after loading old saves. */
function normalizeSpellSlots() {
    const slots = Array.isArray(state.spellSlots) ? state.spellSlots : [];

    state.spellSlots = Array.from({ length: SPELL_SLOT_COUNT }, (_, index) => {
        const slot = slots[index];

        return {
            name: typeof slot?.name === "string"
                ? slot.name
                : defaultSpellSlotName(index),

            level: clamp(Number(slot?.level) || 0, 0, MAX_SPELL_SLOT_LEVEL)
        };
    });
}

/*
 * =========================================================
 * PERSISTENCE
 * =========================================================
 */

const STATE_STORAGE_KEY = "myGameState";

export function saveState() {
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
}

export function loadState() {
    const savedState = localStorage.getItem(STATE_STORAGE_KEY);

    if (!savedState) {
        return;
    }

    try {
        const parsedState = JSON.parse(savedState);
        const defaultSchools = { ...state.schools };

        Object.assign(state, parsedState);

        state.schools = { ...defaultSchools, ...parsedState.schools };

        normalizeSpellSlots();

        state.inventory = Array.isArray(state.inventory)
            ? state.inventory.filter(item => ITEM_TYPES[item?.code])
            : [];
    } catch (error) {
        console.error("Failed to load saved state:", error);
    }
}
