import { element } from "../dom.js";

/*
 * The DM's notes, written in Markdown:
 *
 *   # Room 7 (Hovering Blade)          a line starting with "# " starts a new note
 *   There is a raised dais...          paragraphs are separated by an empty line
 *
 *   ## Traps & Puzzles                  a heading inside the note
 *   - one                               a bullet list
 *   **bold**, *italic*
 *   [[Gate Ruby]]                       a link to the note titled "Gate Ruby"
 *   [[Gate Ruby|the ruby]]              the same link, showing "the ruby"
 *
 *   | d6 | Spell         | Explanation |   a table: one row per line, cells between "|"
 *   |----|---------------|-------------|   (this line makes the first row the header)
 *   | 01 | Burning skin  | Cause ...   |   when the first header is a die (d6, d20...)
 *                                           the table gets a Roll button
 *
 * One file can hold many notes. A file without any "# " line is one note named after the file.
 */

/* Reads one notes file into [{ title, text }]. */
export function parseNotesFile(fileName, content) {
    const notes = [];
    let current = null;

    for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
        const heading = line.match(/^#\s+(.+?)\s*#*\s*$/);

        if (heading) {
            current = { title: heading[1], lines: [] };
            notes.push(current);
        } else if (current) {
            current.lines.push(line);
        } else if (line.trim()) {
            // Text before the first "# " line: the file itself is a note
            current = { title: fileName.replace(/\.[^.]+$/, ""), lines: [line] };
            notes.push(current);
        }
    }

    return notes.map(note => ({ title: note.title, text: note.lines.join("\n").trim() }));
}

/*
 * =========================================================
 * RENDERING (built from DOM nodes, never as HTML, so nothing in a note can run as code)
 * =========================================================
 */

const INLINE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;

/* Text with links, bold and italic. onLink(title) opens a note; hasNote(title) says whether it exists. */
function inline(text, onLink, hasNote) {
    const nodes = [];
    let last = 0;

    for (const match of text.matchAll(INLINE)) {
        if (match.index > last) {
            nodes.push(document.createTextNode(text.slice(last, match.index)));
        }

        const [, linkTitle, linkText, bold, italic, underscoreItalic] = match;

        if (linkTitle) {
            const title = linkTitle.trim();

            if (hasNote(title)) {
                const link = element("button", "note-link", (linkText ?? title).trim());

                link.title = `Open "${title}"`;
                link.addEventListener("click", () => onLink(title));
                nodes.push(link);
            } else {
                const missing = element("span", "note-link missing", (linkText ?? title).trim());

                missing.title = `There's no note called "${title}"`;
                nodes.push(missing);
            }
        } else if (bold) {
            nodes.push(element("strong", null, bold));
        } else {
            nodes.push(element("em", null, italic ?? underscoreItalic));
        }

        last = match.index + match[0].length;
    }

    if (last < text.length) {
        nodes.push(document.createTextNode(text.slice(last)));
    }

    return nodes;
}

/*
 * =========================================================
 * TABLES
 * =========================================================
 */

/* "| a | b |" → ["a", "b"] (a "\|" inside a cell is a literal "|") */
function tableCells(line) {
    return line
        .replace(/^\|/, "")
        .replace(/(?<!\\)\|$/, "")
        .split(/(?<!\\)\|/)
        .map(cell => cell.replace(/\\\|/g, "|").trim());
}

const isSeparatorRow = cells => cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));

/* "04" → [4, 4], "1-2" or "1–2" → [1, 2] */
function rollRange(cell) {
    const match = cell.match(/^(\d+)(?:\s*[-–]\s*(\d+))?/);

    return match ? [Number(match[1]), Number(match[2] ?? match[1])] : null;
}

function renderTable(lines, onLink, hasNote) {
    const rows = lines.map(tableCells);
    const hasHeader = rows.length >= 2 && isSeparatorRow(rows[1]);
    const header = hasHeader ? rows[0] : null;
    const body = hasHeader ? rows.slice(2) : rows;
    const columns = Math.max(...rows.map(row => row.length));

    const wrapper = element("div", "note-table");
    const table = element("table");

    const addRow = (parent, cells, cellTag) => {
        const row = parent.appendChild(element("tr"));

        for (let i = 0; i < columns; i++) {
            row.appendChild(element(cellTag)).append(...inline(cells[i] ?? "", onLink, hasNote));
        }

        return row;
    };

    if (header) {
        addRow(table.appendChild(element("thead")), header, "th");
    }

    const tbody = table.appendChild(element("tbody"));
    const bodyRows = body.map(cells => addRow(tbody, cells, "td"));

    // A die in the first header (d6, d20, d100...): roll it and highlight the result
    const die = header?.[0].match(/^d(\d+)$/i);

    if (die) {
        const sides = Number(die[1]);
        const bar = element("div", "note-table-roll");
        const button = element("button", null, `Roll d${sides}`);
        const result = element("span", "result-label");

        button.addEventListener("click", () => {
            const roll = 1 + Math.floor(Math.random() * sides);
            const index = body.findIndex(cells => {
                const range = rollRange(cells[0] ?? "");

                return range && roll >= range[0] && roll <= range[1];
            });

            bodyRows.forEach((row, rowIndex) => row.classList.toggle("rolled", rowIndex === index));
            bodyRows[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });

            result.textContent = index >= 0 ? `Rolled ${roll}` : `Rolled ${roll} (no row for it)`;
        });

        bar.append(button, result);
        wrapper.append(bar);
    }

    wrapper.append(table);

    return wrapper;
}

/*
 * =========================================================
 * A WHOLE NOTE
 * =========================================================
 */

export function renderNote(text, onLink, hasNote) {
    const container = element("div", "note-content");
    let paragraph = null;
    let list = null;
    let tableLines = [];

    const endBlocks = () => {
        paragraph = null;
        list = null;

        if (tableLines.length) {
            container.append(renderTable(tableLines, onLink, hasNote));
            tableLines = [];
        }
    };

    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();

        // A table is a run of lines starting with "|"
        if (line.startsWith("|")) {
            paragraph = null;
            list = null;
            tableLines.push(line);
            continue;
        }

        if (tableLines.length || !line) {
            endBlocks();
        }

        if (!line) {
            continue;
        }

        const heading = line.match(/^(#{2,6})\s+(.+)$/);
        const bullet = line.match(/^[-*]\s+(.+)$/);

        if (heading) {
            endBlocks();

            const level = Math.min(heading[1].length + 1, 5); // ## → h3

            container.appendChild(element(`h${level}`)).append(...inline(heading[2], onLink, hasNote));
        } else if (bullet) {
            paragraph = null;
            list ??= container.appendChild(element("ul"));

            list.appendChild(element("li")).append(...inline(bullet[1], onLink, hasNote));
        } else {
            list = null;

            if (paragraph) {
                paragraph.append(document.createTextNode(" "));
            } else {
                paragraph = container.appendChild(element("p"));
            }

            paragraph.append(...inline(line, onLink, hasNote));
        }
    }

    endBlocks();

    return container;
}
