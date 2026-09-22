import { $, clamp, element } from "../dom.js";
import { pathData } from "./drawings.js";
import personIcon from "../../imgs/person.png";
import enemyIcon from "../../imgs/enemy.png";

/*
 * The shared map. Map coordinates are pixels of the full-resolution map.
 *
 * The DM sees the whole map with hidden squares dimmed, and has tools to
 * reveal / hide squares, place enemies, and draw / erase lines. Players only
 * see the pictures of revealed squares the DM sends them (see fog.js); they
 * don't know how big the map is.
 *
 * Dragging moves the view (right or middle drag always does), dragging a token
 * moves it, and holding Shift snaps a token to the middle of a grid square.
 */

const MAX_ZOOM = 2;       // 1 = one map pixel per screen pixel
const CENTER_ZOOM = 0.5;  // zoom used when jumping to a token
const PLAYER_MIN_ZOOM = 0.1;
const MOVE_SEND_INTERVAL = 50; // ms between token updates sent while dragging

// Drawn lines and the eraser keep the same size on screen at any zoom
const STROKE_SCREEN_WIDTH = 5;
const ERASER_SCREEN_RADIUS = 14;
const STROKE_POINT_SPACING = 3; // screen pixels between recorded points

const TOKEN_COLORS = ["#9d7cff", "#34baeb", "#e0a526", "#4fbf73", "#a3b83a", "#e57bd0", "#5ec4b6", "#f08a4b"];

const SVG = "http://www.w3.org/2000/svg";

const viewport = $("mapViewport");
const world = $("mapWorld");
const mapLayer = $("mapLayer");
const fogCanvas = $("fogCanvas");
const drawLayer = $("drawLayer");
const selectionBox = $("selectionBox");
const tokenLayer = $("tokenLayer");

let view = { x: 0, y: 0, scale: 0.5 };
let minZoom = PLAYER_MIN_ZOOM;

// Known to the DM only; players don't know the map's size
let mapSize = null;
let gridSize = 128;

// DM tools: "reveal" | "hide" | "enemy" | "draw" | "erase" | null (just move around)
let tool = null;
let drawColor = "#ffffff";
let canEditEnemies = false;

const tokens = new Map();  // "player:<id>" / "enemy:<id>" → token element
const blocks = new Map();  // player: block key → { element, url, version }
const strokes = new Map(); // stroke id → <path>

let callbacks = {
    tokenMoved() {},     // (id, x, y)                player token dragged
    enemyMoved() {},     // (id, x, y, done)          DM dragged an enemy
    enemyPlaced() {},    // (x, y)                    DM clicked with the enemy tool
    enemyRemoved() {},   // (id)                      DM clicked an enemy's ×
    areaDrawn() {},      // (start, end, tool)        DM drew a reveal / hide box (grid squares)
    strokeDrawn() {},    // ({ color, width, points }) DM finished a line
    erased() {}          // (x, y, radius)            DM dragged the eraser here
};

/*
 * =========================================================
 * VIEW (PAN / ZOOM)
 * =========================================================
 */

function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    world.style.setProperty("--zoom", view.scale);
}

function fitScale() {
    return Math.min(viewport.clientWidth / mapSize.width, viewport.clientHeight / mapSize.height);
}

/* Zooms by `factor`, keeping the map point under (screenX, screenY) in place. */
function zoomAt(factor, screenX, screenY) {
    const scale = clamp(view.scale * factor, minZoom, MAX_ZOOM);
    const mapX = (screenX - view.x) / view.scale;
    const mapY = (screenY - view.y) / view.scale;

    view = { scale, x: screenX - mapX * scale, y: screenY - mapY * scale };
    applyView();
}

export function zoomBy(factor) {
    zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
}

/* Shows the whole map (DM only). */
function fitMap() {
    const scale = fitScale() * 0.95;

    view = {
        scale,
        x: (viewport.clientWidth - mapSize.width * scale) / 2,
        y: (viewport.clientHeight - mapSize.height * scale) / 2
    };
    applyView();
}

/* Smoothly moves the view so the map point (x, y) is in the middle. */
export function centerOn(x, y) {
    const scale = Math.max(view.scale, CENTER_ZOOM);

    view = { scale, x: viewport.clientWidth / 2 - x * scale, y: viewport.clientHeight / 2 - y * scale };

    world.classList.add("animating");
    applyView();
    setTimeout(() => world.classList.remove("animating"), 300);
}

