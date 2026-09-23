import { $, show, hide } from "./dom.js";
import { TILE_BOARD_STORAGE_KEY } from "./state.js";
import { findWords } from "./words.js";

// Letter → [number of tiles in the bag, points]
const SCRABBLE_LETTERS = {
    A: [9, 1],
    B: [2, 3],
    C: [2, 3],
    D: [4, 2],
    E: [12, 1],
    F: [2, 4],
    G: [3, 2],
    H: [2, 4],
    I: [9, 1],
    J: [1, 8],
    K: [1, 5],
    L: [4, 1],
    M: [2, 3],
    N: [6, 1],
    O: [8, 1],
    P: [2, 3],
    Q: [1, 10],
    R: [6, 1],
    S: [4, 1],
    T: [6, 1],
    U: [4, 1],
    V: [2, 4],
    W: [2, 4],
    X: [1, 8],
    Y: [2, 4],
    Z: [1, 10],
    _: [4, 0]
};

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

const TILE_SIZE = 48;

const scrabblePool = Object.entries(SCRABBLE_LETTERS)
    .flatMap(([letter, [count]]) => Array(count).fill(letter));

const letterBoard = $("letterBoard");
const safeZone = $("safeZone");

let scrabbleTileZIndex = 20;

/* Every tile's letter and middle point. */
function tileCenters(tiles = allTiles()) {
    return tiles.map(tile => ({
        letter: tile.dataset.letter,
        x: parseFloat(tile.style.left) + TILE_SIZE / 2,
        y: parseFloat(tile.style.top) + TILE_SIZE / 2
    }));
}

/*
 * =========================================================
 * WORDS: a line under tiles that spell a word (see words.js)
 * =========================================================
 */

let underlineUpdateScheduled = false;

function updateWordUnderlines() {
    underlineUpdateScheduled = false;

    for (const line of letterBoard.querySelectorAll(".word-underline")) {
        line.remove();
    }

    const tiles = allTiles();
    const centers = tileCenters(tiles);

    for (const word of findWords(centers, TILE_SIZE).words) {
        const first = centers[word.tiles[0]];
        const last = centers[word.tiles[word.tiles.length - 1]];
        const bottom = Math.max(...word.tiles.map(index => centers[index].y)) + TILE_SIZE / 2;

        const line = document.createElement("div");

        line.className = "word-underline";
        line.style.left = `${first.x - TILE_SIZE / 2}px`;
        line.style.width = `${last.x - first.x + TILE_SIZE}px`;
        line.style.top = `${bottom + 6}px`;

        letterBoard.appendChild(line);
    }
}

/* While dragging, at most once per frame */
function scheduleWordUnderlines() {
    if (!underlineUpdateScheduled) {
        underlineUpdateScheduled = true;
        requestAnimationFrame(updateWordUnderlines);
    }
}

/*
 * The shared map (another tab) shows the DM what each player is spelling,
 * so the board's layout is saved whenever tiles appear, move or disappear.
 */
function publishBoard() {
    const tiles = tileCenters();

    updateWordUnderlines();

    try {
        localStorage.setItem(TILE_BOARD_STORAGE_KEY, JSON.stringify({ tileSize: TILE_SIZE, tiles }));
    } catch {
        // Only the DM's overview misses out
    }
}

function randomScrabbleLetter() {
    return scrabblePool[Math.floor(Math.random() * scrabblePool.length)];
}

function toTileCount(amount) {
    return Math.max(0, Math.floor(Number(amount) || 0));
}

/*
 * =========================================================
 * CREATING TILES
 * =========================================================
 */

function createScrabbleLetter(letter, index) {
    const tile = document.createElement("div");

    tile.className = "scrabble-letter";
    tile.textContent = letter;
    tile.dataset.letter = letter;

    tile.setAttribute("aria-label", `Scrabble letter ${letter}`);

    const value = document.createElement("span");

    value.className = "scrabble-letter-value";
    value.textContent = SCRABBLE_LETTERS[letter][1];

    tile.appendChild(value);

    // Keep new tiles clear of the side menus.
    const horizontalPadding = 400;
    const verticalPadding = 50;

    const maxX = Math.max(horizontalPadding, window.innerWidth - TILE_SIZE - horizontalPadding);
    const maxY = Math.max(verticalPadding, window.innerHeight - TILE_SIZE - verticalPadding);

    tile.style.left = `${horizontalPadding + Math.random() * (maxX - horizontalPadding)}px`;
    tile.style.top = `${verticalPadding + Math.random() * (maxY - verticalPadding)}px`;

    tile.style.setProperty("--rotation", `${-12 + Math.random() * 24}deg`);

    tile.style.zIndex = String(20 + index);

    makeScrabbleTileDraggable(tile);

    letterBoard.appendChild(tile);
}

function spawnLetters(letters) {
    letters.forEach(createScrabbleLetter);

    scrabbleTileZIndex += letters.length;

    publishBoard();
}

