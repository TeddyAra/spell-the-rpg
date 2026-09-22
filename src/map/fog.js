/*
 * DM side of hidden rooms: which grid squares the players can see, and the
 * pictures that get sent to them.
 *
 * The map is split into blocks of BLOCK_CELLS × BLOCK_CELLS squares. A player
 * receives a block's picture with every hidden square cut out (transparent),
 * so hidden rooms and the size of the map never reach their browser.
 *
 * Pictures are made in a background thread (fogWorker.js), one at a time.
 * Every change to a block bumps its version; a picture made for an older
 * version is thrown away, so players always end up with the latest one.
 */

const BLOCK_CELLS = 4;

export class Fog {
    /*
     * map:           { width, height, gridSize, image: Blob }
     * revealedCells: grid square numbers that start revealed
     * onBlockReady:  called with each new block picture, to send to players:
     *                { key, version, x, y, width, height, type, data }
     *                (data is null when everything in the block is hidden)
     */
    constructor(map, revealedCells, onBlockReady) {
        this.map = map;
        this.onBlockReady = onBlockReady;

        this.columns = Math.ceil(map.width / map.gridSize);
        this.rows = Math.ceil(map.height / map.gridSize);

        this.revealed = new Set(revealedCells.filter(index => index >= 0 && index < this.columns * this.rows));

        this.versions = new Map(); // block key → version number
        this.pictures = new Map(); // block key → latest picture message (blocks with something revealed)
        this.dirty = new Set();    // block keys waiting for a new picture
        this.working = false;

        this.worker = new Worker(new URL("./fogWorker.js", import.meta.url), { type: "module" });
        this.pending = new Map(); // request id → resolve
        this.nextRequest = 0;

        this.workerReady = new Promise(resolve => {
            this.worker.onmessage = ({ data: message }) => {
                if (message.type === "loaded") {
                    resolve();
                } else if (message.type === "encoded") {
                    this.pending.get(message.id)?.(message);
                    this.pending.delete(message.id);
                }
            };
        });

        this.worker.postMessage({ type: "load", image: map.image });

        // Make pictures of everything that's already revealed (e.g. when hosting a room again)
        this.markDirty(this.visibleBlockKeys());
    }

    destroy() {
        this.worker.terminate();
        this.dirty.clear();
    }

    cellIndex(x, y) {
        return y * this.columns + x;
    }

    isRevealed(x, y) {
        return this.revealed.has(this.cellIndex(x, y));
    }

    /* For saving: the revealed squares as numbers. */
    revealedList() {
        return [...this.revealed];
    }

    blockKey(x, y) {
        return `${Math.floor(x / BLOCK_CELLS)},${Math.floor(y / BLOCK_CELLS)}`;
    }

    /* Keys of all blocks with at least one revealed square. */
    visibleBlockKeys() {
        const keys = new Set();

        for (const index of this.revealed) {
            keys.add(this.blockKey(index % this.columns, Math.floor(index / this.columns)));
        }

        return [...keys];
    }

    /* The latest pictures of everything revealed, for a player who just joined. */
    currentPictures() {
        return [...this.pictures.values()];
    }

    /* Reveals (or hides) the squares from (x0, y0) to (x1, y1), inclusive. */
    setArea(x0, y0, x1, y1, visible) {
        const changed = new Set();

        for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(this.rows - 1, Math.max(y0, y1)); y++) {
            for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(this.columns - 1, Math.max(x0, x1)); x++) {
                const index = this.cellIndex(x, y);

                if (this.revealed.has(index) !== visible) {
                    if (visible) {
                        this.revealed.add(index);
                    } else {
                        this.revealed.delete(index);
                    }

                    changed.add(this.blockKey(x, y));
                }
            }
        }

        for (const key of changed) {
            this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
        }

        this.markDirty([...changed]);
    }

    markDirty(keys) {
        for (const key of keys) {
            this.dirty.add(key);
        }

        this.work();
    }

    /* Makes pictures of dirty blocks, one at a time, in the background. */
    async work() {
        if (this.working) {
            return;
        }

        this.working = true;

        while (this.dirty.size) {
            const key = this.dirty.values().next().value;
            const version = this.versions.get(key) ?? 0;

            this.dirty.delete(key);

            const picture = await this.makePicture(key, version);

            // Changed again while this was being made: a newer picture is already queued
            if ((this.versions.get(key) ?? 0) !== version) {
                continue;
            }

            if (picture.data) {
                this.pictures.set(key, picture);
            } else {
                this.pictures.delete(key);
            }

            this.onBlockReady(picture);
        }

        this.working = false;
    }

    async makePicture(key, version) {
        const [blockX, blockY] = key.split(",").map(Number);
        const { gridSize, width: mapWidth, height: mapHeight } = this.map;
        const blockSize = BLOCK_CELLS * gridSize;

        const left = blockX * blockSize;
        const top = blockY * blockSize;
        const width = Math.min(blockSize, mapWidth - left);
        const height = Math.min(blockSize, mapHeight - top);

        const picture = { key, version, x: left, y: top, width, height, type: null, data: null };
        const cells = [];

        for (let y = blockY * BLOCK_CELLS; y < Math.min(this.rows, (blockY + 1) * BLOCK_CELLS); y++) {
            for (let x = blockX * BLOCK_CELLS; x < Math.min(this.columns, (blockX + 1) * BLOCK_CELLS); x++) {
                if (this.isRevealed(x, y)) {
                    const sx = x * gridSize;
                    const sy = y * gridSize;

                    cells.push([sx, sy, Math.min(gridSize, mapWidth - sx), Math.min(gridSize, mapHeight - sy)]);
                }
            }
        }

        if (cells.length === 0) {
            return picture;
        }

        await this.workerReady;

        const id = this.nextRequest++;
        const result = await new Promise(resolve => {
            this.pending.set(id, resolve);
            this.worker.postMessage({ type: "encode", id, left, top, width, height, cells });
        });

        return { ...picture, type: result.blobType, data: result.data };
    }
}