/* Converts a point on screen to map coordinates. */
function toMap(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();

    return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale
    };
}

viewport.addEventListener("wheel", event => {
    event.preventDefault();

    const rect = viewport.getBoundingClientRect();

    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });

// Right-drag pans, so no context menu on the map
viewport.addEventListener("contextmenu", event => event.preventDefault());

/*
 * =========================================================
 * POINTER INPUT
 * pan, pinch-zoom, dragging tokens, and the DM's tools
 * =========================================================
 */

const pointers = new Map(); // pointerId → { x, y }
let gesture = null;         // { kind: "pan" | "pinch" | "token" | "area" | "stroke" | "erase", ... }

function snapToGrid(value) {
    return Math.floor(value / gridSize) * gridSize + gridSize / 2;
}

function cellAt(point) {
    return { x: Math.floor(point.x / gridSize), y: Math.floor(point.y / gridSize) };
}

function startPan(pointer) {
    gesture = { kind: "pan", startX: pointer.x, startY: pointer.y, viewX: view.x, viewY: view.y };
}

function startPinch() {
    const [a, b] = [...pointers.values()];

    gesture = {
        kind: "pinch",
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale: view.scale,
        // The map point between the two fingers stays between them
        anchor: toMap((a.x + b.x) / 2, (a.y + b.y) / 2),
        rect: viewport.getBoundingClientRect()
    };
}

function showSelection(start, end) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);

    selectionBox.style.left = `${x * gridSize}px`;
    selectionBox.style.top = `${y * gridSize}px`;
    selectionBox.style.width = `${(Math.abs(end.x - start.x) + 1) * gridSize}px`;
    selectionBox.style.height = `${(Math.abs(end.y - start.y) + 1) * gridSize}px`;
    selectionBox.dataset.mode = tool;
    selectionBox.classList.remove("hidden");
}

/* A token the pointer can grab: players' tokens, and enemies for the DM. */
function grabbableToken(target) {
    const token = target.closest(".token");

    if (!token || (token.dataset.kind === "enemy" && !canEditEnemies)) {
        return null;
    }

    return token;
}

function startTool(event) {
    const point = toMap(event.clientX, event.clientY);

    switch (tool) {
        case "reveal":
        case "hide": {
            const cell = cellAt(point);

            gesture = { kind: "area", start: cell, end: cell };
            showSelection(cell, cell);
            break;
        }

        case "enemy":
            callbacks.enemyPlaced(snapToGrid(point.x), snapToGrid(point.y));
            gesture = null;
            break;

        case "draw": {
            const preview = document.createElementNS(SVG, "path");
            const width = Math.round(STROKE_SCREEN_WIDTH / view.scale);

            preview.setAttribute("stroke", drawColor);
            preview.setAttribute("stroke-width", width);
            drawLayer.appendChild(preview);

            gesture = { kind: "stroke", points: [[Math.round(point.x), Math.round(point.y)]], width, preview };
            preview.setAttribute("d", pathData(gesture.points));
            break;
        }

        case "erase":
            gesture = { kind: "erase" };
            callbacks.erased(point.x, point.y, ERASER_SCREEN_RADIUS / view.scale);
            break;

        default:
            startPan(pointers.get(event.pointerId));
    }
}

