import { $, element, formatModifier } from "../dom.js";
import { MAGIC_SCHOOLS } from "../state.js";
import { tokenColor } from "./mapView.js";

/*
 * The initiative list: players and enemies in turn order, each with an
 * initiative number. Clicking a name shows that token on the map.
 *
 * The DM can drag entries into order, set initiative numbers, rename enemies,
 * track enemy health, and sees every player's full character. Players see
 * names, initiative numbers and players' health only.
 *
 * entry: { key, kind: "player" | "enemy", id, name, initiative,
 *          player: online, summary     enemy (DM only): hp, maxHp }
 */

const playerList = $("playerList");

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

// DM: player cards with their details folded away
const collapsed = new Set();

// The entry being dragged to a new place in the order
let draggingKey = null;

function section(title, content) {
    const wrapper = element("div", "overview-section");

    wrapper.append(element("div", "rolls-title", title), content);

    return wrapper;
}

function chip(text, className = "") {
    return element("span", `overview-chip ${className}`.trim(), text);
}

function healthBar(hp, maxHp, tempHp = 0) {
    const bar = element("div", "health-bar");
    const fill = element("div", "health-fill");
    const label = element("div", "health-label");

    fill.style.width = `${Math.max(0, Math.min(1, maxHp ? hp / maxHp : 0)) * 100}%`;
    label.textContent = `HP ${hp} / ${maxHp}` + (tempHp > 0 ? ` +${tempHp}` : "");

    bar.append(fill, label);

    return bar;
}

function numberInput(value, { min, placeholder, title }) {
    const input = element("input", "modal-input");

    input.type = "number";
    input.step = 1;
    input.value = value ?? "";
    input.title = title;

    if (min !== undefined) {
        input.min = min;
    }

    if (placeholder) {
        input.placeholder = placeholder;
    }

    return input;
}

/*
 * =========================================================
 * PLAYER DETAILS (DM)
 * =========================================================
 */

function spellingSection(spelling) {
    const content = element("div", "overview-chips");

    for (const word of spelling.words) {
        content.append(chip(word, "word"));
    }

    if (spelling.loose.length) {
        content.append(element("span", "result-label loose-letters", `Loose: ${spelling.loose.join(" ")}`));
    }

    return section("Spelling", content);
}

function playerDetails(summary) {
    const details = element("div", "entry-details");

    if (summary.spelling) {
        details.append(spellingSection(summary.spelling));
    }

    const stats = element("div", "overview-stats");

    stats.append(
        chip(`AC ${summary.ac}`),
        chip(`Dex / Init ${formatModifier(summary.initiative)}`)
    );
    details.append(stats);

    const schools = element("div", "overview-chips");

    for (const school of MAGIC_SCHOOLS) {
        const level = summary.schools?.[school] ?? 0;

        schools.append(chip(`${capitalize(school)} ${level}`, level === 0 ? "muted" : ""));
    }

    details.append(section("Schools", schools));

    if (summary.spellSlots?.length) {
        const slots = element("div", "overview-chips");

        for (const slot of summary.spellSlots) {
            slots.append(chip(`${slot.name} · ${slot.level}`));
        }

        details.append(section("Spell slots", slots));
    }

    const items = element("div", "overview-chips");

    for (const item of summary.items ?? []) {
        let text = item.name;

        if (item.turns) {
            text += ` (${item.turns} turns)`;
        } else if (item.count !== undefined) {
            text += ` ×${item.count}`;
        }

        items.append(chip(text, item.active ? "active" : ""));
    }

    if (!summary.items?.length) {
        items.append(element("span", "result-label", "Nothing"));
    }

    details.append(section("Items", items));

    return details;
}

/*
 * =========================================================
 * ENEMY HEALTH (DM)
 * =========================================================
 */

function enemyHealth(entry, handlers) {
    const wrapper = element("div", "entry-details enemy-health");
    const controls = element("div", "enemy-hp-controls");

    const amount = numberInput(1, { min: 1, title: "Amount" });
    const damage = element("button", "danger", "Damage");
    const heal = element("button", "primary", "Heal");
    const maxLabel = element("label", "result-label", "Max");
    const max = numberInput(entry.maxHp, { min: 1, title: "Max HP" });

    const change = sign => {
        const value = parseInt(amount.value, 10);

        if (!Number.isNaN(value)) {
            handlers.enemyHealth(entry.id, sign * Math.abs(value));
        }
    };

    damage.addEventListener("click", () => change(-1));
    heal.addEventListener("click", () => change(1));

    max.addEventListener("change", () => {
        const value = parseInt(max.value, 10);

        if (!Number.isNaN(value)) {
            handlers.enemyMaxHealth(entry.id, Math.max(1, value));
        }
    });

    maxLabel.append(max);
    controls.append(amount, damage, heal, maxLabel);
    wrapper.append(healthBar(entry.hp, entry.maxHp), controls);

    return wrapper;
}

/*
 * =========================================================
 * ONE ENTRY
 * =========================================================
 */

