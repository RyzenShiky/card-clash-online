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
    markReconnecting,
    markConnected,
    DEFAULT_GRACE_MS
} from "./multiplayer/reconnect.js";
import { listenerManager } from "./multiplayer/listenerManager.js";
import {
    createRoom,
    joinRoomByCode,
    leaveRoom,
    setReady,
    subscribeRoom,
    startMatch
} from "./multiplayer/roomManager.js";
import {
    findQuickMatch,
    fillBots,
    clearFromQueue,
    maybeFillBotsAfterSearch,
    allHumansReady,
    isLobbyFull,
    SEARCH_WAIT_MS
} from "./multiplayer/matchmaking.js";
import { applyRankedResult, ensureRankedProfile } from "./multiplayer/ranked.js";
import { logEvent, logMatchStart, logMatchEnd } from "./multiplayer/matchReplay.js";
import { chooseBotAction, botThinkMs } from "./game/botAI.js";
import { showAuthScreen, hideAuthScreen } from "./ui/authUI.js";
import { renderMenu, renderOnlineMenu } from "./ui/menuUI.js";
import { renderLobby, promptJoinCode } from "./ui/lobbyUI.js";
import { renderGame, destroyGameUI } from "./ui/gameUI.js";
import { renderResultsOverlay } from "./ui/resultsUI.js";
import { showNotification } from "./ui/notificationUI.js";
import { playDrawAnimation, playSpecialFx, playWinFx } from "./ui/fx.js";
import { initNetworkBanner } from "./ui/networkBanner.js";
import { openFeedbackModal } from "./ui/feedbackUI.js";
import { haptic, hapticSuccess } from "./utils/haptic.js";
import { GameManager } from "./game/gameManager.js";
import {
    initMatchOnHost,
    setSpectating,
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
import { logger } from "./utils/logger.js";

/** Pending custom rules from Rules Creator */
let pendingCustomRules = null;
/** Current match mode: casual | ranked */
let currentMatchMode = "casual";


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
    initNetworkBanner();
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
        presenceCleanup = initializePresence(user.uid, {
            onOnline: (sessionId) => {
                if (currentRoomId) {
                    markConnected(currentRoomId, user.uid, sessionId).catch(() => {});
                }
            },
            onOffline: () => {
                if (currentRoomId) {
                    markReconnecting(currentRoomId, user.uid, DEFAULT_GRACE_MS).catch(
                        () => {}
                    );
                }
            }
        });
    } catch (e) {
        logger.warn("[Boot] Presence failed:", e.message);
    }

    hideAuthScreen();
    installVisibilityGuards();

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
        onRanked: () => handleMatchmaking("ranked"),
        onOnline: showOnlineMenu,
        onProfile: showProfileInfo,
        onLeaderboard: async () => {
            const { openLeaderboardModal } = await import("./ui/leaderboardUI.js");
            openLeaderboardModal();
        },
        onFeedback: () => openFeedbackModal(document.body, { context: "menu" }),
        onSettings: () => openSettingsPanel()
    });
}

function openSettingsPanel() {
    let panel = document.getElementById("settings-panel");
    if (panel) panel.remove();
    panel = document.createElement("div");
    panel.id = "settings-panel";
    panel.className = "feedback-modal";
    const vol = sfx.getVolume?.() ?? 0.7;
    const muted = sfx.isMuted?.() ?? false;
    panel.innerHTML = `
      <div class="feedback-card" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <label class="fb-label">Volume SFX</label>
        <input type="range" id="set-vol" min="0" max="100" value="${Math.round(vol * 100)}" />
        <label class="fb-label" style="display:flex;align-items:center;gap:0.5rem;margin-top:0.75rem">
          <input type="checkbox" id="set-mute" ${muted ? "checked" : ""} /> Mute
        </label>
        <label class="fb-label" style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
          <input type="checkbox" id="set-cb" ${document.body.classList.contains("colorblind-on") ? "checked" : ""} /> Colorblind mode
        </label>
        <div class="fb-actions" style="margin-top:1rem">
          <button type="button" class="btn btn-primary" id="set-close">Tutup</button>
        </div>
        <p class="dev-credit" style="margin-top:1rem">Developed by <strong>RyzenShiky</strong></p>
      </div>`;
    document.body.appendChild(panel);
    panel.querySelector("#set-vol").oninput = (e) => {
        sfx.setVolume(Number(e.target.value) / 100);
        sfx.unlock?.();
        sfx.click?.();
    };
    panel.querySelector("#set-mute").onchange = (e) => {
        sfx.setMuted(e.target.checked);
    };
    panel.querySelector("#set-cb").onchange = (e) => {
        document.body.classList.toggle("colorblind-on", e.target.checked);
    };
    panel.querySelector("#set-close").onclick = () => panel.remove();
    panel.onclick = (e) => {
        if (e.target === panel) panel.remove();
    };
}