viewport.addEventListener("pointerdown", event => {
    const isMouse = event.pointerType === "mouse";

    if (isMouse && event.button > 2) {
        return;
    }

    // DM: the × on an enemy
    const remove = event.target.closest(".token-remove");

    if (remove && canEditEnemies && (!isMouse || event.button === 0)) {
        callbacks.enemyRemoved(remove.closest(".token").dataset.id);

        return;
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    try {
        viewport.setPointerCapture(event.pointerId);
    } catch {
        // Dragging still works without pointer capture, it just stops at the window edge.
    }

    if (pointers.size === 2) {
        endTokenDrag(false);
        cancelToolGesture();
        startPinch();

        return;
    }

    // Right or middle mouse button: always move the view
    if (isMouse && event.button !== 0) {
        startPan(pointers.get(event.pointerId));

        return;
    }

    const token = grabbableToken(event.target);

    if (token) {
        const position = toMap(event.clientX, event.clientY);

        gesture = {
            kind: "token",
            id: token.dataset.id,
            isEnemy: token.dataset.kind === "enemy",
            element: token,
            offsetX: position.x - Number(token.dataset.x),
            offsetY: position.y - Number(token.dataset.y),
            lastSent: 0
        };

        token.classList.add("dragging");
    } else {
        startTool(event);
    }
});

function reportTokenMove(done) {
    const { id, isEnemy, element: token } = gesture;
    const x = Number(token.dataset.x);
    const y = Number(token.dataset.y);

    if (isEnemy) {
        callbacks.enemyMoved(id, x, y, done);
    } else {
        callbacks.tokenMoved(id, x, y);
    }
}

viewport.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId)) {
        return;
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const point = () => toMap(event.clientX, event.clientY);

    switch (gesture?.kind) {
        case "pan":
            view.x = gesture.viewX + event.clientX - gesture.startX;
            view.y = gesture.viewY + event.clientY - gesture.startY;
            applyView();
            break;

        case "pinch": {
            if (pointers.size < 2) {
                break;
            }

            const [a, b] = [...pointers.values()];
            const scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, minZoom, MAX_ZOOM);
            const midX = (a.x + b.x) / 2 - gesture.rect.left;
            const midY = (a.y + b.y) / 2 - gesture.rect.top;

            view = { scale, x: midX - gesture.anchor.x * scale, y: midY - gesture.anchor.y * scale };
            applyView();
            break;
        }

        case "area":
            gesture.end = cellAt(point());
            showSelection(gesture.start, gesture.end);
            break;

        case "stroke": {
            const { x, y } = point();
            const [lastX, lastY] = gesture.points[gesture.points.length - 1];

            if (Math.hypot(x - lastX, y - lastY) * view.scale >= STROKE_POINT_SPACING) {
                gesture.points.push([Math.round(x), Math.round(y)]);
                gesture.preview.setAttribute("d", pathData(gesture.points));
            }
            break;
        }

        case "erase": {
            const { x, y } = point();

            callbacks.erased(x, y, ERASER_SCREEN_RADIUS / view.scale);
            break;
        }

        case "token": {
            const position = point();
            let x = position.x - gesture.offsetX;
            let y = position.y - gesture.offsetY;

            if (mapSize) {
                x = clamp(x, 0, mapSize.width);
                y = clamp(y, 0, mapSize.height);
            }

            if (event.shiftKey) {
                x = snapToGrid(x);
                y = snapToGrid(y);
            }

            placeToken(gesture.element, x, y);

            const now = Date.now();

            if (now - gesture.lastSent >= MOVE_SEND_INTERVAL) {
                gesture.lastSent = now;
                reportTokenMove(false);
            }
            break;
        }
    }
});

function endTokenDrag(snap) {
    if (gesture?.kind !== "token") {
        return;
    }

    const token = gesture.element;

    if (snap) {
        placeToken(token, snapToGrid(Number(token.dataset.x)), snapToGrid(Number(token.dataset.y)));
    }

    token.classList.remove("dragging");
    reportTokenMove(true);

    gesture = null;
}

/* Stops a box or line without using it (e.g. a second finger touched down). */
function cancelToolGesture() {
    if (gesture?.kind === "area") {
        selectionBox.classList.add("hidden");
    } else if (gesture?.kind === "stroke") {
        gesture.preview.remove();
    }

    if (["area", "stroke", "erase"].includes(gesture?.kind)) {
        gesture = null;
    }
}

function endToolGesture() {
    if (gesture?.kind === "area") {
        const { start, end } = gesture;

        cancelToolGesture();
        callbacks.areaDrawn(start, end, tool);
    } else if (gesture?.kind === "stroke") {
        const { points, width } = gesture;

        cancelToolGesture();
        callbacks.strokeDrawn({ color: drawColor, width, points });
    } else {
        cancelToolGesture();
    }
}

function onPointerEnd(event) {
    if (!pointers.delete(event.pointerId)) {
        return;
    }

    endTokenDrag(event.shiftKey);
    endToolGesture();

    // Lifting one finger of a pinch continues as a pan with the other
    if (pointers.size === 1) {
        startPan([...pointers.values()][0]);
    } else if (pointers.size === 0) {
        gesture = null;
    }
}

viewport.addEventListener("pointerup", onPointerEnd);
viewport.addEventListener("pointercancel", onPointerEnd);

/* DM tools: "reveal", "hide", "enemy", "draw", "erase", or null to just move around. */
export function setTool(name) {
    tool = name;
    viewport.dataset.tool = name ?? "";
}

