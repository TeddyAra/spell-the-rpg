import Peer from "peerjs";

/*
 * Peer-to-peer game rooms.
 *
 * The DM hosts: their browser keeps the shared game and relays every change.
 * Players connect straight to the DM's browser (WebRTC). The PeerJS cloud
 * server is only used to find each other; no game data goes through it.
 * The DM isn't a player and has no token.
 *
 * Shared game (the DM's copy):
 *   { players: { [playerId]: { name, summary, token: { x, y }, online } },
 *     mapName, revealed: [grid square numbers], coordinates,
 *     enemies: { [id]: { x, y, number } }, drawings: [{ id, color, width, points }] }
 *
 * Only the DM gets the full character summaries. Players are sent names,
 * health and token positions only (see publicPlayer), so the rest can't be
 * dug out of their browser either. The same goes for the map: players only
 * ever receive pictures of revealed squares (see fog.js), never the map itself.
 *
 * Messages
 *   player → DM:  hello { id, name, summary }, summary { summary }, move { id, x, y }
 *   DM → player:  game { game }, player { id, player }, move { id, x, y },
 *                 blocks { blocks: [{ key, version, x, y, width, height, type, data }] },
 *                 enemies { enemies }   only the ones on revealed squares
 *                 drawings { drawings }, stroke { stroke }, erase { ids }
 */

// Namespaces our room ids on the shared PeerJS server
const PEER_PREFIX = "spell-the-rpg-room-";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

const RETRY_DELAY = 3000;

export function newRoomCode() {
    let code = "";

    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }

    return code;
}

