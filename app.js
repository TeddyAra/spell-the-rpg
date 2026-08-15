import "./style.css";
import DiceBox from "@3d-dice/dice-box-threejs";

const diceColors = [
    "#00ffcb",
    "#ff6600",
    "#1d66af",
    "#7028ed",
    "#c4c427",
    "#d81128"
];

const magicSchools = [
    "harm",
    "aid",
    "change",
    "move",
    "control",
    "reveal",
    "passion",
    "create"
];

const state = {
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
};

const $ = id => document.getElementById(id);

function show(element) {
    if (element) {
        element.classList.remove("hidden");
    }
}

function hide(element) {
    if (element) {
        element.classList.add("hidden");
    }
}

function initiativeModifier(dexterity) {
    return Math.floor(
        (dexterity - 10) / 2
    );
}

function formatModifier(value) {
    return value >= 0 ? `+${value}` : String(value);
}

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

/*
 * =========================================================
 * GAME STATE
 * =========================================================
 */

const STATE_STORAGE_KEY = "myGameState";

function saveState() {
    localStorage.setItem(
        STATE_STORAGE_KEY,
        JSON.stringify(state)
    );
}

function loadState() {
    const savedState =
        localStorage.getItem(STATE_STORAGE_KEY);

    if (!savedState) {
        return;
    }

    try {
        const parsedState =
            JSON.parse(savedState);

        Object.assign(
            state,
            parsedState
        );

        if (parsedState.schools) {
            Object.assign(
                state.schools,
                parsedState.schools
            );
        }

        normalizeSpellSlots();

    } catch (error) {
        console.error(
            "Failed to load saved state:",
            error
        );
    }
}

/*
 * =========================================================
 * SCRABBLE TILES
 * =========================================================
 */

const letterBoard = $("letterBoard");

const scrabbleLetters = [
    ["A", 9],
    ["B", 2],
    ["C", 2],
    ["D", 4],
    ["E", 12],
    ["F", 2],
    ["G", 3],
    ["H", 2],
    ["I", 9],
    ["J", 1],
    ["K", 1],
    ["L", 4],
    ["M", 2],
    ["N", 6],
    ["O", 8],
    ["P", 2],
    ["Q", 1],
    ["R", 6],
    ["S", 4],
    ["T", 6],
    ["U", 4],
    ["V", 2],
    ["W", 2],
    ["X", 1],
    ["Y", 2],
    ["Z", 1],
    ["_", 4]
];

const scrabbleLetterValues = {
    A: 1,
    B: 3,
    C: 3,
    D: 2,
    E: 1,
    F: 4,
    G: 2,
    H: 4,
    I: 1,
    J: 8,
    K: 5,
    L: 1,
    M: 3,
    N: 1,
    O: 1,
    P: 3,
    Q: 10,
    R: 1,
    S: 1,
    T: 1,
    U: 1,
    V: 4,
    W: 4,
    X: 8,
    Y: 4,
    Z: 10,
    _: 0
};

const scrabblePool = [];

for (const [letter, count] of scrabbleLetters) {
    for (let i = 0; i < count; i++) {
        scrabblePool.push(letter);
    }
}

function randomScrabbleLetter() {
    return scrabblePool[
        Math.floor(Math.random() * scrabblePool.length)
    ];
}

function createScrabbleLetter(letter, index, total) {
    if (!letterBoard) {
        return;
    }

    const tile = document.createElement("div");

    tile.className = "scrabble-letter";
    tile.textContent = letter;

    tile.setAttribute("aria-label", `Scrabble letter ${letter}`);

    const value = document.createElement("span");

    value.className = "scrabble-letter-value";
    value.textContent = scrabbleLetterValues[letter];

    tile.appendChild(value);

    const tileSize = 48;
    const horizontalPadding = 400;
    const verticalPadding = 50;

    const maxX = Math.max(
        horizontalPadding,
        window.innerWidth - tileSize - horizontalPadding
    );

    const maxY = Math.max(
        verticalPadding,
        window.innerHeight - tileSize - verticalPadding
    );

    tile.style.left = `${horizontalPadding + Math.random() * (maxX - horizontalPadding)}px`;
    tile.style.top = `${verticalPadding + Math.random() * (maxY - verticalPadding)}px`;

    tile.style.setProperty(
        "--rotation",
        `${-12 + Math.random() * 24}deg`
    );

    tile.style.zIndex = String(20 + index);

    makeScrabbleTileDraggable(tile);

    letterBoard.appendChild(tile);
}

function spawnScrabbleLetters(amount) {
    if (!letterBoard) {
        return;
    }

    const count = Math.max(
        0,
        Math.floor(Number(amount) || 0)
    );

    for (let i = 0; i < count; i++) {
        createScrabbleLetter(
            randomScrabbleLetter(),
            i,
            count
        );
    }

    scrabbleTileZIndex += count;
}

