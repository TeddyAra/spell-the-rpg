/*
 * Works out which letter tiles form words: tiles lined up next to each other
 * in a row, left to right. Used by the character sheet (to underline words)
 * and by the shared map (to show the DM what each player is spelling).
 *
 * To count as neighbours, two tiles have to be:
 *   - about one tile apart: not overlapping a lot, and not with a big gap
 *   - at the same height (tiles are placed by hand, so a little wobble is fine)
 * Each tile has at most one neighbour on each side, the best-fitting one.
 */

// In tile sizes, measured between the tiles' centres
const MIN_SPACING = 0.8;   // closer than this, the tiles overlap too much
const MAX_SPACING = 1.4;   // further than this, there's a gap between them
const MAX_HEIGHT_DIFFERENCE = 0.3;

/*
 * tiles: [{ letter, x, y }] with x, y the middle of each tile.
 * Returns { words: [{ text, tiles: [index, ...] }], loose: [letter, ...] }.
 */
export function findWords(tiles, tileSize) {
    const links = []; // candidate pairs: left tile → right tile, with how well they fit

    tiles.forEach((left, i) => {
        tiles.forEach((right, j) => {
            const dx = (right.x - left.x) / tileSize;
            const dy = Math.abs(right.y - left.y) / tileSize;

            if (i !== j && dx >= MIN_SPACING && dx <= MAX_SPACING && dy <= MAX_HEIGHT_DIFFERENCE) {
                links.push({ i, j, misfit: Math.abs(dx - 1) + dy });
            }
        });
    });

    // Best-fitting pairs first; each tile gets one neighbour on each side at most
    links.sort((a, b) => a.misfit - b.misfit);

    const rightOf = new Map();
    const leftOf = new Map();

    for (const { i, j } of links) {
        if (!rightOf.has(i) && !leftOf.has(j)) {
            rightOf.set(i, j);
            leftOf.set(j, i);
        }
    }

    const words = [];
    const inWord = new Set();

    tiles.forEach((tile, start) => {
        if (leftOf.has(start) || !rightOf.has(start)) {
            return; // not the first letter of a word
        }

        const chain = [start];

        while (rightOf.has(chain[chain.length - 1])) {
            chain.push(rightOf.get(chain[chain.length - 1]));
        }

        chain.forEach(index => inWord.add(index));
        words.push({ text: chain.map(index => tiles[index].letter).join(""), tiles: chain });
    });

    // Top to bottom, then left to right, like reading
    words.sort((a, b) => tiles[a.tiles[0]].y - tiles[b.tiles[0]].y || tiles[a.tiles[0]].x - tiles[b.tiles[0]].x);

    const loose = tiles.filter((tile, index) => !inWord.has(index)).map(tile => tile.letter).sort();

    return { words, loose };
}
