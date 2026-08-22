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
    subscribeRoom,
    startMatch
} from "./multiplayer/roomManager.js";
import { showAuthScreen, hideAuthScreen } from "./ui/authUI.js";
import { renderMenu, renderOnlineMenu } from "./ui/menuUI.js";
import { renderLobby, promptJoinCode } from "./ui/lobbyUI.js";
import { renderGame } from "./ui/gameUI.js";
import { showNotification } from "./ui/notificationUI.js";
import { GameManager } from "./game/gameManager.js";
import {
    initMatchOnHost,
    subscribePublic,
    subscribeHand,
    playCardOnline,
    drawCardOnline,
    callUno,
    challengeUno,
    challengeWildDraw4,
    acceptStack
} from "./multiplayer/matchSync.js";
import { sfx } from "./audio/sfx.js";
import { pickColor, showDrawPenaltyAnim } from "./ui/colorPicker.js";
import { mountChat } from "./ui/chatUI.js";
import { initCheatEngine } from "./utils/cheatEngine.js";
import {
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMuteMic,
    isVoiceAvailable
} from "./multiplayer/voiceChat.js";
import { chooseBotAction } from "./game/botAI.js";
import { logger } from "./utils/logger.js";

let currentUser = null;
let currentRoomId = null;
let currentRoomCode = null;
let roomUnsubscribe = null;
let soloGame = null;
let chatCleanup = null;
let voiceMuted = false;
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
    logger.info("[Boot] Starting... (RoomManager join-v3)");

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
        onSettings: () => {
            document.body.classList.toggle("colorblind-on");
            const on = document.body.classList.contains("colorblind-on");
            showNotification(on ? "Colorblind mode ON" : "Colorblind mode OFF");
        }
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

        // Match started → masuk game screen multiplayer (shared lobby game)
        if (room.meta?.status === "playing") {
            enterMultiplayerMatch(roomId, room);
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
                onStart: async () => {
                    try {
                        showNotification("Memulai pertandingan...");
                        await startMatch(roomId, currentUser.uid);
                    } catch (e) {
                        showNotification(e.message || "Gagal start");
                        logger.error(e);
                    }
                },
                onNotify: showNotification
            }
        );
    });
}