async function showProfileInfo() {
    if (!currentUser) return;
    try {
        const { openProfileModal } = await import("./ui/profileUI.js");
        await openProfileModal(currentUser, {
            onUpdated: (u) => {
                if (u) currentUser = u;
            }
        });
    } catch (e) {
        logger.warn(e);
        const type = isAnonymousUser(currentUser) ? "Guest" : "Google";
        const name = currentUser.displayName || currentUser.uid.slice(0, 10);
        showNotification(name + " · " + type);
    }
}

function showOnlineMenu() {
    showScreen("menu");
    renderOnlineMenu(screens.menu(), {
        onBack: startApplication,
        onQuick: () => handleMatchmaking("casual"),
        onCreate: handleCreateRoom,
        onJoin: handleJoinRoom,
        onFeedback: () => openFeedbackModal(document.body, { context: "online-menu" }),
        onRules: async () => {
            const { openRulesCreator } = await import("./ui/rulesUI.js");
            const rules = await openRulesCreator(currentUser);
            if (rules) {
                pendingCustomRules = rules;
                showNotification("Rules siap dipakai saat Create Room");
            }
        },
        onLeaderboard: async () => {
            const { openLeaderboardModal } = await import("./ui/leaderboardUI.js");
            openLeaderboardModal();
        }
    });
}

async function handleMatchmaking(mode) {
    if (!currentUser) return;
    try {
        showNotification(
            mode === "ranked"
                ? "Ranked: mencari antrean (6 pemain)…"
                : "Quick Match…"
        );
        if (mode === "ranked") await ensureRankedProfile(currentUser.uid);
        const opts = {
            mode,
            maxPlayers: mode === "ranked" ? 6 : 4,
            botFill: true,
            customRules: pendingCustomRules || undefined
        };
        const { roomId, roomCode } = await findQuickMatch(currentUser, opts);
        currentRoomId = roomId;
        currentRoomCode = roomCode;
        currentMatchMode = mode;
        enterLobby(roomId, roomCode);
    } catch (err) {
        logger.error(err);
        showNotification(err.message || "Matchmaking gagal");
    }
}

