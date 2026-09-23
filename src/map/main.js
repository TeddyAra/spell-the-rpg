import { $, show, hide, clamp } from "../dom.js";
import { Room, newRoomCode, normalizeRoomCode, loadSavedGame } from "./network.js";
import {
    initMapView,
    renderTokens,
    moveToken,
    zoomBy,
    centerOn,
    setGridVisible,
    isGridVisible,
    setGridSize,
    setTool,
    setDrawColor,
    showDMMap,
    renderFog,
    showBlocks,
    clearMap,
    renderEnemies,
    renderDrawings,
    addStroke,
    removeStrokes,
    renderDoors,
    setDoorsVisible,
    areDoorsVisible
} from "./mapView.js";
import { DRAW_COLORS, strokeTouches } from "./drawings.js";
import { renderOverview } from "./overview.js";
import { readCharacterSummary } from "./summary.js";
import { loadStoredMap, importMapFile } from "./mapStore.js";
import { Fog } from "./fog.js";
import { setLibraryAvailable } from "./notes.js";
import { STATE_STORAGE_KEY, TILE_BOARD_STORAGE_KEY } from "../state.js";

const PLAYER_ID_KEY = "spellMap:playerId";
const PLAYER_NAME_KEY = "spellMap:name";
const LAST_ROOM_KEY = "spellMap:lastRoom";
const SHOW_DOORS_KEY = "spellMap:showDoors";

const DEFAULT_ENEMY_HP = 10;

const lobbyOverlay = $("lobbyOverlay");
const nameInput = $("playerNameInput");
const roomCodeInput = $("roomCodeInput");
const lobbyMessage = $("lobbyMessage");
const mapFileInput = $("mapFileInput");

let room = null;
let isDM = false;

// Players' views jump to their own token once, when they join
let centeredOnMyToken = false;

// DM only: the map (from their own file) and which squares players can see
let dmMap = null;
let fog = null;

// Players only: what the DM shares about enemies and the turn order
let shownEnemies = {};
let sharedOrder = { order: [], initiative: {} };

function storageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Not remembered, but everything still works
    }
}

/* A stable id per browser, so your token stays yours when you reconnect. */
function playerId() {
    let id = storageGet(PLAYER_ID_KEY);

    if (!id) {
        id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        storageSet(PLAYER_ID_KEY, id);
    }

    return id;
}

const myId = playerId();

/*
 * =========================================================
 * MAP + INITIATIVE LIST
 * =========================================================
 */

// List entries are keyed "player:<id>" or "enemy:<id>"
function splitKey(key) {
    const colon = key.indexOf(":");

    return [key.slice(0, colon), key.slice(colon + 1)];
}

function enemyName(enemy) {
    return enemy.name || `Enemy ${enemy.number}`;
}

/* Clicking a name in the list shows that token on the map. */
function selectEntry(key) {
    const [kind, id] = splitKey(key);
    const position = kind === "player"
        ? room?.game.players[id]?.token
        : (isDM ? room?.game.enemies : shownEnemies)?.[id];

    if (position) {
        centerOn(position.x, position.y);
    }
}

/* DM: the turn order, with every player and enemy in it exactly once (newcomers at the end). */
function turnOrder() {
    const game = room.game;
    const keys = [
        ...Object.keys(game.players).map(id => `player:${id}`),
        ...Object.keys(game.enemies ?? {}).map(id => `enemy:${id}`)
    ];
    const order = (game.turnOrder ?? []).filter(key => keys.includes(key));

    for (const key of keys) {
        if (!order.includes(key)) {
            order.push(key);
        }
    }

    game.turnOrder = order;

    return order;
}

function listEntry(key, players, enemies, initiative) {
    const [kind, id] = splitKey(key);
    const base = { key, kind, id, initiative: initiative[key] ?? null };

    if (kind === "player") {
        const player = players[id];

        return { ...base, name: player.name, online: player.online, summary: player.summary };
    }

    const enemy = enemies[id];

    return { ...base, name: enemyName(enemy), hp: enemy.hp, maxHp: enemy.maxHp };
}

