import { $, show, hide, renderDice } from "./dom.js";

const infoResultOverlay = $("infoResultOverlay");

/*
 * Shows a simple result popup.
 *   rows: [[label, value], ...]
 *   list: optional { title, values } rendered as small boxes (dice, letters)
 */
export function showInfoResult(title, rows, list = null) {
    $("infoResultTitle").textContent = title;

    const container = $("infoResultRows");

    container.innerHTML = "";

    for (const [label, value] of rows) {
        const row = document.createElement("div");
        const labelElement = document.createElement("span");
        const valueElement = document.createElement("strong");

        row.className = "result-row";
        labelElement.className = "result-label";

        labelElement.textContent = label;
        valueElement.textContent = value;

        row.append(labelElement, valueElement);
        container.appendChild(row);
    }

    const listBox = $("infoResultListBox");

    if (list) {
        $("infoResultListTitle").textContent = list.title;
        renderDice($("infoResultList"), list.values);

        show(listBox);
    } else {
        hide(listBox);
    }

    show(infoResultOverlay);
}

$("closeInfoResult").addEventListener("click", () => hide(infoResultOverlay));