async function leaveCurrentRoom() {
    if (chatCleanup) {
        chatCleanup();
        chatCleanup = null;
    }
    try { await leaveVoiceChannel(); } catch (_) {}
    document.getElementById("btn-mic")?.remove();
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


let matchUnsubs = [];

function cleanupMatchSubs() {
    matchUnsubs.forEach((u) => {
        try {
            u();
        } catch (_) {}
    });
    matchUnsubs = [];
}

function enterMultiplayerMatch(roomId, room) {
    const playerIds = Object.keys(room.players || {});
    const isHost = room.meta?.hostId === currentUser.uid;

    showScreen("game");

    // Voice optional
    if (isVoiceAvailable()) {
        joinVoiceChannel(roomId, currentUser.uid);
        ensureMicButton();
    }

    const ensureChat = () => {
        const host =
            document.querySelector("#chat-slot") ||
            document.getElementById("game-screen");
        if (!host) return;
        if (chatCleanup) chatCleanup();
        chatCleanup = mountChat(host, {
            roomId,
            uid: currentUser.uid,
            displayName:
                currentUser.displayName || currentUser.uid.slice(0, 8)
        });
    };

    const boot = async () => {
        if (isHost) {
            try {
                await initMatchOnHost(roomId, playerIds, {
                    targetScore: room.settings?.targetScore ?? 500,
                    stacking: room.settings?.customRules?.drawStacking ?? false,
                    turnTimer: room.settings?.turnTimer ?? 30
                });
            } catch (e) {
                logger.error(e);
                showNotification(e.message || "Gagal init match");
            }
        }

        cleanupMatchSubs();

        let publicState = null;
        let hand = [];

        const render = () => {
            if (!publicState) return;

            const view = {
                status: publicState.status,
                topCard: publicState.topCard,
                currentColor: publicState.currentColor,
                currentTurn: publicState.currentTurn,
                direction: publicState.direction,
                drawPileCount:
                    publicState.drawPileCount ??
                    publicState.drawPile?.length ??
                    0,
                players: (publicState.playerIds || playerIds).map((uid) => ({
                    uid,
                    handCount: publicState.handCounts?.[uid] ?? 0
                })),
                winner: publicState.winner,
                scores: publicState.scores,
                targetScore: publicState.targetScore,
                challenge: publicState.challenge,
                stackAmount: publicState.stackAmount,
                stacking: publicState.stacking,
                stackType: publicState.stackType,
                pendingUno: publicState.pendingUno,
                handCounts: publicState.handCounts
            };

            renderGame(
                screens.game(),
                {
                    publicState: view,
                    hand,
                    currentUid: currentUser.uid
                },
                {
                    onPlayCard: async (cardId, chosenColor = null) => {
                        try {
                            let color = chosenColor;
                            if (!color) {
                                const card = (hand || []).find((c) => c.id === cardId);
                                if (
                                    card &&
                                    (card.value === "wild" || card.value === "wild_draw4")
                                ) {
                                    color = await pickColor();
                                    if (!color) return;
                                }
                            }
                            await playCardOnline(
                                roomId,
                                currentUser.uid,
                                cardId,
                                color
                            );
                            sfx.playCard();
                        } catch (e) {
                            sfx.error();
                            showNotification(e.message);
                        }
                    },
                    onDraw: async () => {
                        try {
                            await drawCardOnline(roomId, currentUser.uid);
                            sfx.draw();
                        } catch (e) {
                            sfx.error();
                            showNotification(e.message);
                        }
                    },
                    onUno: async () => {
                        try {
                            await callUno(roomId, currentUser.uid);
                            sfx.uno();
                            showNotification("UNO!");
                        } catch (e) {
                            sfx.error();
                            showNotification(e.message);
                        }
                    },
                    onChallengeUno: async (targetUid) => {
                        try {
                            await challengeUno(
                                roomId,
                                currentUser.uid,
                                targetUid
                            );
                            sfx.challenge();
                            showNotification(
                                "Challenge UNO — penalti Draw 2!"
                            );
                        } catch (e) {
                            showNotification(e.message);
                        }
                    },
                    onChallengeWd4: async () => {
                        try {
                            const r = await challengeWildDraw4(
                                roomId,
                                currentUser.uid
                            );
                            sfx.challenge();
                            showNotification(
                                r.wasIllegal
                                    ? "Challenge berhasil! Lawan draw 4"
                                    : "Challenge gagal — kamu draw 6"
                            );
                        } catch (e) {
                            showNotification(e.message);
                        }
                    },
                    onAcceptWd4: async () => {
                        showNotification("WD4 diterima");
                    },
                    onQuit: async () => {
                        cleanupMatchSubs();
                        soloGame = null;
                        await leaveCurrentRoom();
                    }
                }
            );

            ensureChat();

            if (publicState.winner) {
                sfx.win();
                const msg =
                    publicState.winner === currentUser.uid
                        ? "Kamu menang!"
                        : "Pemenang: " +
                          String(publicState.winner).slice(0, 8);
                showNotification(msg);
            }
        };

        matchUnsubs.push(
            subscribePublic(roomId, (state) => {
                const prevAnim = publicState?.lastAnim?.at;
                publicState = state;
                if (state?.lastAnim?.at && state.lastAnim.at !== prevAnim) {
                    showDrawPenaltyAnim(
                        state.lastAnim.n || 0,
                        state.lastAnim.uid === currentUser.uid
                    );
                    sfx.draw();
                }
                render();
            })
        );
        matchUnsubs.push(
            subscribeHand(roomId, currentUser.uid, (h) => {
                hand = Array.isArray(h) ? h : [];
                render();
            })
        );
    };

    boot();
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
                    if (
                        card &&
                        (card.value === "wild" || card.value === "wild_draw4")
                    ) {
                        color = ["red", "blue", "green", "yellow"][
                            Math.floor(Math.random() * 4)
                        ];
                    }
                    const result = soloGame.playCard(
                        currentUser.uid,
                        cardId,
                        color
                    );
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
            onUno: () => showNotification("UNO!"),
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
    const action = chooseBotAction(hand, soloGame.topCard, soloGame.currentColor, "normal");
    try {
        if (action.type === "play") {
            soloGame.playCard("ai-bot", action.cardId, action.color || null);
        } else {
            soloGame.drawCard("ai-bot");
        }
    } catch (_) {}

    if (soloGame.winner === "ai-bot") {
        showNotification("AI menang!");
    }
    refreshSoloUI();
}


function ensureMicButton() {
    if (document.getElementById("btn-mic")) return;
    const btn = document.createElement("button");
    btn.id = "btn-mic";
    btn.className = "btn btn-secondary btn-mic";
    btn.textContent = "🎙️ Mic";
    btn.addEventListener("click", () => {
        voiceMuted = !voiceMuted;
        toggleMuteMic(voiceMuted);
        btn.textContent = voiceMuted ? "🔇 Unmute" : "🎙️ Mic";
        btn.classList.toggle("muted", voiceMuted);
    });
    document.body.appendChild(btn);
}


function ensureChat() {
    if (!currentRoomId || !currentUser) return;
    if (chatCleanup) return;
    chatCleanup = mountChat(document.getElementById("game-screen") || document.body, {
        roomId: currentRoomId,
        uid: currentUser.uid,
        displayName: currentUser.displayName || currentUser.uid.slice(0, 8)
    });
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

initCheatEngine({
    getRoomId: () => currentRoomId,
    getUid: () => currentUser?.uid
});

boot();