function listEntries() {
    if (!room) {
        return [];
    }

    const players = room.game.players;

    if (isDM) {
        return turnOrder().map(key => listEntry(key, players, room.game.enemies ?? {}, room.game.initiative ?? {}));
    }

    // Players: the DM's order, plus anyone who joined since
    const keys = sharedOrder.order.filter(key => {
        const [kind, id] = splitKey(key);

        return kind === "player" ? players[id] : shownEnemies[id];
    });

    for (const id of Object.keys(players)) {
        if (!keys.includes(`player:${id}`)) {
            keys.push(`player:${id}`);
        }
    }

    return keys.map(key => listEntry(key, players, shownEnemies, sharedOrder.initiative));
}

function renderList() {
    renderOverview(listEntries(), myId, isDM, listHandlers);
}

function renderGame(game) {
    setGridSize(game.gridSize);
    renderTokens(game.players, myId);
    renderList();

    const me = game.players[myId];

    if (!isDM && me && !centeredOnMyToken) {
        centeredOnMyToken = true;
        centerOn(me.token.x, me.token.y);
    }
}

$("zoomIn").addEventListener("click", () => zoomBy(1.25));
$("zoomOut").addEventListener("click", () => zoomBy(0.8));

// On/off buttons light up while they're on
$("toggleGrid").addEventListener("click", () => {
    setGridVisible(!isGridVisible());
    $("toggleGrid").classList.toggle("primary", isGridVisible());
});


$("togglePanel").addEventListener("click", () => {
    $("togglePanel").classList.toggle("primary", document.body.classList.toggle("panel-open"));
});

$("togglePanel").classList.toggle("primary", document.body.classList.contains("panel-open"));

$("toggleDoors").addEventListener("click", () => {
    const visible = !areDoorsVisible();

    setDoorsVisible(visible);
    storageSet(SHOW_DOORS_KEY, visible ? "1" : "0");
    $("toggleDoors").classList.toggle("primary", visible);
});

setDoorsVisible(storageGet(SHOW_DOORS_KEY) === "1");
$("toggleDoors").classList.toggle("primary", areDoorsVisible());

// Players: your character sheet (in another tab) changed or your letter tiles moved, so tell the DM
window.addEventListener("storage", event => {
    const relevant = event.key === STATE_STORAGE_KEY || event.key === TILE_BOARD_STORAGE_KEY;

    if (relevant && room && !isDM) {
        room.updateSummary(readCharacterSummary());
    }
});

/*
 * =========================================================
 * DM TOOLS
 * =========================================================
 */

const HINTS = {
    none: "Hold Shift to snap to the grid",
    ruler: "Drag from one square to another to measure · 1 square = 5 ft",
    reveal: "Drag over squares to show them to the players · Right-drag moves the map",
    hide: "Drag over squares to hide them again · Right-drag moves the map",
    enemy: "Click a square to place an enemy · Hover an enemy for × to remove it",
    draw: "Drag to draw · Everyone sees drawings, even over hidden squares",
    erase: "Drag over lines or doors to erase them",
    door: "Drag along a grid line to add a door (hidden from players) · Hover a door and click the eye to show or hide it"
};

let activeTool = null;
let drawColor = DRAW_COLORS[0];

function selectTool(tool) {
    activeTool = tool;
    setTool(tool);

    // The eraser lives in the Draw options, so Draw stays lit while erasing
    const drawing = tool === "draw" || tool === "erase";

    for (const button of document.querySelectorAll("#mapControls [data-tool]")) {
        button.classList.toggle("primary", button.dataset.tool === tool || (button.dataset.tool === "draw" && drawing));
    }

    for (const swatch of document.querySelectorAll("#colorSwatches button")) {
        swatch.classList.toggle("selected", tool === "erase" ? swatch.dataset.eraser === "1" : swatch.dataset.color === drawColor);
    }

    $("drawOptions").classList.toggle("hidden", !drawing);

    // Doors need to be visible to add or erase them
    if ((tool === "door" || tool === "erase") && !areDoorsVisible()) {
        $("toggleDoors").click();
    }
    $("mapHint").textContent = HINTS[tool ?? "none"];
}

// Colour swatches for the draw tool, and the eraser after them
for (const color of DRAW_COLORS) {
    const swatch = document.createElement("button");

    swatch.className = "color-swatch";
    swatch.dataset.color = color;
    swatch.style.background = color;
    swatch.title = "Line colour";
    swatch.setAttribute("aria-label", `Line colour ${color}`);

    swatch.addEventListener("click", () => {
        drawColor = color;
        setDrawColor(color);
        selectTool("draw");
    });

    $("colorSwatches").appendChild(swatch);
}

