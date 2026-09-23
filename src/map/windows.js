import { element } from "../dom.js";

/*
 * Floating windows on the map page: drag them by the title bar, resize them from
 * the bottom-right corner, close them with ×. Clicking a window brings it to the front.
 * Windows with `remember` keep their place and size between visits.
 */

const MIN_WIDTH = 240;
const MIN_HEIGHT = 140;
const TITLE_BAR_VISIBLE = 40; // pixels of a window that always stay on screen

const openWindows = new Map(); // id → window element
let topZ = 10;
let cascade = 0;

function storageKey(id) {
    return `spellMap:window:${id}`;
}

function loadGeometry(id) {
    try {
        return JSON.parse(localStorage.getItem(storageKey(id)));
    } catch {
        return null;
    }
}

function saveGeometry(id, win) {
    try {
        localStorage.setItem(storageKey(id), JSON.stringify({
            x: win.offsetLeft,
            y: win.offsetTop,
            width: win.offsetWidth,
            height: win.offsetHeight
        }));
    } catch {
        // Not remembered
    }
}

function bringToFront(win) {
    win.style.zIndex = String(++topZ);
}

/* Keeps enough of the window on screen to grab its title bar. */
function keepOnScreen(win) {
    const maxX = window.innerWidth - TITLE_BAR_VISIBLE;
    const maxY = window.innerHeight - TITLE_BAR_VISIBLE;

    win.style.left = `${Math.min(Math.max(win.offsetLeft, TITLE_BAR_VISIBLE - win.offsetWidth), maxX)}px`;
    win.style.top = `${Math.min(Math.max(win.offsetTop, 0), maxY)}px`;
}

function makeDraggable(win, handle, onMoved) {
    handle.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.target.closest("button")) {
            return;
        }

        event.preventDefault();

        const startX = event.clientX - win.offsetLeft;
        const startY = event.clientY - win.offsetTop;

        const move = moveEvent => {
            win.style.left = `${moveEvent.clientX - startX}px`;
            win.style.top = `${moveEvent.clientY - startY}px`;
            keepOnScreen(win);
        };

        const stop = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", stop);
            onMoved();
        };

        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
    });
}

/*
 * Opens a window, or brings it to the front if one with this id is already open.
 *   id, title, content (element), width, height, remember, className
 * Returns the window's body element.
 */
export function openWindow({ id, title, content, width = 380, height = 320, remember = false, className = "" }) {
    if (openWindows.has(id)) {
        const existing = openWindows.get(id);

        bringToFront(existing);

        return existing.querySelector(".floating-body");
    }

    const win = element("section", `floating-window ${className}`.trim());
    const bar = element("header", "floating-title-bar");
    const heading = element("h2", "floating-title", title);
    const close = element("button", "floating-close", "×");
    const body = element("div", "floating-body");

    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", title);
    close.title = "Close";
    close.setAttribute("aria-label", `Close ${title}`);

    bar.append(heading, close);
    body.append(content);
    win.append(bar, body);

    // New windows open in a cascade, so they don't all land on top of each other
    const saved = remember ? loadGeometry(id) : null;
    const offset = (cascade++ % 8) * 28;

    win.style.left = `${saved?.x ?? 90 + offset}px`;
    win.style.top = `${saved?.y ?? 80 + offset}px`;
    win.style.width = `${Math.max(MIN_WIDTH, saved?.width ?? width)}px`;
    win.style.height = `${Math.max(MIN_HEIGHT, saved?.height ?? height)}px`;

    document.body.appendChild(win);
    keepOnScreen(win);
    bringToFront(win);
    openWindows.set(id, win);

    const remembered = () => {
        if (remember) {
            saveGeometry(id, win);
        }
    };

    win.addEventListener("pointerdown", () => bringToFront(win));
    makeDraggable(win, bar, remembered);

    // Resizing uses the browser's own corner handle (CSS resize); remember the new size
    if (remember) {
        new ResizeObserver(remembered).observe(win);
    }

    close.addEventListener("click", () => closeWindow(id));

    return body;
}

export function closeWindow(id) {
    openWindows.get(id)?.remove();
    openWindows.delete(id);
}

export function closeAllWindows() {
    for (const id of [...openWindows.keys()]) {
        closeWindow(id);
    }
}