async function handleCreateRoom() {
    if (!currentUser) return;
    try {
        showNotification("Membuat room...");
        const settings = {
            maxPlayers: pendingCustomRules?.maxPlayers ?? 4,
            isPrivate: true,
            turnTimer: pendingCustomRules?.turnTimer ?? 30,
            targetScore: pendingCustomRules?.targetScore ?? 500,
            botFill: true,
            customRules: pendingCustomRules || {
                drawStacking: false,
                sevenSwap: false,
                zeroRotation: false,
                forcePlay: false,
                challengeDraw: true,
                callLastCard: true
            }
        };
        const { roomId, roomCode } = await createRoom(currentUser, settings);
        currentRoomId = roomId;
        currentRoomCode = roomCode;
        currentMatchMode = "casual";
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

let matchEntryLock = false;
let botFillTimer = null;
let autoStartLock = false;

function enterLobby(roomId, roomCode) {
    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }
    cleanupMatchSubs();
    matchEntryLock = false;
    autoStartLock = false;
    if (botFillTimer) {
        clearTimeout(botFillTimer);
        botFillTimer = null;
    }
    const gen = listenerManager.setActiveRoom(roomId);

    showScreen("lobby");
    markConnected(currentRoomId || roomId, currentUser.uid).catch(() => {});

    // Ranked/queue: host auto-isi bot setelah SEARCH_WAIT jika masih sepi
    const scheduleBotFill = (room) => {
        const isHost = room.meta?.hostId === currentUser.uid;
        const isQueue = room.meta?.matchmaking || room.meta?.mode === "ranked";
        if (!isHost || !isQueue || room.meta?.status !== "waiting") return;
        if (isLobbyFull(room)) return;
        if (botFillTimer) return;

        const started = room.meta?.searchStartedAt || Date.now();
        const waitLeft = Math.max(0, SEARCH_WAIT_MS - (Date.now() - started));
        // Ranked: jangan bilang "bot" ke pemain
        if (waitLeft > 500) {
            showNotification(`Mencari lawan… ${Math.ceil(waitLeft / 1000)}d`);
        }
        botFillTimer = setTimeout(async () => {
            botFillTimer = null;
            try {
                await maybeFillBotsAfterSearch(roomId, currentUser.uid, {
                    targetCount:
                        room.settings?.maxPlayers ??
                        (room.meta?.mode === "ranked" ? 6 : 4)
                });
            } catch (e) {
                logger.warn("[Queue] bot fill:", e.message);
            }
        }, waitLeft || 400);
    };

    const tryAutoStart = async (room) => {
        const isHost = room.meta?.hostId === currentUser.uid;
        if (!isHost || room.meta?.status !== "waiting") return;
        const isQueue = room.meta?.matchmaking || room.meta?.mode === "ranked";
        if (!isQueue && !room.settings?.autoStart) return;
        if (!isLobbyFull(room)) return;
        if (!allHumansReady(room)) return;
        if (autoStartLock) return;
        autoStartLock = true;
        try {
            showNotification("Semua siap — memulai…");
            const mode = room.meta?.mode || currentMatchMode || "casual";
            await clearFromQueue(roomId, mode);
            await startMatch(roomId, currentUser.uid);
        } catch (e) {
            autoStartLock = false;
            showNotification(e.message || "Gagal auto-start");
            logger.error(e);
        }
    };

    roomUnsubscribe = subscribeRoom(roomId, (room) => {
        if (!listenerManager.isCurrent(roomId, gen) && listenerManager.activeRoomId !== roomId) {
            return;
        }
        if (!room) {
            showNotification("Room ditutup");
            leaveCurrentRoom();
            return;
        }

        if (room.meta?.status === "playing") {
            enterMultiplayerMatch(roomId, room);
            return;
        }

        scheduleBotFill(room);
        tryAutoStart(room);

        const isHost = room.meta?.hostId === currentUser.uid;
        const isQueue = room.meta?.matchmaking || room.meta?.mode === "ranked";
        renderLobby(
            screens.lobby(),
            {
                roomCode,
                room,
                currentUid: currentUser.uid,
                isHost,
                queueMode: isQueue
            },
            {
                onLeave: leaveCurrentRoom,
                onReady: async () => {
                    const me = room.players?.[currentUser.uid];
                    await setReady(roomId, currentUser.uid, !me?.ready);
                },
                onStart: async () => {
                    try {
                        showNotification("Memulai…");
                        const mode = room.meta?.mode || currentMatchMode || "casual";
                        await clearFromQueue(roomId, mode);
                        await startMatch(roomId, currentUser.uid);
                    } catch (e) {
                        showNotification(e.message || "Gagal start");
                        logger.error(e);
                    }
                },
                onFillBots: async () => {
                    try {
                        await fillBots(roomId, currentUser.uid, room.settings?.maxPlayers ?? 4);
                        showNotification("Bot ditambahkan");
                    } catch (e) {
                        showNotification(e.message || "Gagal fill bot");
                    }
                },
                onNotify: showNotification
            }
        );
    });
    listenerManager.add(roomId, () => {
        if (roomUnsubscribe) {
            roomUnsubscribe();
            roomUnsubscribe = null;
        }
    });
}

async function leaveCurrentRoom() {
    if (chatCleanup) {
        chatCleanup();
        chatCleanup = null;
    }
    try { await leaveVoiceChannel(); } catch (_) {}
    document.getElementById("btn-mic")?.remove();
    cleanupMatchSubs();
    try { destroyGameUI(screens.game()); } catch (_) {}
    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }
    listenerManager.clearAll();
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
    try { destroyGameUI(screens.game()); } catch (_) {}
    matchUnsubs.forEach((u) => {
        try {
            u();
        } catch (_) {}
    });
    matchUnsubs = [];
    if (currentRoomId) {
        listenerManager.clear(`match:${currentRoomId}`);
    }
}