const eraser = document.createElement("button");

eraser.className = "color-swatch eraser-swatch";
eraser.dataset.eraser = "1";
eraser.title = "Eraser: drag over lines or doors to erase them";
eraser.setAttribute("aria-label", "Eraser");
eraser.addEventListener("click", () => selectTool("erase"));
$("colorSwatches").appendChild(eraser);

for (const button of document.querySelectorAll("#mapControls [data-tool]")) {
    button.addEventListener("click", () => {
        // Clicking the active tool again goes back to just moving around (Draw also ends erasing)
        const active = button.dataset.tool === activeTool || (button.dataset.tool === "draw" && activeTool === "erase");

        selectTool(active ? null : button.dataset.tool);
    });
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && room) {
        selectTool(null);
    }
});

/* The pictures for players are made in the background (see fog.js); this just updates what the DM sees. */
function areaDrawn(start, end, tool) {
    if (!fog || !room) {
        return;
    }

    fog.setArea(start.x, start.y, end.x, end.y, tool === "reveal");
    renderFog(fog);

    room.game.revealed = fog.revealedList();
    room.save();

    // Enemies and doors next to squares that were just revealed (or hidden) appear (or disappear) for players
    sendShared();
}

/*
 * =========================================================
 * DM: WHAT PLAYERS GET TO SEE
 * Only enemies standing on revealed squares (without their health), the turn
 * order of what they can see, and doors next to revealed squares.
 * =========================================================
 */

function isRevealedSquare(x, y) {
    return Boolean(fog) && x >= 0 && y >= 0 && x < fog.columns && y < fog.rows && fog.isRevealed(x, y);
}

function visibleEnemies() {
    const enemies = room?.game.enemies ?? {};
    const size = dmMap.gridSize;

    return Object.fromEntries(
        Object.entries(enemies)
            .filter(([, enemy]) => isRevealedSquare(Math.floor(enemy.x / size), Math.floor(enemy.y / size)))
            .map(([id, enemy]) => [id, { x: enemy.x, y: enemy.y, number: enemy.number, name: enemyName(enemy) }])
    );
}

function dmDoors() {
    return room?.game.doors ?? [];
}

/* A door shows for players when the DM has made it visible and a square next to it is revealed. */
function doorVisible(door) {
    if (!door.visible) {
        return false;
    }

    const middleX = (door.a.x + door.b.x) / 2;
    const middleY = (door.a.y + door.b.y) / 2;
    const length = Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y) || 1;

    // Half a square to either side of the door
    const sideX = -(door.b.y - door.a.y) / length / 2;
    const sideY = (door.b.x - door.a.x) / length / 2;

    const one = isRevealedSquare(Math.floor(middleX + sideX), Math.floor(middleY + sideY));
    const other = isRevealedSquare(Math.floor(middleX - sideX), Math.floor(middleY - sideY));

    return one || other;
}

function sendShared(connection = null) {
    if (!room || !isDM) {
        return;
    }

    const enemies = visibleEnemies();
    const initiative = room.game.initiative ?? {};
    const order = turnOrder().filter(key => {
        const [kind, id] = splitKey(key);

        return kind === "player" || enemies[id];
    });

    room.sendToPlayers({ type: "enemies", enemies }, connection);
    room.sendToPlayers({
        type: "order",
        order,
        initiative: Object.fromEntries(order.filter(key => key in initiative).map(key => [key, initiative[key]]))
    }, connection);
    room.sendToPlayers({
        type: "doors",
        doors: dmDoors().filter(doorVisible).map(({ a, b }) => ({ a, b }))
    }, connection);
}

function doorsChanged() {
    room.save();
    renderDoors(dmDoors());
    sendShared();
}

function doorDrawn(a, b) {
    if (room && isDM) {
        // New doors start hidden from players
        room.game.doors.push({ id: newId(), a, b, visible: false });
        doorsChanged();
    }
}

function doorClicked(id) {
    const door = room?.game.doors.find(other => other.id === id);

    if (door) {
        door.visible = !door.visible;
        doorsChanged();
    }
}

/*
 * =========================================================
 * DM: THE INITIATIVE LIST
 * =========================================================
 */

function orderChanged() {
    room.save();
    renderList();
    sendShared();
}