export function normalizeRoomCode(text) {
    return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* What players get to see of another player. */
function publicPlayer(player) {
    const summary = player.summary;

    return {
        name: player.name,
        online: player.online,
        token: player.token,
        summary: summary ? { hp: summary.hp, maxHp: summary.maxHp, tempHp: summary.tempHp } : null
    };
}

function publicGame(game) {
    return {
        gridSize: game.gridSize,
        players: Object.fromEntries(
            Object.entries(game.players).map(([id, player]) => [id, publicPlayer(player)])
        )
    };
}

function savedGameKey(code) {
    return `spellMap:game:${code}`;
}

/* The host remembers the game (token positions) so re-hosting the same code restores it. */
export function loadSavedGame(code) {
    try {
        const game = JSON.parse(localStorage.getItem(savedGameKey(code)));

        return game?.players ? game : null;
    } catch {
        return null;
    }
}

function saveGame(code, game) {
    try {
        localStorage.setItem(savedGameKey(code), JSON.stringify(game));
    } catch {
        // Storage full or blocked: the game still works, it just won't be restored.
    }
}

export class Room {
    /*
     * me:      { id, name, summary }
     * spawn:   (numberOfPlayers) => { x, y } for a new player's token
     * events:  { status(text, kind), game(game), move(id, x, y),
     *            playerJoined(connection)  DM: send them the revealed map
     *            blocks(blocks)            player: map pictures arrived
     *            blocksReset()             player: forget the map (a fresh copy follows)
     *            dmMessage(message)        player: enemies / drawings / stroke / erase from the DM }
     *          kind is "connecting", "connected" or "error"
     */
    constructor({ code, isHost, me, spawn, events }) {
        // me.summary is unused for the DM
        this.code = code;
        this.isHost = isHost;
        this.me = me;
        this.spawn = spawn;
        this.events = events;

        this.game = { players: {}, coordinates: "full" };
        this.peer = null;
        this.host = null;              // player: connection to the host
        this.connections = new Set();  // host: connections to players
        this.retryTimer = null;
        this.closed = false;

        if (isHost) {
            this.startHost();
        } else {
            this.startPlayer();
        }
    }

    /*
     * =========================================================
     * ACTIONS
     * =========================================================
     */

    moveToken(id, x, y) {
        const player = this.game.players[id];

        if (!player) {
            return;
        }

        player.token = { x, y };

        if (this.isHost) {
            this.broadcast({ type: "move", id, x, y });
            this.save();
        } else {
            this.sendToHost({ type: "move", id, x, y });
        }
    }

    /* Players only: share your character sheet with the DM. */
    updateSummary(summary) {
        this.me.summary = summary;

        this.sendToHost({ type: "summary", summary });
    }

    /* DM: send map pictures to one player, or to everyone. */
    sendBlocks(blocks, connection = null) {
        this.sendToPlayers({ type: "blocks", blocks }, connection);
    }

    /* DM: send a message to one player, or to everyone. */
    sendToPlayers(message, connection = null) {
        if (connection) {
            if (connection.open) {
                connection.send(message);
            }
        } else {
            this.broadcast(message);
        }
    }

    leave() {
        this.closed = true;

        clearTimeout(this.retryTimer);
        this.peer?.destroy();
    }

    /*
     * =========================================================
     * HOST
     * =========================================================
     */

    startHost() {
        this.game = loadSavedGame(this.code) ?? { players: {}, coordinates: "full" };

        for (const player of Object.values(this.game.players)) {
            player.online = false;
        }

        // Older saves included the DM as a player
        delete this.game.players[this.me.id];

        // Older saves used the half-size map image, so their positions were half as big
        if (this.game.coordinates !== "full") {
            for (const player of Object.values(this.game.players)) {
                player.token = { x: player.token.x * 2, y: player.token.y * 2 };
            }

            this.game.coordinates = "full";
        }

        this.events.game(this.game);

        this.events.status("Opening room…", "connecting");

        this.peer = new Peer(PEER_PREFIX + this.code, { debug: 0 });

        this.peer.on("open", () => {
            this.events.status("Hosting as DM", "connected");
        });

        this.peer.on("connection", connection => this.acceptPlayer(connection));

        this.peer.on("disconnected", () => {
            // Lost the lobby server. Players already connected keep playing; new ones can't join until this reconnects.
            if (!this.closed) {
                this.events.status("Reconnecting to the lobby server…", "connecting");
                this.peer.reconnect();
            }
        });

        this.peer.on("error", error => {
            if (error.type === "unavailable-id") {
                this.leave();
                this.events.status(`Room ${this.code} is already being hosted. Join it instead, or host a new game.`, "error");
            } else {
                this.events.status(`Connection problem (${error.type}).`, "error");
            }
        });
    }

    acceptPlayer(connection) {
        this.connections.add(connection);

        connection.on("data", message => this.handleFromPlayer(connection, message));

        connection.on("close", () => {
            this.connections.delete(connection);

            const id = connection.playerId;

            // Only offline if they have no other open connection (e.g. a second map tab)
            if (id && ![...this.connections].some(other => other.playerId === id)) {
                this.upsertPlayer(id, { online: false });
                this.broadcastPlayer(id);
                this.events.game(this.game);
            }
        });
    }

    handleFromPlayer(connection, message) {
        if (!message || typeof message !== "object") {
            return;
        }

        switch (message.type) {
            case "hello": {
                const id = String(message.id);

                connection.playerId = id;

                this.upsertPlayer(id, {
                    name: String(message.name || "Player").slice(0, 30),
                    summary: message.summary ?? null,
                    online: true
                });

                connection.send({ type: "game", game: publicGame(this.game) });
                this.broadcastPlayer(id, connection);
                this.events.game(this.game);
                this.events.playerJoined(connection);
                break;
            }

            case "summary": {
                const id = connection.playerId;

                if (!id) {
                    return;
                }

                this.upsertPlayer(id, { summary: message.summary ?? null });
                this.broadcastPlayer(id); // including the sender: their own health bar comes from here
                this.events.game(this.game);
                break;
            }

            case "move": {
                const { id, x, y } = message;

                if (!this.game.players[id] || !Number.isFinite(x) || !Number.isFinite(y)) {
                    return;
                }

                this.game.players[id].token = { x, y };
                this.broadcast({ type: "move", id, x, y }, connection);
                this.events.move(id, x, y);
                this.save();
                break;
            }
        }
    }

    upsertPlayer(id, changes) {
        const players = this.game.players;

        if (!players[id]) {
            players[id] = {
                name: "Player",
                summary: null,
                online: false,
                token: this.spawn(Object.keys(players).length)
            };
        }

        Object.assign(players[id], changes);

        this.save();
    }

    broadcastPlayer(id, except = null) {
        this.broadcast({ type: "player", id, player: publicPlayer(this.game.players[id]) }, except);
    }

    broadcast(message, except = null) {
        for (const connection of this.connections) {
            if (connection !== except && connection.open) {
                connection.send(message);
            }
        }
    }

    save() {
        if (this.isHost) {
            saveGame(this.code, this.game);
        }
    }

    /*
     * =========================================================
     * PLAYER (JOINING SOMEONE ELSE'S ROOM)
     * =========================================================
     */

    startPlayer() {
        this.events.status("Connecting…", "connecting");

        this.peer = new Peer({ debug: 0 });

        this.peer.on("open", () => this.connectToHost());

        this.peer.on("disconnected", () => {
            if (!this.closed) {
                this.peer.reconnect();
            }
        });

        this.peer.on("error", error => {
            if (error.type === "peer-unavailable") {
                this.events.status(`Waiting for room ${this.code}… Check the code, and that the host has their map open.`, "connecting");
                this.retryLater();
            } else {
                this.events.status(`Connection problem (${error.type}). Retrying…`, "error");
                this.retryLater();
            }
        });
    }

    connectToHost() {
        if (this.closed) {
            return;
        }

        if (this.peer.disconnected) {
            this.peer.reconnect();
            this.retryLater();

            return;
        }

        // PeerJS's default binary format splits big messages (map pictures) into chunks
        const connection = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });

        connection.on("open", () => {
            this.host = connection;

            connection.send({ type: "hello", id: this.me.id, name: this.me.name, summary: this.me.summary });

            this.events.status("Connected", "connected");
        });

        connection.on("data", message => this.handleFromHost(message));

        connection.on("close", () => {
            if (this.host !== connection || this.closed) {
                return;
            }

            this.host = null;
            this.events.status("Lost the connection to the host. Reconnecting…", "connecting");
            this.retryLater();
        });
    }

    retryLater() {
        clearTimeout(this.retryTimer);

        if (!this.closed && !this.host) {
            this.retryTimer = setTimeout(() => this.connectToHost(), RETRY_DELAY);
        }
    }

    sendToHost(message) {
        if (this.host?.open) {
            this.host.send(message);
        }
    }

    handleFromHost(message) {
        if (!message || typeof message !== "object") {
            return;
        }

        switch (message.type) {
            case "game":
                if (message.game?.players) {
                    this.game = message.game;
                    this.events.blocksReset();
                    this.events.game(this.game);
                }
                break;

            case "blocks":
                if (Array.isArray(message.blocks)) {
                    this.events.blocks(message.blocks);
                }
                break;

            case "enemies":
            case "drawings":
            case "stroke":
            case "erase":
                this.events.dmMessage(message);
                break;

            case "player":
                if (message.id && message.player) {
                    this.game.players[message.id] = message.player;
                    this.events.game(this.game);
                }
                break;

            case "move": {
                const player = this.game.players[message.id];

                if (player) {
                    player.token = { x: message.x, y: message.y };
                    this.events.move(message.id, message.x, message.y);
                }
                break;
            }
        }
    }
}
