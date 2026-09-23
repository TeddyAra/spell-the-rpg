import { $, show, hide, element } from "../dom.js";
import { openWindow } from "./windows.js";
import { parseNotesFile, renderNote } from "./noteFormat.js";
import { loadStoredNotes, storeNotes } from "./mapStore.js";

/*
 * Notes on the map page:
 *   - My notes (everyone): one free-text window, saved in this browser only.
 *   - Library (DM): the DM's own notes file (rooms, items, stat blocks...). A quick
 *     search picks a note, which opens in its own window; links open other notes.
 */

const MY_NOTES_KEY = "spellMap:myNotes";

const MAX_RESULTS = 60;

/*
 * =========================================================
 * MY NOTES
 * =========================================================
 */

function openMyNotes() {
    const text = element("textarea", "my-notes-text");

    text.placeholder = "Your notes.";
    text.spellcheck = true;

    try {
        text.value = localStorage.getItem(MY_NOTES_KEY) ?? "";
    } catch {
        // Nothing saved
    }

    text.addEventListener("input", () => {
        try {
            localStorage.setItem(MY_NOTES_KEY, text.value);
        } catch {
            // Not saved
        }
    });

    openWindow({ id: "my-notes", title: "Notes", content: text, remember: true, width: 360, height: 360 });
    text.focus();
}

$("myNotesButton").addEventListener("click", openMyNotes);

/*
 * =========================================================
 * LIBRARY (DM)
 * =========================================================
 */

let library = [];           // [{ title, text }]
let byTitle = new Map();    // lower-case title → note

const search = $("librarySearch");
const searchInput = $("librarySearchInput");
const results = $("libraryResults");
const libraryFileInput = $("libraryFileInput");

function setLibrary(notes) {
    library = notes;
    byTitle = new Map(notes.map(note => [note.title.toLowerCase(), note]));

    $("libraryCount").textContent = notes.length
        ? `${notes.length} ${notes.length === 1 ? "note" : "notes"}`
        : "No notes loaded yet";
}

function findNote(title) {
    return byTitle.get(title.trim().toLowerCase());
}

export function openNote(title) {
    const note = findNote(title);

    if (!note) {
        return;
    }

    closeSearch();

    openWindow({
        id: `note:${note.title.toLowerCase()}`,
        title: note.title,
        content: renderNote(note.text, openNote, linkTitle => Boolean(findNote(linkTitle))),
        className: "note-window",
        width: 420,
        height: 380
    });
}

/* Title matches first, then notes that mention the words somewhere in their text. */
function matchingNotes(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);

    if (!words.length) {
        return [...library].sort((a, b) => a.title.localeCompare(b.title));
    }

    const inTitle = [];
    const inText = [];

    for (const note of library) {
        const title = note.title.toLowerCase();

        if (words.every(word => title.includes(word))) {
            inTitle.push(note);
        } else if (words.every(word => title.includes(word) || note.text.toLowerCase().includes(word))) {
            inText.push(note);
        }
    }

    return [...inTitle.sort((a, b) => a.title.localeCompare(b.title)), ...inText];
}

function renderResults() {
    const notes = matchingNotes(searchInput.value).slice(0, MAX_RESULTS);

    results.replaceChildren(...notes.map((note, index) => {
        const item = element("button", "library-result", note.title);

        item.classList.toggle("selected", index === 0);
        item.addEventListener("click", () => openNote(note.title));

        return item;
    }));

    $("libraryEmpty").classList.toggle("hidden", notes.length > 0);
    $("libraryEmpty").textContent = library.length ? "Nothing found." : "Load your notes file to search it.";
}

function openSearch() {
    show(search);
    searchInput.value = "";
    renderResults();
    searchInput.focus();
}

function closeSearch() {
    hide(search);
}

$("libraryButton").addEventListener("click", () => {
    if (search.classList.contains("hidden")) {
        openSearch();
    } else {
        closeSearch();
    }
});

searchInput.addEventListener("input", renderResults);

// Arrow keys pick a result, Enter opens it, Escape closes the search
searchInput.addEventListener("keydown", event => {
    const items = [...results.querySelectorAll(".library-result")];
    const selected = items.findIndex(item => item.classList.contains("selected"));

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();

        const next = Math.max(0, Math.min(items.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));

        items.forEach((item, index) => item.classList.toggle("selected", index === next));
        items[next]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
        items[selected]?.click();
    } else if (event.key === "Escape") {
        closeSearch();
    }
});

// It's a quick search: clicking anywhere else closes it
document.addEventListener("pointerdown", event => {
    if (!search.classList.contains("hidden") && !search.contains(event.target) && !event.target.closest("#libraryButton")) {
        closeSearch();
    }
});

$("loadLibraryButton").addEventListener("click", () => libraryFileInput.click());

libraryFileInput.addEventListener("change", async () => {
    const files = [...libraryFileInput.files];

    libraryFileInput.value = "";

    if (!files.length) {
        return;
    }

    const notes = [];

    for (const file of files) {
        notes.push(...parseNotesFile(file.name, await file.text()));
    }

    setLibrary(notes);
    await storeNotes(notes);

    renderResults();
    searchInput.focus();
});

/* DM only: the Library button. */
export function setLibraryAvailable(available) {
    $("libraryButton").classList.toggle("hidden", !available);

    if (!available) {
        closeSearch();
    }
}

loadStoredNotes().then(setLibrary);