function enableDragging(card, handle, entry, handlers) {
    handle.draggable = true;

    handle.addEventListener("dragstart", event => {
        draggingKey = entry.key;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", entry.key);
        event.dataTransfer.setDragImage(card, 16, 16);
        card.classList.add("dragging");
    });

    handle.addEventListener("dragend", () => {
        draggingKey = null;
        card.classList.remove("dragging");
    });

    const dropsAfter = event => {
        const rect = card.getBoundingClientRect();

        return event.clientY > rect.top + rect.height / 2;
    };

    const clearMarker = () => card.classList.remove("drop-before", "drop-after");

    card.addEventListener("dragover", event => {
        if (!draggingKey || draggingKey === entry.key) {
            return;
        }

        event.preventDefault();

        const after = dropsAfter(event);

        card.classList.toggle("drop-before", !after);
        card.classList.toggle("drop-after", after);
    });

    card.addEventListener("dragleave", clearMarker);

    card.addEventListener("drop", event => {
        event.preventDefault();
        clearMarker();

        if (draggingKey && draggingKey !== entry.key) {
            handlers.reorder(draggingKey, entry.key, dropsAfter(event));
        }
    });
}

function nameControl(entry, isDM, handlers) {
    const name = element("button", "entry-name", entry.name);

    name.title = "Show on the map";
    name.addEventListener("click", () => handlers.select(entry.key));

    if (!(isDM && entry.kind === "enemy")) {
        return [name];
    }

    // DM: rename an enemy
    const rename = element("button", "entry-icon-button", "✎");

    rename.title = "Rename";
    rename.setAttribute("aria-label", `Rename ${entry.name}`);

    rename.addEventListener("click", () => {
        const input = element("input", "modal-input name-input");

        input.value = entry.name;
        input.maxLength = 30;

        let finished = false;

        // Enter, Escape or clicking elsewhere; runs once
        const finish = save => {
            if (finished) {
                return;
            }

            finished = true;

            const newName = input.value.trim();

            input.replaceWith(name);
            rename.hidden = false;

            if (save && newName && newName !== entry.name) {
                name.textContent = newName;
                handlers.renameEnemy(entry.id, newName);
            }
        };

        input.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                finish(true);
            } else if (event.key === "Escape") {
                finish(false);
            }
        });
        input.addEventListener("blur", () => finish(true));

        name.replaceWith(input);
        rename.hidden = true;
        input.focus();
        input.select();
    });

    return [name, rename];
}

function renderEntry(entry, myId, isDM, handlers) {
    const card = element("article", `list-entry ${entry.kind}`);
    const header = element("div", "entry-header");

    card.dataset.key = entry.key;
    card.classList.toggle("offline", entry.kind === "player" && !entry.online);
    card.classList.toggle("collapsed", collapsed.has(entry.key));

    if (isDM) {
        const handle = element("span", "drag-handle", "⋮⋮");

        handle.title = "Drag to change the order";
        header.append(handle);
        enableDragging(card, handle, entry, handlers);

        const initiative = numberInput(entry.initiative, { placeholder: "–", title: "Initiative" });

        initiative.classList.add("initiative-input");
        initiative.addEventListener("change", () => {
            const value = parseInt(initiative.value, 10);

            handlers.setInitiative(entry.key, Number.isNaN(value) ? null : value);
        });

        header.append(initiative);
    } else {
        header.append(element("span", "initiative-value", entry.initiative ?? "–"));
    }

    const dot = element("span", "player-dot");

    if (entry.kind === "player") {
        dot.style.background = tokenColor(entry.id);
    }

    header.append(dot, ...nameControl(entry, isDM, handlers));

    if (entry.id === myId) {
        header.append(chip("You"));
    }

    if (entry.kind === "player" && !entry.online) {
        header.append(chip("Offline"));
    }

    // DM: fold a player's details away
    if (isDM && entry.kind === "player" && entry.summary) {
        const toggle = element("button", "entry-icon-button details-toggle", "▾");

        toggle.title = "Show or hide details";
        toggle.addEventListener("click", () => {
            if (collapsed.has(entry.key)) {
                collapsed.delete(entry.key);
            } else {
                collapsed.add(entry.key);
            }

            card.classList.toggle("collapsed", collapsed.has(entry.key));
        });

        header.append(toggle);
    }

    card.append(header);

    if (entry.kind === "player") {
        if (entry.summary) {
            card.append(healthBar(entry.summary.hp, entry.summary.maxHp, entry.summary.tempHp));

            if (isDM) {
                card.append(playerDetails(entry.summary));
            }
        } else {
            card.append(element("p", "result-label", "No character sheet yet."));
        }
    } else if (isDM) {
        card.append(enemyHealth(entry, handlers));
    }

    return card;
}

/*
 * =========================================================
 * THE LIST
 * =========================================================
 */

let pendingRender = null;

/*
 * handlers: { select(key), reorder(key, targetKey, after), setInitiative(key, value),
 *             renameEnemy(id, name), enemyHealth(id, change), enemyMaxHealth(id, value) }
 */
export function renderOverview(entries, myId, isDM, handlers) {
    // Don't throw away what the DM is typing: redraw once they're done
    if (playerList.contains(document.activeElement) && document.activeElement.tagName === "INPUT") {
        pendingRender = () => renderOverview(entries, myId, isDM, handlers);

        return;
    }

    pendingRender = null;

    playerList.replaceChildren(...entries.map(entry => renderEntry(entry, myId, isDM, handlers)));

    $("playerListEmpty").classList.toggle("hidden", entries.length > 0);
}

playerList.addEventListener("focusout", () => {
    setTimeout(() => {
        if (pendingRender && !(playerList.contains(document.activeElement) && document.activeElement.tagName === "INPUT")) {
            pendingRender();
        }
    });
});
