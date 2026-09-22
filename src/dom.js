export const $ = id => document.getElementById(id);

export function show(element) {
    element.classList.remove("hidden");
}

export function hide(element) {
    element.classList.add("hidden");
}

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function formatModifier(value) {
    return value >= 0 ? `+${value}` : String(value);
}

/*
 * Calls `onValue` with the input's integer value (raised to `min`) every
 * time it changes. Non-numeric input is ignored.
 */
export function onNumberInput(input, min, onValue) {
    input.addEventListener("input", () => {
        const value = parseInt(input.value, 10);

        if (Number.isNaN(value)) {
            return;
        }

        const clamped = Math.max(min, value);

        input.value = clamped;
        onValue(clamped);
    });
}

/* Renders each roll as a small die inside `container`. */
export function renderDice(container, rolls, isHigh = () => false) {
    container.innerHTML = "";

    for (const value of rolls) {
        const die = document.createElement("div");

        die.className = isHigh(value) ? "die high" : "die";
        die.textContent = value;

        container.appendChild(die);
    }
}
