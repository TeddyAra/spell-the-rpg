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

/*
 * Reads the letter tiles from the character sheet and works out what they spell:
 * tiles lying next to each other in a row form a word, the rest are loose.
 */
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

    const size = board.tileSize || 48;
    const rows = [];

    // Group tiles into rows by height (tiles are placed by hand, so allow some wobble)
    for (const tile of [...board.tiles].sort((a, b) => a.y - b.y)) {
        const row = rows.find(candidate => Math.abs(candidate.y - tile.y) < size * 0.6);

        if (row) {
            row.tiles.push(tile);
            row.y = row.tiles.reduce((sum, t) => sum + t.y, 0) / row.tiles.length;
        } else {
            rows.push({ y: tile.y, tiles: [tile] });
        }
    }

    const words = [];
    const loose = [];

    const finish = group => {
        if (group.length >= 2) {
            words.push(group.map(tile => tile.letter).join(""));
        } else {
            loose.push(group[0].letter);
        }
    };

    for (const row of rows.sort((a, b) => a.y - b.y)) {
        row.tiles.sort((a, b) => a.x - b.x);

        let group = [row.tiles[0]];

        for (const tile of row.tiles.slice(1)) {
            // Up to half a tile of space still counts as the same word
            if (tile.x - group[group.length - 1].x <= size * 1.5) {
                group.push(tile);
            } else {
                finish(group);
                group = [tile];
            }
        }

        finish(group);
    }

    return { words, loose: loose.sort() };
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
