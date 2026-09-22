/*
 * The DM's drawings on the map: freehand strokes in map pixels.
 * stroke: { id, color, width, points: [[x, y], ...] }
 */

export const DRAW_COLORS = ["#ffffff", "#e5484d", "#f5c542", "#4fbf73", "#34baeb"];

/* SVG path data for a stroke. A single point becomes a dot (thanks to round line caps). */
export function pathData(points) {
    if (points.length === 1) {
        const [x, y] = points[0];

        return `M${x} ${y}l0.01 0`;
    }

    return points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("");
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;

    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* Does the eraser (a circle at x, y) touch the stroke? */
export function strokeTouches(stroke, x, y, radius) {
    const reach = radius + stroke.width / 2;
    const points = stroke.points;

    if (points.length === 1) {
        return Math.hypot(x - points[0][0], y - points[0][1]) <= reach;
    }

    for (let i = 1; i < points.length; i++) {
        if (distanceToSegment(x, y, points[i - 1], points[i]) <= reach) {
            return true;
        }
    }

    return false;
}
