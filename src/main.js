/**
 * Card Clash - Entry Point
 * Boot flow:
 *   Firebase ready → waitForAuthState
 *     → session ada? startAuthenticatedSession
 *     → tidak? showAuthScreen (Google | Guest)
 */
import {
    waitForAuthState,
    handleGoogleRedirectResult,
    logout,
    isAnonymousUser,
    onAuthChange
} from "./auth/authManager.js";
import { createPlayerProfile } from "./auth/playerProfile.js";
import { secureAccountWithGoogle } from "./auth/accountLinking.js";
import { initializePresence } from "./multiplayer/presence.js";
import {
    createRoom,
    joinRoomByCode,
    leaveRoom,
    setReady,
    subscribeRoom
} from "./multiplayer/roomManager.js";
import { showAuthScreen, hideAuthScreen } from "./ui/authUI.js";
import { renderMenu, renderOnlineMenu } from "./ui/menuUI.js";
import { renderLobby, promptJoinCode } from "./ui/lobbyUI.js";
import { renderGame } from "./ui/gameUI.js";
import { showNotification } from "./ui/notificationUI.js";
import { GameManager } from "./game/gameManager.js";
import { logger } from "./utils/logger.js";

let currentUser = null;
let currentRoomId = null;
let currentRoomCode = null;
let roomUnsubscribe = null;
let soloGame = null;
let presenceCleanup = null;
let authUnsub = null;

const screens = {
    loading: () => document.getElementById("loading-screen"),
    menu: () => document.getElementById("menu-screen"),
    lobby: () => document.getElementById("lobby-screen"),
    game: () => document.getElementById("game-screen")
};

function showScreen(name) {
    Object.keys(screens).forEach((key) => {
        const el = screens[key]();
        if (!el) return;
        if (key === name) {
            el.classList.remove("hidden");
            if (key === "loading") el.style.display = "flex";
        } else {
            el.classList.add("hidden");
            if (key === "loading") el.style.display = "none";
        }
    });
}

async function boot() {
    logger.info("[Boot] Starting...");

    try {
        // 1) Cek hasil redirect Google (jika sebelumnya popup diblokir)
        let user = null;
        try {
            user = await handleGoogleRedirectResult();
        } catch (e) {
            logger.warn("[Boot] Redirect result error:", e.message);
        }

        // 2) Atau restore session yang sudah ada
        if (!user) {
            user = await waitForAuthState();
        }

        if (user) {
            await startAuthenticatedSession(user);
            return;
        }

        // 3) Tidak ada session → tampilkan Login Screen
        const loading = screens.loading();
        if (loading) {
            loading.classList.add("hidden");
            loading.style.display = "none";
        }

        showAuthScreen({
            onAuthenticated: startAuthenticatedSession
        });
    } catch (error) {
        logger.error("[Boot] Fatal:", error);
        showFatalError(error);
    }
}

async function startAuthenticatedSession(user) {
    currentUser = user;

    try {
        await createPlayerProfile(user);
    } catch (e) {
        // RTDB belum dibuat / rules ketat — tetap lanjut UI
        logger.warn("[Boot] Profile create failed (check RTDB):", e.message);
    }

    if (presenceCleanup) presenceCleanup();
    try {
        presenceCleanup = initializePresence(user.uid);
    } catch (e) {
        logger.warn("[Boot] Presence failed:", e.message);
    }

    hideAuthScreen();

    const loading = screens.loading();
    if (loading) {
        loading.classList.add("hidden");
        loading.style.display = "none";
    }

    logger.info(
        "[Boot] Authenticated:",
        user.uid,
        isAnonymousUser(user) ? "(Guest)" : "(Google)"
    );

    // Listen logout / account change
    if (authUnsub) authUnsub();
    authUnsub = onAuthChange((u) => {
        if (!u) {
            currentUser = null;
            if (presenceCleanup) {
                presenceCleanup();
                presenceCleanup = null;
            }
            showAuthScreen({ onAuthenticated: startAuthenticatedSession });
        } else {
            currentUser = u;
        }
    });

    startApplication();
}

function startApplication() {
    showScreen("menu");
    renderMenu(screens.menu(), {
        onSolo: startSolo,
        onOnline: showOnlineMenu,
        onProfile: showProfileInfo,
        onSettings: () => showNotification("Settings coming soon")
    });
}

function showProfileInfo() {
    if (!currentUser) return;
    const type = isAnonymousUser(currentUser) ? "Guest" : "Google";
    const name = currentUser.displayName || currentUser.uid.slice(0, 10);
    if (isAnonymousUser(currentUser)) {
        if (window.confirm("Upgrade Guest → Google sekarang? Progress tetap di akun yang sama.")) {
            secureAccountWithGoogle()
                .then((u) => {
                    currentUser = u;
                    showNotification("Akun berhasil diamankan dengan Google!");
                })
                .catch((e) => showNotification(e.message || "Gagal link akun"));
        }
    } else {
        showNotification(name + " · " + type);
    }
}

function showOnlineMenu() {
    showScreen("menu");
    renderOnlineMenu(screens.menu(), {
        onBack: startApplication,
        onQuick: () =>
            showNotification("Quick Match belum diimplementasi. Gunakan Create/Join Room."),
        onCreate: handleCreateRoom,
        onJoin: handleJoinRoom
    });
}