export function spawnScrabbleLetters(amount) {
    spawnLetters(Array.from({ length: toTileCount(amount) }, randomScrabbleLetter));
}

/* Spawns `amount` copies of each of the given letters. */
function spawnSelectedScrabbleLetters(letters, amount) {
    const count = toTileCount(amount);

    spawnLetters(letters.flatMap(letter => Array(count).fill(letter)));
}

/*
 * =========================================================
 * DRAGGING
 * =========================================================
 */

function makeScrabbleTileDraggable(tile) {
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;

    let activePointerId = null;

    function moveTile(event) {
        if (event.pointerId !== activePointerId) {
            return;
        }

        const maxX = window.innerWidth - tile.offsetWidth;
        const maxY = window.innerHeight - tile.offsetHeight;

        const x = Math.max(0, Math.min(event.clientX - pointerOffsetX, maxX));
        const y = Math.max(0, Math.min(event.clientY - pointerOffsetY, maxY));

        tile.style.left = `${x}px`;
        tile.style.top = `${y}px`;

        safeZone.classList.toggle("active", tileIsInSafeZone(tile));

        scheduleWordUnderlines();
    }

    function stopDragging(event) {
        if (activePointerId !== null && event.pointerId !== activePointerId) {
            return;
        }

        activePointerId = null;

        tile.classList.remove("dragging");

        try {
            tile.releasePointerCapture(event.pointerId);
        } catch {
            // The pointer may already have been released.
        }

        document.removeEventListener("pointermove", moveTile);
        document.removeEventListener("pointerup", stopDragging);
        document.removeEventListener("pointercancel", stopDragging);

        safeZone.classList.remove("active");

        publishBoard();
    }

    tile.addEventListener("pointerdown", event => {
        if (event.button !== undefined && event.button !== 0) {
            return;
        }

        event.preventDefault();

        activePointerId = event.pointerId;

        const rect = tile.getBoundingClientRect();

        pointerOffsetX = event.clientX - rect.left;
        pointerOffsetY = event.clientY - rect.top;

        scrabbleTileZIndex++;
        tile.style.zIndex = scrabbleTileZIndex;

        tile.classList.add("dragging");

        try {
            tile.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture isn't supported everywhere; dragging still works without it.
        }

        document.addEventListener("pointermove", moveTile);
        document.addEventListener("pointerup", stopDragging);
        document.addEventListener("pointercancel", stopDragging);
    });
}

/*
 * =========================================================
 * SAFE ZONE / CLEAR / SORT
 * =========================================================
 */

function allTiles() {
    return Array.from(letterBoard.querySelectorAll(".scrabble-letter"));
}

function tileIsInSafeZone(tile) {
    const tileRect = tile.getBoundingClientRect();
    const safeRect = safeZone.getBoundingClientRect();

    const tileCenterX = tileRect.left + tileRect.width / 2;
    const tileCenterY = tileRect.top + tileRect.height / 2;

    return (
        tileCenterX >= safeRect.left &&
        tileCenterX <= safeRect.right &&
        tileCenterY >= safeRect.top &&
        tileCenterY <= safeRect.bottom
    );
}

function clearTilesOutsideSafeZone() {
    for (const tile of allTiles()) {
        if (!tileIsInSafeZone(tile)) {
            tile.remove();
        }
    }

    // Clearing the board also ends the spell that was cast.
    hide($("spellControl"));

    publishBoard();
}

/* Scatters a group of tiles randomly within `area`. */
function placePile(tiles, area) {
    for (const tile of tiles) {
        const maxX = Math.max(area.x, area.x + area.width - tile.offsetWidth);
        const maxY = Math.max(area.y, area.y + area.height - tile.offsetHeight);

        tile.style.left = `${area.x + Math.random() * (maxX - area.x)}px`;
        tile.style.top = `${area.y + Math.random() * (maxY - area.y)}px`;
    }
}