function enterMultiplayerMatch(roomId, room) {
    // Cegah double-entry (subscribe room bisa fire 2x) — ini yang bikin Agora/start gantung
    if (matchEntryLock) {
        logger.info("[Match] already entering, skip duplicate");
        return;
    }
    matchEntryLock = true;

    const playerIds = Object.keys(room.players || {});
    const isHost = room.meta?.hostId === currentUser.uid;

    showScreen("game");

    // Voice WebRTC — non-blocking, timeout di dalam joinVoiceChannel
    if (isVoiceAvailable()) {
        joinVoiceChannel(roomId, currentUser.uid)
            .then((ok) => {
                if (ok) ensureMicButton();
            })
            .catch(() => {});
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
                await logMatchStart(roomId, playerIds, room.settings);
            } catch (e) {
                logger.error(e);
                showNotification(e.message || "Gagal init match");
            }
        }

        let rankedApplied = false;
        let botTimer = null;

        const runOnlineBotIfNeeded = async (state) => {
            if (!isHost || !state || state.status !== "playing" || state.winner) return;
            const turn = state.currentTurn;
            if (!turn || !String(turn).startsWith("bot-")) return;
            if (botTimer) return;
            const botMeta = room.players?.[turn] || {};
            const diff = botMeta.botDifficulty || "normal";
            botTimer = setTimeout(async () => {
                botTimer = null;
                try {
                    const { get, ref } = await import(
                        "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
                    );
                    const { database } = await import("./firebase/services.js");
                    const handSnap = await get(
                        ref(database, `rooms/${roomId}/hands/${turn}`)
                    );
                    const botHand = handSnap.exists() ? handSnap.val() : [];
                    const oppCounts = Object.entries(state.handCounts || {})
                        .filter(([id]) => id !== turn)
                        .map(([, n]) => n);
                    const action = chooseBotAction(
                        botHand,
                        state.topCard,
                        state.currentColor,
                        diff,
                        {
                            opponentCounts: oppCounts,
                            stacking: state.stacking,
                            stackType: state.stackType
                        }
                    );
                    if (action.type === "play") {
                        await playCardOnline(roomId, turn, action.cardId, action.color);
                        logEvent(roomId, {
                            type: "play",
                            uid: turn,
                            card: { id: action.cardId, value: "?", color: action.color }
                        });
                    } else {
                        await drawCardOnline(roomId, turn);
                        logEvent(roomId, { type: "draw", uid: turn });
                    }
                } catch (e) {
                    logger.warn("[Bot] turn failed:", e.message);
                }
            }, botThinkMs(diff));
        };

        cleanupMatchSubs();
        const matchKey = `match:${roomId}`;

        let publicState = null;
        let hand = [];
        let lastRenderKey = "";

        const render = () => {
            if (!publicState) return;
            if (listenerManager.activeRoomId !== roomId) return;

            // Skip rebuild jika state visual sama — cegah kartu hilang saat hover di laptop
            const handIds = (hand || []).map((c) => c.id).join(",");
            const counts = JSON.stringify(publicState.handCounts || {});
            const renderKey = [
                publicState.currentTurn,
                publicState.currentColor,
                publicState.topCard?.id,
                publicState.topCard?.value,
                publicState.drawPileCount,
                publicState.stackAmount,
                publicState.pendingUno,
                publicState.winner,
                publicState.placements?.length,
                publicState.status,
                publicState.status,
                publicState.challenge?.type || "",
                counts,
                handIds,
                myTurnFlag(publicState)
            ].join("|");
            if (renderKey === lastRenderKey) return;
            lastRenderKey = renderKey;

            // Merge reconnect status from room.players into view
            const roomPlayers = room.players || {};
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
                    displayName:
                        roomPlayers[uid]?.displayName ||
                        (String(uid).startsWith("bot-")
                            ? "Pemain"
                            : String(uid).slice(0, 8)),
                    handCount: publicState.handCounts?.[uid] ?? 0,
                    connected: roomPlayers[uid]?.connected !== false,
                    status: roomPlayers[uid]?.status || "active",
                    isBot: !!roomPlayers[uid]?.isBot
                })),
                winner: publicState.winner,
                publicState.placements?.length,
                publicState.status,
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
                            hapticSuccess();
                        } catch (e) {
                            sfx.error();
                            showNotification(e.message);
                        }
                    },
                    onDraw: async () => {
                        try {
                            await drawCardOnline(roomId, currentUser.uid);
                            playDrawAnimation(1);
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
                    onSpectate: async (enabled) => {
                        try {
                            await setSpectating(roomId, currentUser.uid, enabled);
                            showNotification(enabled ? "Mode nonton aktif" : "Nonton nonaktif");
                        } catch (e) {
                            showNotification(e.message);
                        }
                    },
                    onQuit: async () => {
                        cleanupMatchSubs();
                        soloGame = null;
                        await leaveCurrentRoom();
                    }
                }
            );

            ensureChat();

            // Place mid-game: pemain yang sudah kosong bisa nonton; yang lain LANJUT
            const myFin = publicState.finishedPlayers?.[currentUser.uid];
            if (myFin && window.__ccPlaceToast !== myFin.place) {
                window.__ccPlaceToast = myFin.place;
                sfx.win();
                showNotification(
                    myFin.place === 1
                        ? "Juara 1 MVP! Pilih Nonton untuk saksikan yang lain."
                        : `Kamu Place ${myFin.place}!`
                );
            }

            // Podium hanya saat match benar-benar selesai (bukan saat pemenang pertama)
            if (publicState.status === "finished" && !window.__ccResultsShown) {
                window.__ccResultsShown = true;
                sfx.win();
                const winName =
                    publicState.placements?.find((x) => x.place === 1)?.name ||
                    (publicState.winner === currentUser.uid
                        ? "Kamu"
                        : String(publicState.winner || "").slice(0, 8));
                showNotification(
                    publicState.winner === currentUser.uid
                        ? "Kamu juara 1 — MVP!"
                        : `Pemenang: ${winName}`
                );
                renderResultsOverlay(screens.game(), {
                    publicState,
                    currentUid: currentUser.uid,
                    onMenu: async () => {
                        window.__ccResultsShown = false;
                        window.__ccPlaceToast = null;
                        cleanupMatchSubs();
                        await leaveCurrentRoom();
                    },
                    onReplay: async () => {
                        const { openReplayModal } = await import("./ui/replayUI.js");
                        openReplayModal(roomId);
                    }
                });
                if (isHost && !rankedApplied) {
                    rankedApplied = true;
                    const mode = room.meta?.mode || currentMatchMode;
                    logMatchEnd(roomId, publicState.winner, publicState.scores);
                    if (mode === "ranked") {
                        applyRankedResult(
                            publicState.playerIds || playerIds,
                            publicState.winner
                        ).catch((e) => logger.warn(e));
                    }
                }
            }
        };

        function myTurnFlag(state) {
            return state?.currentTurn === currentUser.uid ? "1" : "0";
        }

        // Debounce UI render — cegah kartu kedip saat hover / reconnect
        let renderTimer = null;
        const scheduleRender = () => {
            if (renderTimer) clearTimeout(renderTimer);
            renderTimer = setTimeout(() => {
                renderTimer = null;
                render();
            }, 50);
        };

        const unsubPublic = subscribePublic(roomId, (state) => {
            if (listenerManager.activeRoomId !== roomId) return;
            // Jangan wipe state dengan null sesaat (reconnect flicker)
            if (!state) {
                scheduleRender();
                return;
            }
            const prevAnim = publicState?.lastAnim?.at;
            publicState = state;
            if (state?.lastAnim?.at && state.lastAnim.at !== prevAnim) {
                showDrawPenaltyAnim(
                    state.lastAnim.n || 0,
                    state.lastAnim.uid === currentUser.uid
                );
                sfx.draw();
            }
            scheduleRender();
            resyncHandIfNeeded(state);
            runOnlineBotIfNeeded(state);
        });
        const unsubHand = subscribeHand(roomId, currentUser.uid, (h) => {
            if (listenerManager.activeRoomId !== roomId) return;
            if (Array.isArray(h)) {
                // Terima hand dari server; jangan buang data valid
                if (h.length > 0) {
                    hand = h;
                } else {
                    // Hanya kosongkan jika handCounts juga 0 (benar-benar habis)
                    const cnt = publicState?.handCounts?.[currentUser.uid];
                    if (cnt === 0 || cnt === undefined) {
                        // cnt undefined = belum ada public state; jangan hapus hand lama
                        if (cnt === 0) hand = [];
                    }
                }
            }
            scheduleRender();
        });

        // Jika public bilang punya N kartu tapi hand lokal kosong → fetch sekali
        async function resyncHandIfNeeded(state) {
            const expected = state?.handCounts?.[currentUser.uid];
            if (expected == null || expected <= 0) return;
            if ((hand || []).length >= expected) return;
            try {
                const { get, ref } = await import(
                    "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js"
                );
                const { database } = await import("./firebase/services.js");
                const snap = await get(
                    ref(database, `rooms/${roomId}/hands/${currentUser.uid}`)
                );
                if (snap.exists() && Array.isArray(snap.val()) && snap.val().length) {
                    hand = snap.val();
                    scheduleRender();
                    logger.info("[Hand] resync", hand.length);
                }
            } catch (e) {
                logger.warn("[Hand] resync failed:", e.message);
            }
        }
        matchUnsubs.push(unsubPublic, unsubHand);
        listenerManager.add(matchKey, unsubPublic);
        listenerManager.add(matchKey, unsubHand);
    };

    boot();
}

/**
 * Tab hidden / laptop sleep TIDAK boleh leave room.
 * Hanya heartbeat & status soft.
 */
function installVisibilityGuards() {
    if (window.__ccVisibilityInstalled) return;
    window.__ccVisibilityInstalled = true;

    document.addEventListener("visibilitychange", () => {
        if (!currentRoomId || !currentUser) return;
        if (document.visibilityState === "hidden") {
            // Soft: mark reconnecting only if connection actually drops (presence handles that)
            logger.info("[UI] Tab hidden — tetap di room, tidak leave");
        } else if (document.visibilityState === "visible") {
            // Restore connection flag when tab back
            markConnected(currentRoomId, currentUser.uid).catch(() => {});
            logger.info("[UI] Tab visible — restore connected");
        }
    });

    // pagehide/unload: biarkan Firebase onDisconnect yang handle; jangan leaveRoom di sini
    window.addEventListener("pagehide", () => {
        logger.info("[UI] pagehide — onDisconnect akan handle presence");
    });
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
    const action = chooseBotAction(hand, soloGame.topCard, soloGame.currentColor, "tactical");
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
