/*
 * The DM's map lives only in the DM's browser: it's loaded from a Universal VTT
 * file (.dd2vtt / .uvtt, e.g. exported from Dungeondraft) and kept in IndexedDB
 * so it only has to be picked once. It's never part of the public site, so
 * players can't see rooms that haven't been revealed.
 *
 * Stored map: { name, width, height, gridSize, image: Blob }
 */

const DB_NAME = "spell-the-rpg";
const STORE = "maps";
const KEY = "current";

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withStore(mode, action) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));

        transaction.oncomplete = () => {
            db.close();
            resolve(request.result);
        };
        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };
    });
}

export async function loadStoredMap() {
    try {
        return (await withStore("readonly", store => store.get(KEY))) ?? null;
    } catch {
        return null;
    }
}

async function storeMap(map) {
    try {
        await withStore("readwrite", store => store.put(map, KEY));
    } catch {
        // Not remembered: the DM will have to pick the file again next time
    }
}

function base64ToBytes(base64) {
    if (Uint8Array.fromBase64) {
        return Uint8Array.fromBase64(base64);
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

/* Reads a .dd2vtt / .uvtt file, remembers it, and returns the map. */
export async function importMapFile(file) {
    let vtt;

    try {
        vtt = JSON.parse(await file.text());
    } catch {
        throw new Error("That file isn't a VTT map (.dd2vtt or .uvtt).");
    }

    if (typeof vtt.image !== "string" || !vtt.resolution?.pixels_per_grid) {
        throw new Error("That file has no map image or grid size in it.");
    }

    const image = new Blob([base64ToBytes(vtt.image)], { type: "image/png" });
    const bitmap = await createImageBitmap(image);

    const map = {
        name: file.name.replace(/\.[^.]+$/, ""),
        width: bitmap.width,
        height: bitmap.height,
        gridSize: vtt.resolution.pixels_per_grid,
        image
    };

    bitmap.close();

    await storeMap(map);

    return map;
}