const listHandlers = {
    select: selectEntry,

    reorder(key, targetKey, after) {
        const order = turnOrder().filter(other => other !== key);

        order.splice(order.indexOf(targetKey) + (after ? 1 : 0), 0, key);
        room.game.turnOrder = order;
        orderChanged();
    },

    setInitiative(key, value) {
        room.game.initiative ??= {};

        if (value === null) {
            delete room.game.initiative[key];
        } else {
            room.game.initiative[key] = value;
        }

        orderChanged();
    },

    renameEnemy(id, name) {
        const enemy = room.game.enemies[id];

        if (enemy) {
            enemy.name = name.slice(0, 30);
            enemiesChanged();
        }
    },

    // Enemy health is the DM's secret: saved and shown here, never sent to players
    enemyHealth(id, change) {
        const enemy = room.game.enemies[id];

        if (enemy) {
            enemy.hp = clamp(enemy.hp + change, 0, enemy.maxHp);
            room.save();
            renderList();
        }
    },

    // Like the character sheet: an enemy at full health stays at full health
    enemyMaxHealth(id, value) {
        const enemy = room.game.enemies[id];

        if (enemy) {
            const wasAtFullHealth = enemy.hp === enemy.maxHp;

            enemy.maxHp = value;
            enemy.hp = wasAtFullHealth ? value : Math.min(enemy.hp, value);
            room.save();
            renderList();
        }
    }
};

/* Highest initiative first; entries without a number keep their place at the end. */
$("sortInitiative").addEventListener("click", () => {
    if (!room || !isDM) {
        return;
    }

    const initiative = room.game.initiative ?? {};
    const order = turnOrder();
    const withNumber = order.filter(key => initiative[key] !== undefined).sort((a, b) => initiative[b] - initiative[a]);

    room.game.turnOrder = [...withNumber, ...order.filter(key => initiative[key] === undefined)];
    orderChanged();
});

function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function enemiesChanged() {
    renderEnemies(room.game.enemies);
    room.save();
    renderList();
    sendShared();
}

function enemyPlaced(x, y) {
    if (!room) {
        return;
    }

    const enemies = room.game.enemies;
    const number = Math.max(0, ...Object.values(enemies).map(enemy => enemy.number)) + 1;

    enemies[newId()] = { x, y, number, name: `Enemy ${number}`, hp: DEFAULT_ENEMY_HP, maxHp: DEFAULT_ENEMY_HP };
    enemiesChanged();
}

function enemyMoved(id, x, y, done) {
    const enemy = room?.game.enemies[id];

    if (!enemy) {
        return;
    }

    enemy.x = x;
    enemy.y = y;
    sendShared();

    if (done) {
        room.save();
    }
}

function enemyRemoved(id) {
    if (room?.game.enemies[id]) {
        delete room.game.enemies[id];
        enemiesChanged();
    }
}

/* Drawings: freehand lines everyone sees (see drawings.js). */
function strokeDrawn(line) {
    if (!room) {
        return;
    }

    const stroke = { id: newId(), ...line };

    room.game.drawings.push(stroke);
    addStroke(stroke);
    room.sendToPlayers({ type: "stroke", stroke });
    room.save();
}

/* The eraser removes drawings and doors it touches. */
function erased(x, y, radius) {
    if (!room) {
        return;
    }

    const size = dmMap.gridSize;
    const doorsHit = room.game.doors.filter(door =>
        strokeTouches({ width: size * 0.15, points: [[door.a.x * size, door.a.y * size], [door.b.x * size, door.b.y * size]] }, x, y, radius)
    );

    if (doorsHit.length) {
        room.game.doors = room.game.doors.filter(door => !doorsHit.includes(door));
        doorsChanged();
    }

    const hit = room.game.drawings.filter(stroke => strokeTouches(stroke, x, y, radius)).map(stroke => stroke.id);

    if (hit.length === 0) {
        return;
    }

    room.game.drawings = room.game.drawings.filter(stroke => !hit.includes(stroke.id));
    removeStrokes(hit);
    room.sendToPlayers({ type: "erase", ids: hit });
    room.save();
}

$("clearDrawings").addEventListener("click", () => {
    if (!room || room.game.drawings.length === 0) {
        return;
    }

    room.game.drawings = [];
    renderDrawings([]);
    room.sendToPlayers({ type: "drawings", drawings: [] });
    room.save();
});

