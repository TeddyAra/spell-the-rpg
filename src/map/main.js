import { $, show, hide } from "../dom.js";
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
    removeStrokes
} from "./mapView.js";
import { DRAW_COLORS, strokeTouches } from "./drawings.js";
import { renderOverview } from "./overview.js";
import { readCharacterSummary } from "./summary.js";
import { loadStoredMap, importMapFile } from "./mapStore.js";
import { Fog } from "./fog.js";
import { STATE_STORAGE_KEY, TILE_BOARD_STORAGE_KEY } from "../state.js";

const PLAYER_ID_KEY = "spellMap:playerId";
const PLAYER_NAME_KEY = "spellMap:name";
const LAST_ROOM_KEY = "spellMap:lastRoom";

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
 * MAP + OVERVIEW
 * =========================================================
 */

function selectPlayer(id) {
    const player = room?.game.players[id];

    if (player) {
        centerOn(player.token.x, player.token.y);
    }
}

function renderGame(game) {
    setGridSize(game.gridSize);
    renderTokens(game.players, myId);
    renderOverview(game.players, myId, selectPlayer, isDM);

    const me = game.players[myId];

    if (!isDM && me && !centeredOnMyToken) {
        centeredOnMyToken = true;
        centerOn(me.token.x, me.token.y);
    }
}

$("zoomIn").addEventListener("click", () => zoomBy(1.25));
$("zoomOut").addEventListener("click", () => zoomBy(0.8));

$("toggleGrid").addEventListener("click", () => setGridVisible(!isGridVisible()));

$("togglePanel").addEventListener("click", () => {
    const open = document.body.classList.toggle("panel-open");

    $("togglePanel").textContent = open ? "Hide players" : "Players";
});

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
    reveal: "Drag over squares to show them to the players · Right-drag moves the map",
    hide: "Drag over squares to hide them again · Right-drag moves the map",
    enemy: "Click a square to place an enemy · Hover an enemy for × to remove it",
    draw: "Drag to draw · Everyone sees drawings, even over hidden squares",
    erase: "Drag over lines to erase them"
};

let activeTool = null;

function selectTool(tool) {
    activeTool = tool;
    setTool(tool);

    for (const button of document.querySelectorAll("#dmTools [data-tool]")) {
        button.classList.toggle("primary", button.dataset.tool === tool);
    }

    $("drawOptions").classList.toggle("hidden", tool !== "draw" && tool !== "erase");
    $("mapHint").textContent = HINTS[tool ?? "none"];
}

// Colour swatches for the draw tool
for (const color of DRAW_COLORS) {
    const swatch = document.createElement("button");

    swatch.className = "color-swatch";
    swatch.style.background = color;
    swatch.title = "Line colour";
    swatch.setAttribute("aria-label", `Line colour ${color}`);

    swatch.addEventListener("click", () => {
        setDrawColor(color);

        for (const other of document.querySelectorAll(".color-swatch")) {
            other.classList.toggle("selected", other === swatch);
        }

        selectTool("draw");
    });

    $("colorSwatches").appendChild(swatch);
}

document.querySelector(".color-swatch").classList.add("selected");

for (const button of document.querySelectorAll("#dmTools [data-tool]")) {
    button.addEventListener("click", () => {
        // Clicking the active tool again goes back to just moving around
        selectTool(button.dataset.tool === activeTool ? null : button.dataset.tool);
    });
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && isDM) {
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

    // Enemies in squares that were just revealed (or hidden) appear (or disappear) for players
    sendEnemies();
}

/*
 * Enemies: { [id]: { x, y, number } } in the DM's game. Players only get the ones
 * standing on revealed squares, so the enemies in a hidden room stay a surprise.
 */
function visibleEnemies() {
    const enemies = room?.game.enemies ?? {};

    return Object.fromEntries(
        Object.entries(enemies).filter(([, enemy]) =>
            fog?.isRevealed(Math.floor(enemy.x / dmMap.gridSize), Math.floor(enemy.y / dmMap.gridSize))
        )
    );
}

function sendEnemies(connection = null) {
    room?.sendToPlayers({ type: "enemies", enemies: visibleEnemies() }, connection);
}

function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function enemiesChanged() {
    renderEnemies(room.game.enemies);
    sendEnemies();
    room.save();
}

function enemyPlaced(x, y) {
    if (!room) {
        return;
    }

    const enemies = room.game.enemies;
    const number = Math.max(0, ...Object.values(enemies).map(enemy => enemy.number)) + 1;

    enemies[newId()] = { x, y, number };
    enemiesChanged();
}

function enemyMoved(id, x, y, done) {
    const enemy = room?.game.enemies[id];

    if (!enemy) {
        return;
    }

    enemy.x = x;
    enemy.y = y;
    sendEnemies();

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

function erased(x, y, radius) {
    if (!room) {
        return;
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

/* Players: the DM's enemies and drawings. */
function dmMessage(message) {
    switch (message.type) {
        case "enemies":
            renderEnemies(message.enemies ?? {});
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
    room.save();

    renderEnemies(game.enemies);
    renderDrawings(game.drawings);

    // Each picture goes to everyone as soon as it's ready, one message each (they can be a few hundred KB)
    fog = new Fog(dmMap, game.revealed ?? [], picture => room?.sendBlocks([picture]));
    renderFog(fog);

    show($("dmTools"));
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
    erased
});

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

                sendEnemies(connection);
                room.sendToPlayers({ type: "drawings", drawings: room.game.drawings }, connection);
            },

            // Player: pictures of revealed squares, and the DM's enemies and drawings
            blocks: showBlocks,
            blocksReset: clearMap,
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

function leaveRoom() {
    room?.leave();
    room = null;
    fog?.destroy();
    fog = null;
    isDM = false;

    clearMap();
    selectTool(null);
    hide($("dmTools"));

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