function spawnSelectedScrabbleLetters(letters, amount) {
    if (!letterBoard) {
        return;
    }

    const count = Math.max(
        0,
        Math.floor(Number(amount) || 0)
    );

    let index = 0;

    for (const letter of letters) {
        for (let i = 0; i < count; i++) {
            createScrabbleLetter(
                letter,
                index,
                letters.length * count
            );

            index++;
        }
    }

    scrabbleTileZIndex += index;
}

let scrabbleTileZIndex = 20;

function makeScrabbleTileDraggable(tile) {
    let dragging = false;

    let pointerOffsetX = 0;
    let pointerOffsetY = 0;

    let activePointerId = null;

    function moveTile(event) {
        if (!dragging || event.pointerId !== activePointerId) {
            return;
        }

        let x = event.clientX - pointerOffsetX;
        let y = event.clientY - pointerOffsetY;

        const maxX = window.innerWidth - tile.offsetWidth;
        const maxY = window.innerHeight - tile.offsetHeight;

        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));

        tile.style.left = `${x}px`;
        tile.style.top = `${y}px`;

        if (safeZone) {
            safeZone.classList.toggle(
                "active",
                tileIsInSafeZone(tile)
            );
        }
    }

    function stopDragging(event) {
        if (
            activePointerId !== null &&
            event.pointerId !== activePointerId
        ) {
            return;
        }

        dragging = false;
        activePointerId = null;

        tile.classList.remove("dragging");

        try {
            tile.releasePointerCapture(event.pointerId);
        } catch {
            
        }

        document.removeEventListener(
            "pointermove",
            moveTile
        );

        document.removeEventListener(
            "pointerup",
            stopDragging
        );

        document.removeEventListener(
            "pointercancel",
            stopDragging
        );

        if (safeZone) {
            safeZone.classList.remove("active");
        }
    }

    tile.addEventListener("pointerdown", event => {
        if (event.button !== undefined && event.button !== 0) {
            return;
        }

        event.preventDefault();

        dragging = true;
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
            
        }

        document.addEventListener(
            "pointermove",
            moveTile
        );

        document.addEventListener(
            "pointerup",
            stopDragging
        );

        document.addEventListener(
            "pointercancel",
            stopDragging
        );
    });
}

/*
 * =========================================================
 * CLEAR TILES
 * =========================================================
 */

const safeZone = $("safeZone");
const clearTilesButton = $("clearTilesButton");

function tileIsInSafeZone(tile) {
    if (!safeZone || !tile) {
        return false;
    }

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
    if (!letterBoard) {
        return;
    }

    const tiles = letterBoard.querySelectorAll(".scrabble-letter");

    tiles.forEach(tile => {
        if (!tileIsInSafeZone(tile)) {
            tile.remove();
        }
    });

    hide(spellControl);
}

if (clearTilesButton) {
    clearTilesButton.addEventListener(
        "click",
        clearTilesOutsideSafeZone
    );
}

/*
 * =========================================================
 * SORT SCRABBLE TILES
 * =========================================================
 */

const sortTilesButton = $("sortTilesButton");

if (sortTilesButton) {
    sortTilesButton.addEventListener(
        "click",
        sortTiles
    );
}

