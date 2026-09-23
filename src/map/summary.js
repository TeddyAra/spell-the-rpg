import {
    state,
    loadState,
    MAGIC_SCHOOLS,
    TILE_BOARD_STORAGE_KEY,
    effectiveMaxHealth,
    effectiveSchoolLevel,
    effectiveSlotLevel
} from "../state.js";
import { itemName } from "../items.js";
import { findWords } from "../words.js";

/* Reads the letter tiles from the character sheet and works out what they spell (see words.js). */
function readSpelling() {
    let board;

    try {
        board = JSON.parse(localStorage.getItem(TILE_BOARD_STORAGE_KEY));
    } catch {
        return null;
    }

    if (!Array.isArray(board?.tiles) || board.tiles.length === 0) {
        return null;
    }

    const { words, loose } = findWords(board.tiles, board.tileSize || 48);

    return { words: words.map(word => word.text), loose };
}

/*
 * What gets shared of your character: the values as they currently apply
 * (items included), read from the character sheet's saved state. Only the DM
 * receives all of it; other players just see the health.
 */
export function readCharacterSummary() {
    loadState();

    return {
        hp: state.currentHealth,
        maxHp: effectiveMaxHealth(),
        tempHp: state.temporaryHealth,

        ac: state.ac,
        initiative: state.initiative,

        schools: Object.fromEntries(
            MAGIC_SCHOOLS.map(school => [school, effectiveSchoolLevel(school)])
        ),

        spellSlots: state.spellSlots
            .filter(slot => slot.level > 0)
            .map(slot => ({ name: slot.name, level: effectiveSlotLevel(slot) })),

        items: state.inventory.map(item => ({
            name: itemName(item),
            count: item.count,
            active: Boolean(item.active),
            turns: item.turns
        })),

        spelling: readSpelling()
    };
}