export function setDrawColor(color) {
    drawColor = color;
}

/*
 * =========================================================
 * THE MAP: DM
 * =========================================================
 */

let dmImageUrl = null;

/* Shows the whole map (DM). map: { width, height, gridSize, image: Blob } */
export function showDMMap(map) {
    clearMap();

    mapSize = { width: map.width, height: map.height };
    gridSize = map.gridSize;
    canEditEnemies = true;

    world.style.width = `${map.width}px`;
    world.style.height = `${map.height}px`;
    world.style.setProperty("--grid-size", `${gridSize}px`);
    world.classList.add("dm");

    dmImageUrl = URL.createObjectURL(map.image);

    const image = element("img", "dm-map");

    image.src = dmImageUrl;
    image.alt = "";
    image.draggable = false;

    mapLayer.appendChild(image);

    minZoom = fitScale() / 2;
    fitMap();
}

/* Dims the squares players can't see (DM). fog: see fog.js */
export function renderFog(fog) {
    fogCanvas.width = fog.columns;
    fogCanvas.height = fog.rows;
    fogCanvas.style.width = `${fog.columns * gridSize}px`;
    fogCanvas.style.height = `${fog.rows * gridSize}px`;

    const context = fogCanvas.getContext("2d");

    context.clearRect(0, 0, fog.columns, fog.rows);
    context.fillStyle = "#000";

    for (let y = 0; y < fog.rows; y++) {
        for (let x = 0; x < fog.columns; x++) {
            if (!fog.isRevealed(x, y)) {
                context.fillRect(x, y, 1, 1);
            }
        }
    }
}

/*
 * =========================================================
 * THE MAP: PLAYERS
 * =========================================================
 */

export function setGridSize(size) {
    if (size > 0) {
        gridSize = size;
        world.style.setProperty("--grid-size", `${gridSize}px`);
    }
}

function removeBlock(key) {
    const block = blocks.get(key);

    if (block) {
        block.element.remove();
        URL.revokeObjectURL(block.url);
        blocks.delete(key);
    }
}

/* Revealed parts of the map arrived from the DM (players). */
export function showBlocks(received) {
    for (const block of received) {
        // Safety net: never replace a newer picture with an older one
        if ((blocks.get(block.key)?.version ?? -1) > (block.version ?? 0)) {
            continue;
        }

        removeBlock(block.key);

        if (!block.data) {
            continue; // everything in it was hidden again
        }

        const url = URL.createObjectURL(new Blob([block.data], { type: block.type || "image/webp" }));
        const wrapper = element("div", "map-block");
        const image = element("img");
        const grid = element("div", "block-grid");

        image.src = url;
        image.alt = "";
        image.draggable = false;

        // The grid is only drawn over revealed squares: the picture is its mask
        grid.style.maskImage = `url("${url}")`;
        grid.style.webkitMaskImage = `url("${url}")`;

        wrapper.style.left = `${block.x}px`;
        wrapper.style.top = `${block.y}px`;
        wrapper.style.width = `${block.width}px`;
        wrapper.style.height = `${block.height}px`;
        wrapper.append(image, grid);

        mapLayer.appendChild(wrapper);
        blocks.set(block.key, { element: wrapper, url, version: block.version ?? 0 });
    }
}

/* Removes whatever map is shown (leaving a room, or before the DM sends a fresh copy). */
export function clearMap() {
    for (const key of [...blocks.keys()]) {
        removeBlock(key);
    }

    if (dmImageUrl) {
        URL.revokeObjectURL(dmImageUrl);
        dmImageUrl = null;
    }

    mapLayer.replaceChildren();
    fogCanvas.width = 0;
    world.classList.remove("dm");
    world.style.width = "0px";
    world.style.height = "0px";

    renderDrawings([]);
    renderEnemies({});

    mapSize = null;
    minZoom = PLAYER_MIN_ZOOM;
    canEditEnemies = false;
}

/*
 * =========================================================
 * DRAWINGS
 * =========================================================
 */

export function addStroke(stroke) {
    const path = document.createElementNS(SVG, "path");

    path.setAttribute("d", pathData(stroke.points));
    path.setAttribute("stroke", stroke.color);
    path.setAttribute("stroke-width", stroke.width);

    drawLayer.appendChild(path);
    strokes.set(stroke.id, path);
}