function sortTiles() {
    if (!letterBoard) {
        return;
    }

    const vowels = new Set(["A", "E", "I", "O", "U"]);

    const tiles = Array.from(
        letterBoard.querySelectorAll(".scrabble-letter")
    );

    tiles.sort((a, b) => {
        const letterA = a.dataset.letter || a.textContent.trim().charAt(0);
        const letterB = b.dataset.letter || b.textContent.trim().charAt(0);

        if (letterA === "_" && letterB !== "_") return 1;
        if (letterB === "_" && letterA !== "_") return -1;

        const vowelA = vowels.has(letterA);
        const vowelB = vowels.has(letterB);

        if (vowelA !== vowelB) {
            return vowelA ? -1 : 1;
        }

        return letterA.localeCompare(letterB);
    });

    const groups = {
        vowels: [],
        consonants: [],
        blanks: []
    };

    tiles.forEach(tile => {
        const letter =
            tile.dataset.letter ||
            tile.textContent.trim().charAt(0);

        if (tileIsInSafeZone(tile)) {
            return;
        }

        if (letter === "_") {
            groups.blanks.push(tile);
        } else if (vowels.has(letter)) {
            groups.vowels.push(tile);
        } else {
            groups.consonants.push(tile);
        }
    });

    function placePile(tiles, area) {
        tiles.forEach((tile, index) => {
            const maxX = Math.max(
                area.x,
                area.x + area.width - tile.offsetWidth
            );

            const maxY = Math.max(
                area.y,
                area.y + area.height - tile.offsetHeight
            );

            tile.style.left =
                `${area.x + Math.random() * (maxX - area.x)}px`;

            tile.style.top =
                `${area.y + Math.random() * (maxY - area.y)}px`;
        });
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
}

/*
 * =========================================================
 * SCHOOL ROLLING
 * =========================================================
 */

for (const school in magicSchools) {
    const schoolButton = $(magicSchools[school] + "Button");

    if (schoolButton) {
        schoolButton.addEventListener(
            "click",
            event => {
                rollSchoolDice(magicSchools[school]);
            }
        )
    }
}

/*
 * =========================================================
 * SPELL SLOTS
 * =========================================================
 */

const spellSlotResultOverlay = $("spellSlotResultOverlay");
const spellSlotSuccessResultOverlay = $("spellSlotSuccessResultOverlay");

const spellSlotHighestRoll = $("spellSlotHighestRoll");
const spellSlotTotalSum = $("spellSlotTotalSum");
const spellSlotIndividualRolls = $("spellSlotIndividualRolls");

const successButton = $("successButton");
const failButton = $("failButton");
const closeSpellSlotResult = $("closeResults");
const closeSpellSlotSuccessResult = $("closeSpellSlotResult");

let activeSpellSlotIndex = null;
let activeSpellSlotLevel = 0;


/* ---------------------------------------------------------
   SPELL SLOT STATE
   --------------------------------------------------------- */

function normalizeSpellSlots() {
    if (!Array.isArray(state.spellSlots)) {
        state.spellSlots = [];
    }

    while (state.spellSlots.length < 4) {
        const index = state.spellSlots.length;

        state.spellSlots.push({
            name: `Spell slot ${index + 1}`,
            level: 0
        });
    }

    state.spellSlots = state.spellSlots
        .slice(0, 4)
        .map((slot, index) => ({
            name:
                typeof slot?.name === "string"
                    ? slot.name
                    : `Spell slot ${index + 1}`,

            level: clamp(
                Number(slot?.level) || 0,
                0,
                6
            )
        }));
}


/* ---------------------------------------------------------
   UPDATE SPELL SLOT BUTTONS
   --------------------------------------------------------- */

function updateSpellSlotDisplay() {
    normalizeSpellSlots();

    state.spellSlots.forEach((slot, index) => {
        const button = $(`spellSlot${index + 1}`);

        const nameDisplay =
            $(`spellSlot${index + 1}Name`);

        const levelDisplay =
            $(`spellSlot${index + 1}Display`);

        if (!button) {
            return;
        }

        const disabled = slot.level === 0;

        button.disabled = disabled;

        button.classList.toggle(
            "spell-slot-disabled",
            disabled
        );

        if (nameDisplay) {
            nameDisplay.textContent = disabled
                ? `Spell slot ${index + 1}`
                : (
                    slot.name.trim() ||
                    `Spell slot ${index + 1}`
                );
        }

        if (levelDisplay) {
            levelDisplay.textContent =
                disabled ? "" : slot.level;
        }
    });
}


/* ---------------------------------------------------------
   LOAD SETTINGS INTO INPUTS
   --------------------------------------------------------- */

function syncSpellSlotInputs() {
    normalizeSpellSlots();

    state.spellSlots.forEach((slot, index) => {
        const nameInput =
            $(`spellSlot${index + 1}NameInput`);

        const levelInput =
            $(`spellSlot${index + 1}LevelInput`);

        if (nameInput) {
            nameInput.value = slot.name;
        }

        if (levelInput) {
            levelInput.value = slot.level;
        }
    });
}


/* ---------------------------------------------------------
   SAVE ONE SPELL SLOT
   --------------------------------------------------------- */

function saveSpellSlotInput(index) {
    const nameInput =
        $(`spellSlot${index + 1}NameInput`);

    const levelInput =
        $(`spellSlot${index + 1}LevelInput`);

    if (!nameInput || !levelInput) {
        return;
    }

    let level = parseInt(
        levelInput.value,
        10
    );

    if (Number.isNaN(level)) {
        level = 0;
    }

    level = clamp(level, 0, 6);

    state.spellSlots[index] = {
        name:
            nameInput.value.trim() ||
            `Spell slot ${index + 1}`,

        level
    };

    levelInput.value = level;

    updateSpellSlotDisplay();

    saveState();
}


/* ---------------------------------------------------------
   RENDER SPELL SLOT ROLL
   --------------------------------------------------------- */

function showSpellSlotRolls(rolls) {
    const highest = rolls.length
        ? Math.max(...rolls)
        : 0;

    const total = rolls.reduce(
        (sum, value) => sum + value,
        0
    );

    if (spellSlotHighestRoll) {
        spellSlotHighestRoll.textContent =
            highest;
    }

    if (spellSlotTotalSum) {
        spellSlotTotalSum.textContent =
            total;
    }

    if (spellSlotIndividualRolls) {
        spellSlotIndividualRolls.innerHTML = "";

        rolls.forEach(value => {
            const die =
                document.createElement("div");

            die.className = "die";

            die.textContent = value;

            spellSlotIndividualRolls
                .appendChild(die);
        });
    }
}


/* ---------------------------------------------------------
   ROLL SPELL SLOT
   --------------------------------------------------------- */

async function rollSpellSlot(slotIndex) {
    normalizeSpellSlots();

    const slot =
        state.spellSlots[slotIndex];

    if (!slot || slot.level === 0) {
        return;
    }

    if (!diceBoxReady) {
        console.warn(
            "DiceBox is not ready yet."
        );

        return;
    }

    activeSpellSlotIndex = slotIndex;
    activeSpellSlotLevel = slot.level;

    show(animationOverlay);

    setDiceTheme();

    requestAnimationFrame(async () => {
        window.dispatchEvent(
            new Event("resize")
        );

        try {
            const results =
                await diceBox.roll(
                    `${slot.level}d6`
                );

            const rolls =
                extractDiceResults(results);

            if (!rolls.length) {
                throw new Error(
                    "No dice results were returned."
                );
            }

            state.lastRolls = rolls;

            showSpellSlotRolls(rolls);

            hide(animationOverlay);

            show(spellSlotResultOverlay);

        } catch (error) {
            console.error(
                "Spell slot roll failed:",
                error
            );

            hide(animationOverlay);
        }
    });
}


/* ---------------------------------------------------------
   SUCCESS: ROLL 1D6 FOR LEVEL UP
   --------------------------------------------------------- */

async function rollSpellSlotLevelUpDie() {
    if (
        activeSpellSlotIndex === null ||
        activeSpellSlotLevel < 1
    ) {
        return;
    }

    const spellSlot =
        state.spellSlots[
            activeSpellSlotIndex
        ];

    if (!spellSlot) {
        return;
    }

    // Level 6 is already the maximum.
    if (spellSlot.level >= 6) {
        hide(spellSlotResultOverlay);

        const levelDisplay =
            $("spellSlotCurrentLevel");

        const rollDisplay =
            $("spellSlotLevelUpRoll");

        const statusDisplay =
            $("spellSlotLevelStatus");

        if (levelDisplay) {
            levelDisplay.textContent =
                spellSlot.level;
        }

        if (rollDisplay) {
            rollDisplay.textContent =
                "—";
        }

        if (statusDisplay) {
            statusDisplay.textContent =
                "Already at maximum level.";
        }

        show(
            spellSlotSuccessResultOverlay
        );

        return;
    }

    if (!diceBoxReady) {
        console.warn(
            "DiceBox is not ready yet."
        );

        return;
    }

    hide(spellSlotResultOverlay);

    show(animationOverlay);

    setDiceTheme();

    requestAnimationFrame(async () => {
        window.dispatchEvent(
            new Event("resize")
        );

        try {
            const results =
                await diceBox.roll("1d6");

            const rolls =
                extractDiceResults(results);

            if (!rolls.length) {
                throw new Error(
                    "No dice result was returned."
                );
            }

            const roll = rolls[0];

            const oldLevel =
                spellSlot.level;

            const leveledUp =
                roll >= oldLevel;

            if (leveledUp) {
                spellSlot.level =
                    clamp(
                        oldLevel + 1,
                        0,
                        6
                    );

                saveState();
                updateSpellSlotDisplay();
                syncSpellSlotInputs();
            }

            hide(animationOverlay);

            const levelDisplay =
                $("spellSlotCurrentLevel");

            const rollDisplay =
                $("spellSlotLevelUpRoll");

            const statusDisplay =
                $("spellSlotLevelStatus");

            if (levelDisplay) {
                levelDisplay.textContent =
                    spellSlot.level;
            }

            if (rollDisplay) {
                rollDisplay.textContent =
                    roll;
            }

            if (statusDisplay) {
                statusDisplay.textContent = leveledUp ? (oldLevel + " ➝ " + spellSlot.level) : spellSlot.level;
            }

            show(
                spellSlotSuccessResultOverlay
            );

        } catch (error) {
            console.error(
                "Spell slot level-up roll failed:",
                error
            );

            hide(animationOverlay);
        }
    });
}

/* ---------------------------------------------------------
   SPELL SLOT BUTTONS
   --------------------------------------------------------- */

for (let i = 0; i < 4; i++) {
    const button =
        $(`spellSlot${i + 1}`);

    if (button) {
        button.addEventListener(
            "click",
            () => rollSpellSlot(i)
        );
    }

    const nameInput =
        $(`spellSlot${i + 1}NameInput`);

    const levelInput =
        $(`spellSlot${i + 1}LevelInput`);

    if (nameInput) {
        nameInput.addEventListener(
            "change",
            () => saveSpellSlotInput(i)
        );
    }

    if (levelInput) {
        levelInput.addEventListener(
            "change",
            () => saveSpellSlotInput(i)
        );
    }
}


/* ---------------------------------------------------------
   SUCCESS / FAIL BUTTONS
   --------------------------------------------------------- */

if (successButton) {
    successButton.addEventListener(
        "click",
        () => {
            rollSpellSlotLevelUpDie();
        }
    );
}

if (failButton) {
    failButton.addEventListener(
        "click",
        () => {
            hide(spellSlotResultOverlay);
        }
    );
}

if (closeSpellSlotResult) {
    closeSpellSlotResult.addEventListener(
        "click",
        () => {
            hide(spellSlotResultOverlay);
        }
    );
}

if (closeSpellSlotSuccessResult) {
    closeSpellSlotSuccessResult.addEventListener(
        "click",
        () => {
            hide(
                spellSlotSuccessResultOverlay
            );
        }
    );
}

/* ---------------------------------------------------------
   INITIALIZE SPELL SLOTS
   --------------------------------------------------------- */

normalizeSpellSlots();
syncSpellSlotInputs();
updateSpellSlotDisplay();

/*
 * =========================================================
 * DICE
 * =========================================================
 */

const animationOverlay = $("animationOverlay");

const diceBox = new DiceBox("#diceBox", {
    theme_customColorset: {
        background: "#00ffcb",
        foreground: "#ffffff",
        texture: "none",
        material: "metal"
    },

    gravity_multiplier: 350,
    strength: 0.5,

    light_intensity: 1,
    baseScale: 100,

    onRollComplete(results) {
        console.log("3D dice roll complete:", results);
    }
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

function randomDiceColor() {
    return diceColors[Math.floor(Math.random() * diceColors.length)];
}

function setDiceTheme() {
    diceBox.updateConfig({
        theme_customColorset: {
            background: randomDiceColor(),
            foreground: "#ffffff",
            texture: "none",
            material: "metal"
        }
    });
}

async function rollSchoolDice(school) {
    if (!diceBoxReady) {
        console.warn("DiceBox is not ready yet.");

        return;
    }

    const count = school === "none" 
        ? rollD6Input.value 
        : school === "level" 
            ? lastSpellLevel
            : state.schools[school];

    show(animationOverlay);
    setDiceTheme();

    requestAnimationFrame(async () => {
        window.dispatchEvent(new Event("resize"));

        try {
            const results = await diceBox.roll(`${count}d6`);
            const rolls = extractDiceResults(results);

            if (!rolls.length) {
                throw new Error("No dice results were returned.");
            }

            state.lastRolls = rolls;

            const calculated = calculateSpellResults(rolls);

            hide(animationOverlay);

            if (school === "level") {
                hide(spellLevelResult);
                hide(resultActions);
                show(resultBackButton);
            } else {
                show(spellLevelResult);
                show(resultActions);
                hide(resultBackButton);
            }

            showSchoolResults(rolls, calculated);
        } catch (error) {
            console.error("Dice roll failed:", error);

            hide(animationOverlay);
        }
    });
}

function calculateSpellResults(rolls) {
    if (!rolls.length) {
        return {
            highest: 0,
            spellLevel: 1,
            total: 0
        };
    }

    const highest = Math.max(...rolls);
    const highRollCount = rolls.filter(value => value === 5 || value === 6).length;
    const spellLevel = highRollCount === 0 ? 1 : highRollCount;
    const total = rolls.reduce((sum, value) => sum + value, 0);

    return {
        highest,
        spellLevel,
        total
    };
}

function extractDiceResults(results) {
    if (!results || !Array.isArray(results.sets)) {
        console.error("Unexpected DiceBox result:", results);

        return [];
    }

    const rolls = [];

    results.sets.forEach(set => {
        const dice = Array.isArray(set.rolls)
                ? set.rolls
                : Array.isArray(set.dice)
                    ? set.dice
                    : [];

        dice.forEach(die => {
            if (typeof die === "number") {
                rolls.push(die);
                return;
            }

            if (die && typeof die.value === "number") {
                rolls.push(die.value);
            }
        });
    });

    console.log("Extracted rolls:", rolls);

    return rolls;
}

/*
 * =========================================================
 * SPELL CONTROL
 * =========================================================
 */

const spellControl = $("spellControl");
const spellLevelDisplay = $("spellLevelDisplay");
const spellEffectButton = $("spellEffectButton");
const spellLevelResult = $("spellLevelResult");
const resultActions = $("resultActions");
const resultBackButton = $("resultBackButton");

let lastSpellLevel = 1;

if (spellEffectButton) {
    spellEffectButton.addEventListener(
        "click",
        event => {
            hide(spellControl);
            rollSchoolDice("level");
        }
    )
}

if (resultBackButton) {
    resultBackButton.addEventListener(
        "click",
        event => {
            hide(schoolResultOverlay);
        }
    );
}

/*
 * =========================================================
 * DEXTERITY
 * =========================================================
 */

const dexterityButton = $("dexButton");

if (dexterityButton) {
    dexterityButton.addEventListener(
        "click",
        event => {
            rollDexterityDie();
        }
    );
}

async function rollDexterityDie() {
    if (!diceBoxReady) {
        console.warn("DiceBox is not ready yet.");
        return;
    }

    show(animationOverlay);
    setDiceTheme();

    requestAnimationFrame(async () => {
        window.dispatchEvent(new Event("resize"));

        try {
            const results = await diceBox.roll("1d20");
            const rolls = extractDiceResults(results);

            if (!rolls.length) {
                throw new Error("No dice results were returned.");
            }

            const rawRoll = rolls[0];

            state.lastRolls = rolls;

            hide(animationOverlay);

            showDexterityResult(rawRoll);
        } catch (error) {
            console.error("Dice roll failed:", error);
            hide(animationOverlay);
        }
    });
}

/*
 * =========================================================
 * SCHOOL RESULT OVERLAY
 * =========================================================
 */

const schoolResultOverlay = $("schoolResultOverlay");
const closeSchoolResultButton = $("closeSchoolResult");
const castSchoolResult = $("castSchoolResult");

function openSchoolResult(result) {
    show(schoolResultOverlay);
}

function closeSchoolResult() {
    hide(schoolResultOverlay);
}

if (closeSchoolResultButton) {
    closeSchoolResultButton.addEventListener(
        "click",
        closeSchoolResult
    );
}

if (castSchoolResult) {
    castSchoolResult.addEventListener(
        "click",
        event => {
            const total = Number(
                $("totalSum")?.textContent
            ) || 0;

            spawnScrabbleLetters(total);

            closeSchoolResult();

            spellLevelDisplay.textContent = lastSpellLevel;
            show(spellControl);
        }
    );
}

function showSchoolResults(rolls, results) {
    const highestRoll = $("highestRoll");
    const spellLevel = $("spellLevel");
    const totalSum = $("totalSum");
    const individualRolls = $("individualRolls");

    if (highestRoll) {
        highestRoll.textContent = results.highest;
    }

    if (spellLevel) {
        spellLevel.textContent = results.spellLevel;
        lastSpellLevel = results.spellLevel;
    }

    if (totalSum) {
        totalSum.textContent = results.total;
    }

    if (individualRolls) {
        individualRolls.innerHTML = "";

        rolls.forEach(value => {
            const die = document.createElement("div");

            die.className =
                value === 5 ||
                value === 6
                    ? "die high"
                    : "die";

            die.textContent = value;

            individualRolls.appendChild(die);
        });
    }

    show(schoolResultOverlay);
}

/*
 * =========================================================
 * ROLL D6 OVERLAY
 * =========================================================
 */

const rollD6Overlay = $("rollD6Overlay");
const rollD6Button = $("rollD6Button");
const cancelD6 = $("cancelD6");
const rollD6 = $("rollD6");
const rollD6Input = $("rollD6Input");

function openRollD6(result) {
    rollD6Input.value = 1;
    show(rollD6Overlay);
}

function closeRollD6() {
    hide(rollD6Overlay);
}

if (rollD6Button) {
    rollD6Button.addEventListener(
        "click",
        openRollD6
    )
}

if (cancelD6) {
    cancelD6.addEventListener(
        "click",
        closeRollD6
    );
}

if (rollD6) {
    rollD6.addEventListener(
        "click",
        event => {
            closeRollD6();
            rollSchoolDice("none");
        }
    )
}

if (castSchoolResult) {
    castSchoolResult.addEventListener(
        "click",
        event => {
            const total = Number(
                $("totalSum")?.textContent
            ) || 0;

            spawnScrabbleLetters(total);

            closeSchoolResult();
        }
    );
}

/*
 * =========================================================
 * DEXTERITY RESULT OVERLAY
 * =========================================================
 */

const dexResultOverlay = $("dexResultOverlay");
const closeDexResultButton = $("closeDexResult");

function openDexResult(result) {
    show(dexResultOverlay);
}

function closeDexResult() {
    hide(dexResultOverlay);
}

if (closeDexResultButton) {
    closeDexResultButton.addEventListener(
        "click",
        closeDexResult
    );
}

function showDexterityResult(rawRoll) {
    const rawRollDisplay = $("rawRollDisplay");
    const modifierDisplay = $("modifierDisplay");
    const dexResultDisplay = $("dexResultDisplay");

    if (rawRollDisplay) {
        rawRollDisplay.textContent = rawRoll;
    }

    if (modifierDisplay) {
        modifierDisplay.textContent = formatModifier(state.initiative);
    }

    if (dexResultDisplay) {
        dexResultDisplay.textContent = rawRoll + state.initiative;
    }

    show(dexResultOverlay);
}

/*
 * =========================================================
 * CHARACTER OVERLAY
 * =========================================================
 */

const characterOverlay = $("characterOverlay");
const characterButton = $("characterButton");
const closeCharacterButton = $("closeCharacter");

function openCharacterSettings() {
    syncCharacterInputs();
    show(characterOverlay);
}

function closeCharacterSettings() {
    hide(characterOverlay);
}

if (characterButton) {
    characterButton.addEventListener(
        "click",
        openCharacterSettings
    );
}

if (closeCharacterButton) {
    closeCharacterButton.addEventListener(
        "click",
        closeCharacterSettings
    );
}

function syncCharacterInputs() {
    const acInput = $("acInput");
    const dexInput = $("dexInput");
    const initiativeInput = $("initiativeInput");
    const maxHPInput = $("maxHPInput");

    if (acInput) {
        acInput.value = state.ac;
    }

    if (dexInput) {
        dexInput.value = state.dexterity;
    }

    if (initiativeInput) {
        initiativeInput.value =
            formatModifier(state.initiative);
    }

    if (maxHPInput) {
        maxHPInput.value = state.maxHealth;
    }

    normalizeSpellSlots();
    syncSpellSlotInputs();
    updateSpellSlotDisplay();
}

const hpCurrentDisplay = $("hpCurrentDisplay");
const hpMaxDisplay = $("hpMaxDisplay");
const maxHPInput = $("maxHPInput");

if (maxHPInput) {
    maxHPInput.addEventListener(
        "input",
        event => {
            const difference = state.maxHealth - state.currentHealth;

            let value = parseInt(event.target.value, 10);

            if (Number.isNaN(value)) {
                return;
            }

            value = Math.max(1, value);
            state.maxHealth = value;
            if (difference === 0) {
                state.currentHealth = value;
            } else {
                state.currentHealth = Math.min(state.currentHealth, state.maxHealth);
            }

            event.target.value = value;

            updateHPDisplay();
            saveState();
        }
    )
}

function clampHealth() {
    state.maxHealth = Math.max(1, Number(state.maxHealth) || 1);
    state.currentHealth = Math.max(0, Math.min(state.maxHealth, Number(state.currentHealth) || 0));
    state.temporaryHealth = Math.max(0, Number(state.temporaryHealth) || 0);
}

function updateHPDisplay() {
    clampHealth();

    if (hpCurrentDisplay) {
        hpCurrentDisplay.textContent = state.currentHealth;
    }

    if (hpMaxDisplay) {
        hpMaxDisplay.textContent = state.maxHealth;
    }

    if (tempHPDisplay) {
        if (state.temporaryHealth > 0) {
            tempHPDisplay.textContent = "+" + state.temporaryHealth;
        } else {
            tempHPDisplay.textContent = "";
        }
    }

    if (tempHPInput) {
        tempHPInput.value = state.temporaryHealth;
    }
}

const acDisplay = $("acDisplay");
const acInput = $("acInput");

if (acInput) {
    acInput.addEventListener(
        "input",
        event => {
            let value = parseInt(event.target.value, 10);

            if (Number.isNaN(value)) {
                return;
            }

            value = Math.max(1, value);
            state.ac = value;

            event.target.value = value;

            updateACDisplay();
            saveState();
        }
    )
}

function updateACDisplay() {
    const acDisplay = $("acDisplay");

    if (acDisplay) {
        acDisplay.textContent = state.ac;
    }
}

const dexInput = $("dexInput");
const initiativeDisplay = $("initiativeDisplay");

if (dexInput) {
    dexInput.addEventListener(
        "input",
        event => {
            let value = parseInt(event.target.value, 10);
            if (Number.isNaN(value)) {
                return;
            }

            value = Math.max(1, value);
            state.dexterity = value;

            event.target.value = value;

            const initiative = initiativeModifier(value);
            state.initiative = initiative;

            if (initiativeDisplay) {
                initiativeDisplay.value = formatModifier(initiative);
            }

            saveState();
        }
    )
}

for (const school of magicSchools) {
    const schoolDisplay = $(school + "Display");
    const schoolInput = $(school + "Input");

    if (schoolInput) {
        schoolInput.addEventListener(
            "input", 
            event => {
                let value = parseInt(event.target.value, 10);

                if (Number.isNaN(value)) {
                    return;
                }

                value = Math.max(1, value);

                state.schools[school] = value;
                event.target.value = value;

                updateSchoolDisplay();
                saveState();
            }
        );
    }
}

function updateSchoolDisplay() {
    for (const school of magicSchools) {
        const level = state.schools[school];

        const schoolDisplay = $(school + "Display");

        if (schoolDisplay) {
            schoolDisplay.textContent = level;
        }

        const schoolInput = $(school + "Input");

        if (schoolInput) {
            schoolInput.value = level;
        }
    }
}

/*
 * =========================================================
 * HP OVERLAY
 * =========================================================
 */

const hpManagerOverlay = $("hpManagerOverlay");
const hpManagerButton = $("hpManagerButton");
const closeHPManagerButton = $("closeHPManager");
const modalHealthDisplay = $("hpModalCurrent");
const modalMaxHealthDisplay = $("hpModalMax");

function openHPManager() {
    healthAmountInput.value = 1;
    modalHealthDisplay.textContent = state.currentHealth;
    modalMaxHealthDisplay.textContent = state.maxHealth;

    show(hpManagerOverlay);
}

function closeHPManager() {
    hide(hpManagerOverlay);
}

if (hpManagerButton) {
    hpManagerButton.addEventListener(
        "click",
        openHPManager
    );
}

if (closeHPManagerButton) {
    closeHPManagerButton.addEventListener(
        "click",
        closeHPManager
    );
}

const healthAmountInput = $("healthAmountInput");
const damageButton = $("damageHPButton");
const healButton = $("healHPButton");
const tempHPInput = $("tempHPInput");
const tempHPDisplay = $("tempHPDisplay");

if (damageButton) {
    damageButton.addEventListener(
        "click",
        event => {
            let value = parseInt(healthAmountInput.value, 10);

            if (Number.isNaN(value)) {
                return;
            }
            
            updateCurrentHealth(value * -1);
        }
    );
}

if (healButton) {
    healButton.addEventListener(
        "click",
        event => {
            let value = parseInt(healthAmountInput.value, 10);

            if (Number.isNaN(value)) {
                return;
            }

            updateCurrentHealth(value);
        }
    );
}

function updateCurrentHealth(amount) {
    if (amount < 0) {
        let damage = Math.abs(amount);

        if (state.temporaryHealth > 0) {
            const tempDamage = Math.min(state.temporaryHealth, damage);

            state.temporaryHealth -= tempDamage;
            damage -= tempDamage;
        }

        if (damage > 0) {
            state.currentHealth = clamp(state.currentHealth - damage, 0, state.maxHealth);
        }
    } else {
        state.currentHealth = clamp(state.currentHealth + amount, 0, state.maxHealth);
    }

    modalHealthDisplay.textContent = state.currentHealth;
    hpCurrentDisplay.textContent = state.currentHealth;

    if (state.temporaryHealth > 0) {
        tempHPDisplay.textContent = "+" + state.temporaryHealth;
    } else {
        tempHPDisplay.textContent = "";
    }

    if (tempHPInput) {
        tempHPInput.value = state.temporaryHealth;
    }

    saveState();
}

if (tempHPInput) {
    tempHPInput.addEventListener(
        "input",
        event => {
            let value = parseInt(event.target.value, 10);
            if (Number.isNaN(value)) {
                return;
            }

            value = Math.max(0, value);
            state.temporaryHealth = value;

            event.target.value = value;

            if (value === 0) {
                tempHPDisplay.textContent = "";
            } else {
                tempHPDisplay.textContent = "+" + value;
            }

            saveState();
        }
    )
}

/*
 * =========================================================
 * TILE COUNT OVERLAY
 * =========================================================
 */

const tileCountOverlay = $("tileCountOverlay");
const tileCountInput = $("tileCountInput");
const tileCountButton = $("getTilesButton");
const getTilesButton = $("getTiles");
const closeTileCountButton = $("cancelTiles");

function openTileCount() {
    tileCountInput.value = 1;

    document.querySelectorAll(
        "#tileSelectionGrid input[type='checkbox']"
    ).forEach(checkbox => {
        checkbox.checked = false;
    });

    show(tileCountOverlay);
}

function closeTileCount() {
    hide(tileCountOverlay);
}

if (tileCountButton) {
    tileCountButton.addEventListener(
        "click",
        openTileCount
    );
}

if (closeTileCountButton) {
    closeTileCountButton.addEventListener(
        "click",
        closeTileCount
    );
}

if (getTilesButton) {
    getTilesButton.addEventListener(
        "click", 
        event => {
            const amount = Math.max(
                0,
                Math.floor(
                    Number(tileCountInput.value) || 0
                )
            );

            const selectedTiles = Array.from(
                document.querySelectorAll(
                    "#tileSelectionGrid input[type='checkbox']:checked"
                )
            ).map(
                checkbox => checkbox.value
            );

            if (selectedTiles.length === 0) {
                spawnScrabbleLetters(amount);
            } else {
                spawnSelectedScrabbleLetters(
                    selectedTiles,
                    amount
                );
            }

            hide(tileCountOverlay);
        }
    );
}

/*
 * =========================================================
 * OVERLAY BEHAVIOUR
 * =========================================================
 */

const closableOverlays = [
    characterOverlay,
    hpManagerOverlay,
    schoolResultOverlay,
    tileCountOverlay,
    dexResultOverlay
];

closableOverlays.forEach(
    overlay => {
        if (!overlay) {
            return;
        }

        overlay.addEventListener(
            "click",
            event => {
                if (event.target === overlay) {
                    hide(overlay);
                }
            }
        );
    }
);

document.addEventListener(
    "keydown",
    event => {
        if (event.key !== "Escape") {
            return;
        }

        closableOverlays.forEach(
            overlay => {
                if (overlay) {
                    hide(overlay);
                }
            }
        );
    }
);

loadState();

normalizeSpellSlots();
syncSpellSlotInputs();
updateSpellSlotDisplay();

updateHPDisplay();
updateACDisplay();
updateSchoolDisplay();

if (initiativeDisplay) {
    initiativeDisplay.value =
        formatModifier(state.initiative);
}