async function handleCreateRoom() {
    if (!currentUser) return;
    try {
        showNotification("Membuat room...");
        const { roomId, roomCode } = await createRoom(currentUser, {
            maxPlayers: 4,
            isPrivate: true
        });
        currentRoomId = roomId;
        currentRoomCode = roomCode;
        enterLobby(roomId, roomCode);
    } catch (err) {
        logger.error(err);
        showNotification(err.message || "Gagal membuat room");
    }
}

async function handleJoinRoom() {
    if (!currentUser) return;
    const code = promptJoinCode();
    if (!code) return;

    try {
        showNotification("Bergabung...");
        const { roomId, roomCode } = await joinRoomByCode(currentUser, code);
        currentRoomId = roomId;
        currentRoomCode = roomCode;
        enterLobby(roomId, roomCode);
    } catch (err) {
        logger.error(err);
        showNotification(err.message || "Gagal join room");
    }
}

function enterLobby(roomId, roomCode) {
    if (roomUnsubscribe) roomUnsubscribe();

    showScreen("lobby");

    roomUnsubscribe = subscribeRoom(roomId, (room) => {
        if (!room) {
            showNotification("Room ditutup");
            leaveCurrentRoom();
            return;
        }

        const isHost = room.meta?.hostId === currentUser.uid;
        renderLobby(
            screens.lobby(),
            {
                roomCode,
                room,
                currentUid: currentUser.uid,
                isHost
            },
            {
                onLeave: leaveCurrentRoom,
                onReady: async () => {
                    const me = room.players?.[currentUser.uid];
                    await setReady(roomId, currentUser.uid, !me?.ready);
                },
                onStart: () => {
                    showNotification(
                        "Start match multiplayer: Phase 4 (server authoritative)"
                    );
                },
                onNotify: showNotification
            }
        );
    });
}

async function leaveCurrentRoom() {
    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }
    if (currentRoomId && currentUser) {
        try {
            await leaveRoom(currentUser.uid, currentRoomId);
        } catch (e) {
            logger.warn(e);
        }
    }
    currentRoomId = null;
    currentRoomCode = null;
    showOnlineMenu();
}

function startSolo() {
    if (!currentUser) return;
    soloGame = new GameManager({
        playerIds: [currentUser.uid, "ai-bot"],
        isSolo: true
    });
    soloGame.start();

    showScreen("game");
    refreshSoloUI();
}

function refreshSoloUI() {
    if (!soloGame || !currentUser) return;
    const publicState = soloGame.getPublicView();
    const hand = soloGame.getPrivateHand(currentUser.uid);

    renderGame(
        screens.game(),
        {
            publicState,
            hand,
            currentUid: currentUser.uid
        },
        {
            onPlayCard: (cardId) => {
                try {
                    const card = hand.find((c) => c.id === cardId);
                    let color = null;
                    if (card && (card.value === "wild" || card.value === "wild_draw4")) {
                        color = ["red", "blue", "green", "yellow"][
                            Math.floor(Math.random() * 4)
                        ];
                    }
                    const result = soloGame.playCard(currentUser.uid, cardId, color);
                    if (result.type === "win") {
                        showNotification("Kamu menang!");
                    }
                    setTimeout(runAITurn, 600);
                    refreshSoloUI();
                } catch (e) {
                    showNotification(e.message);
                }
            },
            onDraw: () => {
                try {
                    soloGame.drawCard(currentUser.uid);
                    setTimeout(runAITurn, 600);
                    refreshSoloUI();
                } catch (e) {
                    showNotification(e.message);
                }
            },
            onLastCard: () =>
                showNotification("LAST CARD! (penalty system di Phase berikutnya)"),
            onQuit: () => {
                soloGame = null;
                startApplication();
            }
        }
    );
}

function runAITurn() {
    if (!soloGame || soloGame.status !== "playing") return;
    if (soloGame.turn.currentPlayerId !== "ai-bot") return;

    const hand = soloGame.getPrivateHand("ai-bot");
    const top = soloGame.topCard;
    const color = soloGame.currentColor;

    const canPlay = (card, topCard, currentColor) => {
        if (!card || !topCard) return false;
        if (card.value === "wild" || card.value === "wild_draw4") return true;
        const effective = currentColor || topCard.color;
        if (card.color === effective) return true;
        if (card.value === topCard.value) return true;
        return false;
    };

    let played = false;
    for (const card of hand) {
        if (canPlay(card, top, color)) {
            try {
                let chosen = null;
                if (card.value === "wild" || card.value === "wild_draw4") {
                    chosen = "red";
                }
                soloGame.playCard("ai-bot", card.id, chosen);
                played = true;
                break;
            } catch (_) {}
        }
    }

    if (!played) {
        try {
            soloGame.drawCard("ai-bot");
        } catch (_) {}
    }

    if (soloGame.winner === "ai-bot") {
        showNotification("AI menang!");
    }

    refreshSoloUI();
}

function showFatalError(error) {
    document.body.innerHTML = `
        <main class="fatal-error">
            <h1>Gagal memulai game</h1>
            <p>${error?.message || "Unknown error"}</p>
            <p class="text-muted" style="margin-top:0.5rem;font-size:0.85rem">
                Pastikan Anonymous Auth &amp; Google Sign-In + Realtime Database sudah diaktifkan di Firebase Console.
            </p>
            <button class="btn btn-primary" onclick="location.reload()" style="margin-top:1.5rem;max-width:200px">
                Coba Lagi
            </button>
        </main>
    `;
}

window.__cardClashLogout = async () => {
    await logout();
};

boot();