export function removeStrokes(ids) {
    for (const id of ids) {
        strokes.get(id)?.remove();
        strokes.delete(id);
    }
}

export function renderDrawings(list) {
    removeStrokes([...strokes.keys()]);

    for (const stroke of list) {
        addStroke(stroke);
    }
}

/*
 * =========================================================
 * GRID
 * =========================================================
 */

const GRID_PREFERENCE_KEY = "spellMap:showGrid";

export function setGridVisible(visible) {
    world.classList.toggle("show-grid", visible);

    try {
        localStorage.setItem(GRID_PREFERENCE_KEY, visible ? "1" : "0");
    } catch {
        // Not remembered
    }
}

export function isGridVisible() {
    return world.classList.contains("show-grid");
}

function initialGridPreference() {
    try {
        return localStorage.getItem(GRID_PREFERENCE_KEY) !== "0";
    } catch {
        return true;
    }
}

/*
 * =========================================================
 * TOKENS (players and enemies)
 * =========================================================
 */

function colorFor(id) {
    let hash = 0;

    for (const character of id) {
        hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }

    return TOKEN_COLORS[hash % TOKEN_COLORS.length];
}

function placeToken(token, x, y) {
    token.dataset.x = x;
    token.dataset.y = y;
    token.style.left = `${x}px`;
    token.style.top = `${y}px`;
}

function createToken(id, kind) {
    const token = element("div", `token ${kind}`);
    const icon = element("img");

    icon.src = kind === "enemy" ? enemyIcon : personIcon;
    icon.alt = "";
    icon.draggable = false;

    token.dataset.id = id;
    token.dataset.kind = kind;
    token.append(icon, element("span", "token-name"));

    if (kind === "player") {
        token.style.setProperty("--token-color", colorFor(id));
    }

    tokenLayer.appendChild(token);

    return token;
}

function isBeingDragged(id) {
    return gesture?.kind === "token" && gesture.id === id;
}

/* Brings the tokens of one kind in line with `entries` ({ [id]: { x, y, name, ... } }). */
function syncTokens(kind, entries, update) {
    for (const [key, token] of tokens) {
        if (token.dataset.kind === kind && !entries[token.dataset.id]) {
            token.remove();
            tokens.delete(key);
        }
    }

    for (const [id, entry] of Object.entries(entries)) {
        const key = `${kind}:${id}`;
        const token = tokens.get(key) ?? createToken(id, kind);

        tokens.set(key, token);
        update(token, entry);

        // Don't yank a token out from under the pointer while it's being dragged here
        if (!isBeingDragged(id)) {
            placeToken(token, entry.x, entry.y);
        }
    }
}

export function renderTokens(players, myId) {
    const entries = Object.fromEntries(
        Object.entries(players).map(([id, player]) => [id, { ...player, ...player.token }])
    );

    syncTokens("player", entries, (token, player) => {
        token.querySelector(".token-name").textContent = player.name;
        token.title = player.name;
        token.classList.toggle("offline", !player.online);
        token.classList.toggle("mine", token.dataset.id === myId);
    });
}

/* Another player moved a token. */
export function moveToken(id, x, y) {
    const token = tokens.get(`player:${id}`);

    if (token && !isBeingDragged(id)) {
        placeToken(token, x, y);
    }
}

/* enemies: { [id]: { x, y, number } }. The DM also gets a × to remove each one. */
export function renderEnemies(enemies) {
    syncTokens("enemy", enemies, (token, enemy) => {
        const name = `Enemy ${enemy.number}`;

        token.querySelector(".token-name").textContent = name;
        token.title = name;

        if (canEditEnemies && !token.querySelector(".token-remove")) {
            const remove = element("button", "token-remove", "×");

            remove.title = `Remove ${name}`;
            remove.setAttribute("aria-label", remove.title);
            token.appendChild(remove);
        }
    });
}

export function tokenColor(id) {
    return colorFor(id);
}

/*
 * =========================================================
 * SETUP
 * =========================================================
 */

export function initMapView(handlers) {
    callbacks = { ...callbacks, ...handlers };

    world.style.setProperty("--grid-size", `${gridSize}px`);
    world.classList.toggle("show-grid", initialGridPreference());

    clearMap();
    applyView();

    new ResizeObserver(() => {
        if (mapSize) {
            minZoom = fitScale() / 2;
        }
    }).observe(viewport);
}