/* Players: the DM's enemies, turn order, doors and drawings. */
function dmMessage(message) {
    switch (message.type) {
        case "enemies":
            shownEnemies = message.enemies ?? {};
            renderEnemies(shownEnemies);
            renderList();
            break;

        case "order":
            sharedOrder = { order: message.order ?? [], initiative: message.initiative ?? {} };
            renderList();
            break;

        case "doors":
            renderDoors(message.doors ?? []);
            break;

        case "drawings":
            renderDrawings(message.drawings ?? []);
            break;

        case "stroke":
            addStroke(message.stroke);
            break;

        case "erase":
            removeStrokes(message.ids ?? []);
            break;
    }
}

/* Shows the DM's map and starts making pictures of what's revealed. */
function startDMMap() {
    showDMMap(dmMap);

    const game = room.game;

    // Revealed squares belong to one map
    if (game.mapName !== dmMap.name) {
        game.mapName = dmMap.name;
        game.revealed = [];
    }

    game.gridSize = dmMap.gridSize;
    game.enemies ??= {};
    game.drawings ??= [];
    game.turnOrder ??= [];
    game.initiative ??= {};
    game.doors ??= [];
    delete game.secretDoors; // from when doors came from the map file

    // Enemies saved before they had names and health
    for (const enemy of Object.values(game.enemies)) {
        enemy.name ??= `Enemy ${enemy.number}`;
        enemy.maxHp ??= DEFAULT_ENEMY_HP;
        enemy.hp ??= enemy.maxHp;
    }

    room.save();

    renderEnemies(game.enemies);
    renderDrawings(game.drawings);
    renderDoors(dmDoors());
    renderList();

    // Each picture goes to everyone as soon as it's ready, one message each (they can be a few hundred KB)
    fog = new Fog(dmMap, game.revealed ?? [], picture => room?.sendBlocks([picture]));
    renderFog(fog);

    show($("dmTools"));
    show($("sortInitiative"));
    setLibraryAvailable(true);
    selectTool(null);
}

/*
 * New players start next to each other near the middle of what's been revealed,
 * 4 per row. (The middle of the whole map would give its size away.)
 */
function spawnPoint(count) {
    const size = dmMap.gridSize;
    const columns = Math.ceil(dmMap.width / size);
    const revealed = fog?.revealedList() ?? room?.game.revealed ?? [];

    let cellX = 2;
    let cellY = 2;

    if (revealed.length) {
        cellX = Math.round(revealed.reduce((sum, index) => sum + (index % columns), 0) / revealed.length);
        cellY = Math.round(revealed.reduce((sum, index) => sum + Math.floor(index / columns), 0) / revealed.length);
    }

    return {
        x: (cellX + (count % 4) - 1) * size + size / 2,
        y: (cellY + Math.floor(count / 4)) * size + size / 2
    };
}

initMapView({
    tokenMoved(id, x, y) {
        room?.moveToken(id, x, y);
    },
    areaDrawn,
    enemyPlaced,
    enemyMoved,
    enemyRemoved,
    strokeDrawn,
    erased,
    doorDrawn,
    doorClicked
});

// The map view has applied the saved grid setting by now
$("toggleGrid").classList.toggle("primary", isGridVisible());

/*
 * =========================================================
 * ROOM / LOBBY
 * =========================================================
 */

function setStatus(text, kind) {
    const status = $("roomStatus");

    status.textContent = text;
    status.dataset.kind = kind;

    if (kind === "error" && room?.closed) {
        // Couldn't open the room at all: back to the lobby
        leaveRoom();
        lobbyMessage.textContent = text;
    }
}

function enterRoom(code, isHost) {
    const name = nameInput.value.trim().slice(0, 30) || "Player";

    storageSet(PLAYER_NAME_KEY, name);
    storageSet(LAST_ROOM_KEY, JSON.stringify({ code, isHost }));

    lobbyMessage.textContent = "";
    hide(lobbyOverlay);

    $("roomCode").textContent = code;
    show($("roomBar"));

    centeredOnMyToken = false;
    isDM = isHost; // set before the room exists: it renders straight away

    room = new Room({
        code,
        isHost,
        // The DM has no character; players share theirs
        me: { id: myId, name, summary: isHost ? null : readCharacterSummary() },
        spawn: spawnPoint,

        events: {
            status: setStatus,
            game: renderGame,
            move: moveToken,

            // DM: a player (re)joined, so send them everything that's revealed.
            // Pictures still being made go to everyone when they're done.
            playerJoined: connection => {
                for (const picture of fog?.currentPictures() ?? []) {
                    room.sendBlocks([picture], connection);
                }

                sendShared(connection);
                room.sendToPlayers({ type: "drawings", drawings: room.game.drawings }, connection);
            },

            // Player: pictures of revealed squares, and the DM's enemies, turn order, doors and drawings
            blocks: showBlocks,
            blocksReset: forgetDMState,
            dmMessage
        }
    });

    if (isHost) {
        startDMMap();
    }
}