/* Moves every tile outside the safe zone into vowel, consonant and blank piles. */
function sortTiles() {
    const groups = {
        vowels: [],
        consonants: [],
        blanks: []
    };

    for (const tile of allTiles()) {
        if (tileIsInSafeZone(tile)) {
            continue;
        }

        const letter = tile.dataset.letter;

        if (letter === "_") {
            groups.blanks.push(tile);
        } else if (VOWELS.has(letter)) {
            groups.vowels.push(tile);
        } else {
            groups.consonants.push(tile);
        }
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    placePile(groups.vowels, {
        x: width * 0.25,
        y: 280,
        width: width * 0.19,
        height: height * 0.32
    });

    placePile(groups.consonants, {
        x: width * 0.55,
        y: 280,
        width: width * 0.19,
        height: height * 0.32
    });

    placePile(groups.blanks, {
        x: width * 0.4,
        y: height * 0.72,
        width: width * 0.15,
        height: height * 0.1
    });

    publishBoard();
}

$("clearTilesButton").addEventListener("click", clearTilesOutsideSafeZone);

// Tiles aren't kept when the page reloads, so start with an empty board
publishBoard();
$("sortTilesButton").addEventListener("click", sortTiles);

/*
 * =========================================================
 * GET TILES OVERLAY
 * =========================================================
 */

const tileCountOverlay = $("tileCountOverlay");
const tileCountInput = $("tileCountInput");

function tileCheckboxes() {
    return Array.from(document.querySelectorAll("#tileSelectionGrid input[type='checkbox']"));
}

$("getTilesButton").addEventListener("click", () => {
    tileCountInput.value = 1;

    for (const checkbox of tileCheckboxes()) {
        checkbox.checked = false;
    }

    show(tileCountOverlay);
});

$("cancelTiles").addEventListener("click", () => hide(tileCountOverlay));

$("getTiles").addEventListener("click", () => {
    const selectedLetters = tileCheckboxes()
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.value);

    if (selectedLetters.length === 0) {
        spawnScrabbleLetters(tileCountInput.value);
    } else {
        spawnSelectedScrabbleLetters(selectedLetters, tileCountInput.value);
    }

    hide(tileCountOverlay);
});

/*
 * =========================================================
 * BOX SELECTION (Elixir of Grandiloquence)
 * =========================================================
 */

const tileSelectionLayer = $("tileSelectionLayer");
const tileSelectionBox = $("tileSelectionBox");

export function letterScore(letter) {
    return SCRABBLE_LETTERS[letter][1];
}

/*
 * Lets the player drag a box around tiles. Resolves with the selected letters,
 * or null if cancelled. Boxes that contain no tiles are ignored.
 */
export function selectTilesWithBox() {
    return new Promise(resolve => {
        let start = null;
        let selected = [];

        function boxRect(event) {
            return {
                left: Math.min(start.x, event.clientX),
                top: Math.min(start.y, event.clientY),
                right: Math.max(start.x, event.clientX),
                bottom: Math.max(start.y, event.clientY)
            };
        }

        function tilesInside(rect) {
            return allTiles().filter(tile => {
                const tileRect = tile.getBoundingClientRect();
                const centerX = tileRect.left + tileRect.width / 2;
                const centerY = tileRect.top + tileRect.height / 2;

                return centerX >= rect.left && centerX <= rect.right &&
                    centerY >= rect.top && centerY <= rect.bottom;
            });
        }

        function markSelected(tiles) {
            selected.forEach(tile => tile.classList.remove("selected"));
            selected = tiles;
            selected.forEach(tile => tile.classList.add("selected"));
        }

        function onPointerDown(event) {
            if (event.target !== tileSelectionLayer) {
                return;
            }

            start = { x: event.clientX, y: event.clientY };

            try {
                tileSelectionLayer.setPointerCapture(event.pointerId);
            } catch {
                // Selecting still works without pointer capture.
            }

            onPointerMove(event);
            show(tileSelectionBox);
        }

        function onPointerMove(event) {
            if (!start) {
                return;
            }

            const rect = boxRect(event);

            tileSelectionBox.style.left = `${rect.left}px`;
            tileSelectionBox.style.top = `${rect.top}px`;
            tileSelectionBox.style.width = `${rect.right - rect.left}px`;
            tileSelectionBox.style.height = `${rect.bottom - rect.top}px`;

            markSelected(tilesInside(rect));
        }

        function onPointerUp() {
            if (!start) {
                return;
            }

            start = null;
            hide(tileSelectionBox);

            if (selected.length) {
                finish(selected.map(tile => tile.dataset.letter));
            }
        }

        function onKeyDown(event) {
            if (event.key === "Escape") {
                finish(null);
            }
        }

        function onCancel() {
            finish(null);
        }

        function finish(result) {
            markSelected([]);
            hide(tileSelectionBox);
            hide(tileSelectionLayer);

            tileSelectionLayer.removeEventListener("pointerdown", onPointerDown);
            tileSelectionLayer.removeEventListener("pointermove", onPointerMove);
            tileSelectionLayer.removeEventListener("pointerup", onPointerUp);
            tileSelectionLayer.removeEventListener("pointercancel", onPointerUp);
            document.removeEventListener("keydown", onKeyDown);
            $("cancelTileSelection").removeEventListener("click", onCancel);

            resolve(result);
        }

        tileSelectionLayer.addEventListener("pointerdown", onPointerDown);
        tileSelectionLayer.addEventListener("pointermove", onPointerMove);
        tileSelectionLayer.addEventListener("pointerup", onPointerUp);
        tileSelectionLayer.addEventListener("pointercancel", onPointerUp);
        document.addEventListener("keydown", onKeyDown);
        $("cancelTileSelection").addEventListener("click", onCancel);

        show(tileSelectionLayer);
    });
}
