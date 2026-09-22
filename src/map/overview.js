import { $, element, formatModifier } from "../dom.js";
import { MAGIC_SCHOOLS } from "../state.js";
import { tokenColor } from "./mapView.js";

const playerList = $("playerList");

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

function section(title, content) {
    const wrapper = element("div", "overview-section");

    wrapper.append(element("div", "rolls-title", title), content);

    return wrapper;
}

function chip(text, className = "") {
    return element("span", `overview-chip ${className}`.trim(), text);
}

function healthBar(summary) {
    const bar = element("div", "health-bar");
    const fill = element("div", "health-fill");
    const label = element("div", "health-label");

    fill.style.width = `${Math.max(0, Math.min(1, summary.hp / summary.maxHp)) * 100}%`;
    label.textContent = `HP ${summary.hp} / ${summary.maxHp}` + (summary.tempHp > 0 ? ` +${summary.tempHp}` : "");

    bar.append(fill, label);

    return bar;
}

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

/* detailed: the DM sees everything; players only see names and health. */
function renderPlayerCard(id, player, isMe, onSelect, detailed) {
    const card = element("article", "player-card");
    const header = element("button", "player-header");
    const dot = element("span", "player-dot");

    card.classList.toggle("offline", !player.online);

    dot.style.background = tokenColor(id);

    header.title = "Show on map";
    header.append(dot, element("span", "player-name", player.name));

    if (isMe) {
        header.append(chip("You"));
    }

    if (!player.online) {
        header.append(chip("Offline"));
    }

    header.addEventListener("click", () => onSelect(id));
    card.append(header);

    const summary = player.summary;

    if (!summary) {
        card.append(element("p", "result-label", "No character sheet yet."));

        return card;
    }

    card.append(healthBar(summary));

    if (!detailed) {
        return card;
    }

    if (summary.spelling) {
        card.append(spellingSection(summary.spelling));
    }

    const stats = element("div", "overview-stats");

    stats.append(
        chip(`AC ${summary.ac}`),
        chip(`Initiative ${formatModifier(summary.initiative)}`)
    );
    card.append(stats);

    const schools = element("div", "overview-chips");

    for (const school of MAGIC_SCHOOLS) {
        const level = summary.schools?.[school] ?? 0;

        schools.append(chip(`${capitalize(school)} ${level}`, level === 0 ? "muted" : ""));
    }

    card.append(section("Schools", schools));

    if (summary.spellSlots?.length) {
        const slots = element("div", "overview-chips");

        for (const slot of summary.spellSlots) {
            slots.append(chip(`${slot.name} · ${slot.level}`));
        }

        card.append(section("Spell slots", slots));
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

    card.append(section("Items", items));

    return card;
}

/* You first, then everyone else by name. */
export function renderOverview(players, myId, onSelect, detailed) {
    const entries = Object.entries(players).sort(([idA, a], [idB, b]) => {
        if (idA === myId) return -1;
        if (idB === myId) return 1;

        return a.name.localeCompare(b.name);
    });

    playerList.replaceChildren(
        ...entries.map(([id, player]) => renderPlayerCard(id, player, id === myId, onSelect, detailed))
    );
}
