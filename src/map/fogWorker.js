/*
 * Makes the pictures of revealed squares that are sent to players (see fog.js).
 * Runs in a background thread: cutting pieces out of the big map picture and
 * compressing them would otherwise freeze the DM's screen.
 *
 * Messages in:   load { image: Blob }
 *                encode { id, left, top, width, height, cells: [[x, y, width, height], ...] }
 * Messages out:  loaded
 *                encoded { id, type, data: ArrayBuffer }
 */

const QUALITY = 0.9;

let map = null;

self.onmessage = async ({ data: message }) => {
    if (message.type === "load") {
        map?.close();
        map = await createImageBitmap(message.image);

        self.postMessage({ type: "loaded" });

        return;
    }

    if (message.type === "encode") {
        const { id, left, top, width, height, cells } = message;
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");

        // Only the revealed squares are copied; everything else stays transparent
        for (const [x, y, w, h] of cells) {
            context.drawImage(map, x, y, w, h, x - left, y - top, w, h);
        }

        // WebP where the browser can make it, otherwise PNG
        const blob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY });
        const data = await blob.arrayBuffer();

        self.postMessage({ type: "encoded", id, blobType: blob.type, data }, [data]);
    }
};