// Set when "Host" was clicked before a map was chosen: host as soon as it's loaded
let pendingHostCode = null;

/* The DM needs their map file before hosting. */
function hostGame(code) {
    if (!dmMap) {
        pendingHostCode = code;
        mapFileInput.click();

        return;
    }

    enterRoom(code, true);
}

mapFileInput.addEventListener("change", async () => {
    const file = mapFileInput.files[0];

    mapFileInput.value = "";

    if (!file) {
        return;
    }

    lobbyMessage.textContent = "Loading the map…";

    try {
        dmMap = await importMapFile(file);
        lobbyMessage.textContent = "";
        showMapName();

        if (pendingHostCode) {
            enterRoom(pendingHostCode, true);
        }
    } catch (error) {
        lobbyMessage.textContent = error.message;
    } finally {
        pendingHostCode = null;
    }
});

$("chooseMapButton").addEventListener("click", () => {
    pendingHostCode = null;
    mapFileInput.click();
});

/* The map button shows which map is loaded (click it to pick another). */
function showMapName() {
    const button = $("chooseMapButton");

    button.textContent = dmMap ? `Map: ${dmMap.name}` : "Choose map file";
    button.title = dmMap
        ? `${dmMap.name}, ${Math.round(dmMap.width / dmMap.gridSize)} × ${Math.round(dmMap.height / dmMap.gridSize)} squares. Click to choose another map.`
        : "Choose the map (.dd2vtt or .uvtt file)";
}

$("hostButton").addEventListener("click", () => hostGame(newRoomCode()));

$("rehostButton").addEventListener("click", event => {
    hostGame(event.currentTarget.dataset.code);
});

$("joinForm").addEventListener("submit", event => {
    event.preventDefault();

    const code = normalizeRoomCode(roomCodeInput.value);

    if (!code) {
        lobbyMessage.textContent = "Enter the room code the host gave you.";

        return;
    }

    enterRoom(code, false);
});

$("copyRoomCode").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText($("roomCode").textContent);
        $("copyRoomCode").textContent = "Copied";
    } catch {
        $("copyRoomCode").textContent = "Copy failed";
    }

    setTimeout(() => {
        $("copyRoomCode").textContent = "Copy";
    }, 1500);
});

/* Players: (re)joining, so a fresh copy of the map, enemies and order follows. */
function forgetDMState() {
    clearMap();
    shownEnemies = {};
    sharedOrder = { order: [], initiative: {} };
}

function leaveRoom() {
    room?.leave();
    room = null;
    fog?.destroy();
    fog = null;
    isDM = false;

    forgetDMState();
    selectTool(null);
    hide($("dmTools"));
    hide($("sortInitiative"));
    setLibraryAvailable(false);

    renderGame({ players: {} });
    hide($("roomBar"));
    showLobby();
}

$("leaveRoom").addEventListener("click", leaveRoom);

function showLobby() {
    nameInput.value = storageGet(PLAYER_NAME_KEY) ?? "";

    let lastRoom = null;

    try {
        lastRoom = JSON.parse(storageGet(LAST_ROOM_KEY));
    } catch {
        // ignore
    }

    // Offer to host your last room again (with its token positions and revealed squares)
    const rehost = $("rehostButton");

    if (lastRoom?.isHost && loadSavedGame(lastRoom.code)) {
        rehost.dataset.code = lastRoom.code;
        rehost.textContent = `Host ${lastRoom.code} again`;
        show(rehost);
    } else {
        hide(rehost);
    }

    roomCodeInput.value = lastRoom && !lastRoom.isHost ? lastRoom.code : "";

    showMapName();
    show(lobbyOverlay);
    nameInput.focus();
}

loadStoredMap().then(map => {
    dmMap = map;
    showMapName();
});

showLobby();
