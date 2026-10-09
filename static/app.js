// Danbal Roulette Manager App
document.addEventListener("DOMContentLoaded", () => {
    const DEFAULT_STREAMERS = [
        { id: 1, name: "체온(여왕)", keywords: "체플,체온플,체온,ㅊㅍ,체,ㅊㅇ,온플", minus_keywords: "", color: "#ec4899", order_index: 1, is_pinned: 0 },
        { id: 2, name: "은채(개돼지)", keywords: "은플,은채플,ㅇㅍ,은채,은,은채핑", minus_keywords: "", color: "#3b82f6", order_index: 2, is_pinned: 0 },
        { id: 3, name: "단발", keywords: "단발,조정간,ㄷㅂ,단발이", minus_keywords: "", color: "#10b981", order_index: 3, is_pinned: 0 }
    ];

    // Helper functions for localStorage persistence
    function loadStoredStreamers() {
        try {
            const stored = localStorage.getItem("danbal_streamers");
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        return JSON.parse(JSON.stringify(DEFAULT_STREAMERS));
    }

    function saveStreamersToStorage() {
        try {
            localStorage.setItem("danbal_streamers", JSON.stringify(state.streamers));
        } catch (e) {}
    }

    function loadStoredAlerts() {
        try {
            const stored = localStorage.getItem("danbal_alerts");
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}
        return [];
    }

    function saveAlertsToStorage() {
        try {
            localStorage.setItem("danbal_alerts", JSON.stringify(state.alerts));
        } catch (e) {}
    }

    function loadStoredSettings() {
        try {
            const stored = localStorage.getItem("danbal_settings");
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return {};
    }

    function saveSettingsToStorage() {
        try {
            localStorage.setItem("danbal_settings", JSON.stringify({
                broadcast_active: state.status.broadcast_active,
                broadcast_started_at: state.status.broadcast_started_at,
                current_round: state.status.current_round,
                round_name: state.status.round_name,
                show_zero_streamers: state.showZero,
                show_total: state.showTotal
            }));
        } catch (e) {}
    }

    const savedSettings = loadStoredSettings();

    let state = {
        streamers: loadStoredStreamers(),
        alerts: loadStoredAlerts(),
        status: {
            broadcast_active: savedSettings.broadcast_active === true || savedSettings.broadcast_active === "true",
            broadcast_started_at: savedSettings.broadcast_started_at || "",
            elapsed: "00:00:00",
            seoul_time: "",
            current_round: parseInt(savedSettings.current_round) || 1,
            round_name: savedSettings.round_name || "1라운드"
        },
        summary: {
            current_round: parseInt(savedSettings.current_round) || 1,
            round_name: savedSettings.round_name || "1라운드",
            streamers: [],
            total: { count: 0, balloons: 0, current_score: 0, total_score: 0 }
        },
        externalScore: {
            connected: false,
            last_sync_time: "",
            streamers: {},
            total_balloons: 0,
            total_score: 0
        },
        showZero: savedSettings.show_zero_streamers !== false && savedSettings.show_zero_streamers !== "false",
        showTotal: savedSettings.show_total !== false && savedSettings.show_total !== "false",
        manualSign: "+"
    };

    let ws = null;

    // --- DOM Elements ---
    const flabsStatusPill = document.getElementById("flabs-status-pill");
    const flabsStatusText = document.getElementById("flabs-status-text");
    const btnBroadcastToggle = document.getElementById("btn-broadcast-toggle");
    const broadcastStatusText = document.getElementById("broadcast-status-text");
    const broadcastTimerBadge = document.getElementById("broadcast-timer-badge");
    const broadcastElapsedTimer = document.getElementById("broadcast-elapsed-timer");
    const currentSeoulTime = document.getElementById("current-seoul-time");
    const btnResetContribution = document.getElementById("btn-reset-contribution");
    const roundNameInput = document.getElementById("round-name-input");
    const chkShowZero = document.getElementById("chk-show-zero");
    const chkShowTotal = document.getElementById("chk-show-total");
    const streamerCardsContainer = document.getElementById("streamer-cards-container");
    const alertsTbody = document.getElementById("alerts-tbody");
    const btnClearExamples = document.getElementById("btn-clear-examples");

    // Manual Row elements
    const manualNowBadge = document.getElementById("manual-now-badge");
    const manualId = document.getElementById("manual-id");
    const manualNickname = document.getElementById("manual-nickname");
    const manualChat = document.getElementById("manual-chat");
    const manualStreamer = document.getElementById("manual-streamer");
    const manualBalloons = document.getElementById("manual-balloons");
    const manualSignBtn = document.getElementById("manual-sign-btn");
    const manualContribVal = document.getElementById("manual-contrib-val");
    const manualMultiplier = document.getElementById("manual-multiplier");
    const manualMemo = document.getElementById("manual-memo");
    const btnManualAdd = document.getElementById("btn-manual-add");

    // Modals
    const btnOpenStreamers = document.getElementById("btn-open-streamers");
    const btnCloseStreamers = document.getElementById("btn-close-streamers");
    const modalStreamers = document.getElementById("modal-streamers");
    const streamersTableBody = document.getElementById("streamers-table-body");
    const newStreamerName = document.getElementById("new-streamer-name");
    const newStreamerKeywords = document.getElementById("new-streamer-keywords");
    const newStreamerColor = document.getElementById("new-streamer-color");
    const btnAddStreamerSubmit = document.getElementById("btn-add-streamer-submit");

    const btnOpenSync = document.getElementById("btn-open-sync");
    const btnCloseSync = document.getElementById("btn-close-sync");
    const modalSync = document.getElementById("modal-sync");

    const btnExportExcel = document.getElementById("btn-export-excel");
    const btnSaveProject = document.getElementById("btn-save-project");
    const btnLoadProject = document.getElementById("btn-load-project");
    const projectFileInput = document.getElementById("project-file-input");
    const btnClearAll = document.getElementById("btn-clear-all");
    const btnScrollBottom = document.getElementById("btn-scroll-bottom");

    // --- Helpers: Time and Parsing ---
    function getSeoulTimeStr() {
        const now = new Date();
        const seoulOffset = 9 * 60;
        const localOffset = now.getTimezoneOffset();
        const seoulDate = new Date(now.getTime() + (seoulOffset + localOffset) * 60000);
        const y = seoulDate.getFullYear();
        const m = String(seoulDate.getMonth() + 1).padStart(2, '0');
        const d = String(seoulDate.getDate()).padStart(2, '0');
        const hh = String(seoulDate.getHours()).padStart(2, '0');
        const mm = String(seoulDate.getMinutes()).padStart(2, '0');
        const ss = String(seoulDate.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
    }

    function formatElapsed(startedAtStr) {
        if (!startedAtStr) return "00:00:00";
        try {
            const parts = startedAtStr.split(/[- :]/);
            if (parts.length < 6) return "00:00:00";
            const start = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3] - 9, parts[4], parts[5]));
            const now = new Date();
            const diffMs = now.getTime() - start.getTime();
            if (diffMs < 0) return "00:00:00";
            const totSec = Math.floor(diffMs / 1000);
            const h = Math.floor(totSec / 3600);
            const m = Math.floor((totSec % 3600) / 60);
            const s = totSec % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } catch {
            return "00:00:00";
        }
    }

    function parseRouletteResult(text) {
        if (!text) {
            return { has_roulette: false, raw: "", percent: "", sign: "+", value: 0 };
        }
        text = text.trim();
        const percentMatch = text.match(/\(\s*([\d\.]+%?)\s*\)/);
        let percentStr = percentMatch ? percentMatch[1] : "";
        if (percentStr && !percentStr.endsWith("%")) percentStr += "%";

        const rem = text.replace(/\(\s*[\d\.]+%?\s*\)/, "").trim();
        const isKkwang = rem.includes("꽝");
        const minusMatch = rem.match(/-\s*([\d,]+)/);
        const plusMatch = rem.match(/\+?\s*([\d,]+)/);

        if (isKkwang) {
            return { has_roulette: true, raw: text, percent: percentStr, sign: "꽝", value: 0 };
        } else if (minusMatch) {
            const val = parseInt(minusMatch[1].replace(/,/g, "")) || 0;
            return { has_roulette: true, raw: text, percent: percentStr, sign: "-", value: -val };
        } else if (plusMatch && plusMatch[1]) {
            const val = parseInt(plusMatch[1].replace(/,/g, "")) || 0;
            return { has_roulette: true, raw: text, percent: percentStr, sign: "+", value: val };
        }
        return { has_roulette: !!percentStr, raw: text, percent: percentStr, sign: "+", value: 0 };
    }

    function matchStreamerByChat(chat, streamers) {
        if (!chat) return "선택";
        chat = chat.trim();
        let lastMatch = null;
        let lastIdx = -1;

        for (const s of streamers) {
            const rawKw = s.keywords || "";
            const kwList = rawKw.split(",").map(k => k.trim()).filter(Boolean);
            const baseName = s.name.split("(")[0].trim();
            if (baseName && !kwList.includes(baseName)) kwList.push(baseName);

            for (const kw of kwList) {
                if (!kw) continue;
                if (kw.length === 1) {
                    if (chat === kw || chat.includes(` ${kw} `) || chat.startsWith(`${kw} `) || chat.endsWith(` ${kw}`)) {
                        const idx = chat.lastIndexOf(kw);
                        if (idx >= lastIdx) {
                            lastIdx = idx;
                            lastMatch = s.name;
                        }
                    }
                } else {
                    const idx = chat.lastIndexOf(kw);
                    if (idx !== -1 && idx >= lastIdx) {
                        lastIdx = idx;
                        lastMatch = s.name;
                    }
                }
            }
        }
        return lastMatch || "선택";
    }

    function computeSummary() {
        const curRound = parseInt(state.status.current_round) || 1;
        const rname = state.status.round_name || `${curRound}라운드`;

        const streamerStats = {};
        (state.streamers || []).forEach(s => {
            streamerStats[s.name] = {
                name: s.name,
                color: s.color || "#3b82f6",
                count: 0,
                balloons: 0,
                current_score: 0,
                total_score: 0
            };
        });

        let totalBalloons = 0;
        let totalCurrentScore = 0;
        let totalAllScore = 0;
        let totalCount = 0;

        const activeAlerts = (state.alerts || []).filter(a => a.status === 'active' && !a.is_example);
        activeAlerts.forEach(a => {
            const sName = a.streamer_name;
            const val = parseInt(a.roulette_value) || 0;
            const balloons = parseInt(a.balloons) || 0;
            const alertRound = parseInt(a.round_number) || 1;

            totalBalloons += balloons;
            totalAllScore += val;
            totalCount += 1;
            if (alertRound === curRound) {
                totalCurrentScore += val;
            }

            if (sName && sName !== "선택") {
                if (!streamerStats[sName]) {
                    streamerStats[sName] = {
                        name: sName,
                        color: "#64748b",
                        count: 0,
                        balloons: 0,
                        current_score: 0,
                        total_score: 0
                    };
                }
                streamerStats[sName].count += 1;
                streamerStats[sName].balloons += balloons;
                streamerStats[sName].total_score += val;
                if (alertRound === curRound) {
                    streamerStats[sName].current_score += val;
                }
            }
        });

        return {
            current_round: curRound,
            round_name: rname,
            streamers: Object.values(streamerStats),
            total: {
                count: totalCount,
                balloons: totalBalloons,
                current_score: totalCurrentScore,
                total_score: totalAllScore
            }
        };
    }

    // --- Client-side Interval Timer (ticks every second regardless of WebSocket) ---
    setInterval(() => {
        const seoulStr = getSeoulTimeStr();
        if (currentSeoulTime) {
            currentSeoulTime.innerText = seoulStr;
        }
        if (state.status.broadcast_active && state.status.broadcast_started_at) {
            const elapsed = formatElapsed(state.status.broadcast_started_at);
            state.status.elapsed = elapsed;
            if (broadcastElapsedTimer) {
                broadcastElapsedTimer.innerText = elapsed;
            }
        }
    }, 1000);

    // --- WebSocket Connection ---
    function initWebSocket() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log("[WebSocket] Connected");
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleWsMessage(msg);
                } catch (err) {
                    console.error("[WebSocket] Parse error", err);
                }
            };

            ws.onerror = () => {
                // Ignore WebSocket errors in environments that do not support it (e.g. Vercel)
            };

            ws.onclose = () => {
                setTimeout(initWebSocket, 5000);
            };
        } catch (e) {
            console.warn("WebSocket not supported in this environment");
        }
    }

    function handleWsMessage(msg) {
        switch (msg.type) {
            case "TICK":
                if (broadcastElapsedTimer && state.status.broadcast_active) {
                    broadcastElapsedTimer.innerText = msg.elapsed;
                }
                if (currentSeoulTime) {
                    currentSeoulTime.innerText = msg.seoul_time;
                }
                break;
            case "NEW_ALERT":
                if (!state.alerts.some(a => a.id === msg.data.id || (a.external_id && a.external_id === msg.data.external_id))) {
                    state.alerts.unshift(msg.data);
                    saveAlertsToStorage();
                    renderAlerts();
                    refreshSummary();
                }
                break;
            case "UPDATE_ALERT":
                const idx = state.alerts.findIndex(a => a.id === msg.data.id);
                if (idx !== -1) {
                    state.alerts[idx] = msg.data;
                    saveAlertsToStorage();
                    renderAlerts();
                    refreshSummary();
                }
                break;
            case "DELETE_ALERT":
                state.alerts = state.alerts.filter(a => a.id !== msg.id);
                saveAlertsToStorage();
                renderAlerts();
                refreshSummary();
                break;
            case "CLEAR_ALERTS":
                state.alerts = [];
                saveAlertsToStorage();
                renderAlerts();
                refreshSummary();
                break;
            case "CLEAR_EXAMPLES":
                state.alerts = state.alerts.filter(a => a.is_example !== 1);
                saveAlertsToStorage();
                renderAlerts();
                refreshSummary();
                showToast("✅ 예시 데이터가 모두 삭제되었습니다.");
                break;
            case "CONTRIBUTION_RESET":
                state.status.current_round = msg.new_round;
                state.status.round_name = msg.round_name;
                if (roundNameInput) roundNameInput.value = msg.round_name;
                saveSettingsToStorage();
                refreshSummary();
                showToast(`🔄 [${msg.round_name}] 시작! 현재 기여도가 0으로 초기화되었습니다.`);
                break;
            case "ROUND_UPDATED":
                if (msg.data.round_name && roundNameInput) {
                    roundNameInput.value = msg.data.round_name;
                    state.status.round_name = msg.data.round_name;
                    saveSettingsToStorage();
                    refreshSummary();
                }
                break;
            case "STREAMERS_CHANGED":
                loadStreamers();
                break;
            case "EXTERNAL_SCORE_UPDATE":
                state.externalScore = msg.data;
                updateFlabsIndicator();
                renderScoreboard();
                break;
            case "STATUS_CHANGE":
                state.status.broadcast_active = msg.data.broadcast_active;
                state.status.broadcast_started_at = msg.data.broadcast_started_at;
                saveSettingsToStorage();
                updateBroadcastUI();
                break;
        }
    }

    // --- Data Loaders ---
    async function loadStatus() {
        chkShowZero.checked = state.showZero;
        chkShowTotal.checked = state.showTotal;
        if (roundNameInput) roundNameInput.value = state.status.round_name || `${state.status.current_round || 1}라운드`;
        updateBroadcastUI();

        try {
            const res = await fetch("/api/status");
            if (res.ok) {
                const data = await res.json();
                state.status = data;
                state.showZero = data.show_zero_streamers;
                state.showTotal = data.show_total;
                chkShowZero.checked = state.showZero;
                chkShowTotal.checked = state.showTotal;
                if (roundNameInput) roundNameInput.value = data.round_name || `${data.current_round || 1}라운드`;
                saveSettingsToStorage();
                updateBroadcastUI();
            }
        } catch (e) {
            console.warn("Load status using local storage", e);
        }
    }

    async function loadStreamers() {
        // Initial render from local state
        renderStreamerDropdowns();
        renderStreamersManageTable();
        refreshSummary();

        try {
            const res = await fetch("/api/streamers");
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    state.streamers = data;
                    saveStreamersToStorage();
                    renderStreamerDropdowns();
                    renderStreamersManageTable();
                    refreshSummary();
                }
            }
        } catch (e) {
            console.warn("Load streamers using local storage", e);
        }
    }

    async function loadAlerts() {
        renderAlerts();
        refreshSummary();

        try {
            const res = await fetch("/api/alerts");
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    state.alerts = data;
                    saveAlertsToStorage();
                    renderAlerts();
                    refreshSummary();
                }
            }
        } catch (e) {
            console.warn("Load alerts using local storage", e);
        }
    }

    async function refreshSummary() {
        // Compute and render immediately from local state
        state.summary = computeSummary();
        renderScoreboard();

        try {
            const res = await fetch("/api/summary");
            if (res.ok) {
                state.summary = await res.json();
                renderScoreboard();
            }
        } catch (e) {}
    }

    async function checkExternalScore() {
        try {
            const res = await fetch("/api/external_score");
            if (res.ok) {
                state.externalScore = await res.json();
                updateFlabsIndicator();
                renderScoreboard();
            }
        } catch (e) {}
    }

    function updateFlabsIndicator() {
        if (!flabsStatusPill || !flabsStatusText) return;
        if (!state.externalScore || !state.externalScore.connected) {
            flabsStatusPill.className = "flabs-status-pill";
            flabsStatusPill.innerHTML = '<i class="fa-solid fa-scale-balanced"></i> <span>점수판 대기중</span>';
            flabsStatusPill.title = "score.flabs.kr 점수판 창을 로그인해서 열어두시면 실시간 자동 비교됩니다.";
            return;
        }

        let hasMismatch = false;
        const useNet = state.externalScore.baseline_active;
        const extStreamers = (useNet && state.externalScore.net_streamers) ? state.externalScore.net_streamers : (state.externalScore.streamers || {});

        state.summary.streamers.forEach(s => {
            const matchedKey = Object.keys(extStreamers).find(k =>
                k.toLowerCase() === s.name.toLowerCase() ||
                k.includes(s.name) ||
                s.name.includes(k)
            );
            if (matchedKey) {
                const ext = extStreamers[matchedKey];
                const ourScore = s.current_score || 0;
                const extScore = ext.score !== undefined ? ext.score : null;
                const ourBalloons = s.balloons || 0;
                const extBalloons = ext.balloons !== undefined ? ext.balloons : null;

                if ((extScore !== null && ourScore !== extScore) || (extBalloons !== null && ourBalloons !== extBalloons)) {
                    hasMismatch = true;
                }
            }
        });

        const modeText = useNet ? "방송시작후 증감 비교" : "전체점수 비교";

        if (hasMismatch) {
            flabsStatusPill.className = "flabs-status-pill mismatch-detected";
            flabsStatusPill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>점수판 불일치! (${modeText})</span>`;
            flabsStatusPill.title = "점수판(score.flabs.kr)과 숫자가 다른 스트리머가 있습니다! 빨간색 카드를 확인하세요.";
        } else {
            flabsStatusPill.className = "flabs-status-pill connected";
            flabsStatusPill.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>점수판 일치 (${modeText})</span>`;
            flabsStatusPill.title = "score.flabs.kr 점수판과 모든 스트리머 점수가 일치합니다.";
        }
    }

    // --- UI Renderers ---
    function updateBroadcastUI() {
        if (state.status.broadcast_active) {
            btnBroadcastToggle.classList.add("running");
            btnBroadcastToggle.innerHTML = '<i class="fa-solid fa-stop"></i> <span>종료</span>';
            broadcastTimerBadge.classList.remove("hide");
            broadcastElapsedTimer.innerText = formatElapsed(state.status.broadcast_started_at);
        } else {
            btnBroadcastToggle.classList.remove("running");
            btnBroadcastToggle.innerHTML = '<i class="fa-solid fa-play"></i> <span>시작</span>';
            broadcastTimerBadge.classList.add("hide");
        }
    }

    function renderStreamerDropdowns() {
        const optionsHtml = ['<option value="선택">선택</option>']
            .concat(state.streamers.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`))
            .join("");

        if (manualStreamer) {
            manualStreamer.innerHTML = optionsHtml;
        }
    }

    function renderScoreboard() {
        if (!streamerCardsContainer) return;
        streamerCardsContainer.innerHTML = "";

        const extConnected = state.externalScore && state.externalScore.connected;
        const useNet = state.externalScore && state.externalScore.baseline_active;
        const extStreamers = (useNet && state.externalScore.net_streamers) ? state.externalScore.net_streamers : ((state.externalScore && state.externalScore.streamers) || {});

        state.summary.streamers.forEach(s => {
            if (!state.showZero && s.current_score === 0 && s.balloons === 0) {
                return;
            }

            const card = document.createElement("div");
            card.className = "streamer-card";
            card.style.borderTopColor = s.color || "#3b82f6";

            const curScore = s.current_score || 0;
            const scoreClass = curScore < 0 ? "score-negative" : "score-positive";
            const scoreSign = curScore > 0 ? "+" : "";

            const totScore = s.total_score || 0;
            const totSign = totScore > 0 ? "+" : "";

            let mismatchHtml = "";
            let isMismatch = false;

            if (extConnected) {
                const matchedKey = Object.keys(extStreamers).find(k =>
                    k.toLowerCase() === s.name.toLowerCase() ||
                    k.includes(s.name) ||
                    s.name.includes(k)
                );

                if (matchedKey) {
                    const ext = extStreamers[matchedKey];
                    const extScore = ext.score !== undefined ? ext.score : null;
                    const extBalloons = ext.balloons !== undefined ? ext.balloons : null;

                    const scoreDiff = (extScore !== null) ? (curScore - extScore) : 0;
                    const balloonDiff = (extBalloons !== null) ? (s.balloons - extBalloons) : 0;

                    const scoreMismatch = (extScore !== null && extScore !== curScore);
                    const balloonMismatch = (extBalloons !== null && extBalloons !== s.balloons);

                    if (scoreMismatch || balloonMismatch) {
                        isMismatch = true;
                        card.classList.add("has-mismatch");
                        mismatchHtml = `
                            <div class="comparison-diff-box">
                                <div class="diff-row">
                                    <span class="diff-title">점수판 비교(${useNet ? '시작후' : '전체'}):</span>
                                    <span class="mismatch-badge"><i class="fa-solid fa-triangle-exclamation"></i> 불일치</span>
                                </div>
                                ${scoreMismatch ? `
                                <div class="diff-row">
                                    <span class="diff-title">기여도 차이:</span>
                                    <span class="diff-val-mismatch">점수판: ${extScore.toLocaleString()} (차이: ${scoreDiff > 0 ? '+' : ''}${scoreDiff.toLocaleString()})</span>
                                </div>` : `
                                <div class="diff-row">
                                    <span class="diff-title">기여도:</span>
                                    <span class="diff-val-match">일치 (${curScore.toLocaleString()})</span>
                                </div>`}
                                ${balloonMismatch ? `
                                <div class="diff-row">
                                    <span class="diff-title">풍 차이:</span>
                                    <span class="diff-val-mismatch">점수판: ${extBalloons.toLocaleString()}개 (차이: ${balloonDiff > 0 ? '+' : ''}${balloonDiff.toLocaleString()})</span>
                                </div>` : ''}
                            </div>
                        `;
                    }
                }
            }

            card.innerHTML = `
                <div class="card-top">
                    <span class="streamer-card-name" style="color: ${isMismatch ? '#b91c1c' : (s.color || '#0f172a')}">
                        ${escapeHtml(s.name)}
                        ${isMismatch ? '<span class="mismatch-badge" style="margin-left:4px;">불일치!</span>' : ''}
                    </span>
                    <span class="streamer-card-count">${s.count}건</span>
                </div>
                <div class="card-middle">
                    <span class="score-label-sub">현재 기여도</span>
                    <span class="streamer-card-score ${scoreClass}">
                        ${scoreSign}${curScore.toLocaleString()}
                    </span>
                </div>
                <div class="card-bottom">
                    <span class="total-score-badge">누적: ${totSign}${totScore.toLocaleString()}</span>
                    <span class="balloons-badge-card">${s.balloons.toLocaleString()}개 풍</span>
                </div>
                ${mismatchHtml}
            `;
            streamerCardsContainer.appendChild(card);
        });

        if (state.showTotal) {
            const tot = state.summary.total;
            const card = document.createElement("div");
            card.className = "streamer-card total-card";

            const curTot = tot.current_score || 0;
            const scoreClass = curTot < 0 ? "score-negative" : "score-positive";
            const scoreSign = curTot > 0 ? "+" : "";

            const allTot = tot.total_score || 0;
            const allSign = allTot > 0 ? "+" : "";

            let totalMismatchHtml = "";
            let isTotalMismatch = false;

            const extTotalScore = useNet ? state.externalScore.net_total_score : state.externalScore.total_score;
            const extTotalBalloons = useNet ? state.externalScore.net_total_balloons : state.externalScore.total_balloons;

            if (extConnected && extTotalScore !== undefined) {
                const scoreDiff = curTot - extTotalScore;
                const balloonDiff = tot.balloons - extTotalBalloons;

                const scoreMismatch = (extTotalScore !== curTot);
                const balloonMismatch = (extTotalBalloons !== tot.balloons);

                if (scoreMismatch || balloonMismatch) {
                    isTotalMismatch = true;
                    card.classList.add("has-mismatch");
                    totalMismatchHtml = `
                        <div class="comparison-diff-box">
                            <div class="diff-row">
                                <span class="diff-title">점수판 총합 비교(${useNet ? '시작후' : '전체'}):</span>
                                <span class="mismatch-badge"><i class="fa-solid fa-triangle-exclamation"></i> 총합 불일치</span>
                            </div>
                            ${scoreMismatch ? `
                            <div class="diff-row">
                                <span class="diff-title">총 기여도:</span>
                                <span class="diff-val-mismatch">점수판: ${extTotalScore.toLocaleString()} (차이: ${scoreDiff > 0 ? '+' : ''}${scoreDiff.toLocaleString()})</span>
                            </div>` : ''}
                            ${balloonMismatch ? `
                            <div class="diff-row">
                                <span class="diff-title">총 풍개수:</span>
                                <span class="diff-val-mismatch">점수판: ${extTotalBalloons.toLocaleString()}개 (차이: ${balloonDiff > 0 ? '+' : ''}${balloonDiff.toLocaleString()})</span>
                            </div>` : ''}
                        </div>
                    `;
                }
            }

            card.innerHTML = `
                <div class="card-top">
                    <span class="streamer-card-name" style="color: ${isTotalMismatch ? '#b91c1c' : '#4338ca'}">
                        ⭐ 전체 총합
                        ${isTotalMismatch ? '<span class="mismatch-badge" style="margin-left:4px;">불일치!</span>' : ''}
                    </span>
                    <span class="streamer-card-count">${tot.count}건</span>
                </div>
                <div class="card-middle">
                    <span class="score-label-sub">현재 라운드 총 기여도</span>
                    <span class="streamer-card-score ${scoreClass}">
                        ${scoreSign}${curTot.toLocaleString()}
                    </span>
                </div>
                <div class="card-bottom">
                    <span class="total-score-badge">누적: ${allSign}${allTot.toLocaleString()}</span>
                    <span class="balloons-badge-card">${tot.balloons.toLocaleString()}개 풍</span>
                </div>
                ${totalMismatchHtml}
            `;
            streamerCardsContainer.appendChild(card);
        }
    }

    function renderAlerts() {
        if (!alertsTbody) return;
        alertsTbody.innerHTML = "";

        const hasExamples = state.alerts.some(a => a.is_example === 1);
        if (btnClearExamples) {
            if (hasExamples) {
                btnClearExamples.classList.remove("hide");
            } else {
                btnClearExamples.classList.add("hide");
            }
        }

        const streamerOptionsList = ['<option value="선택">선택</option>']
            .concat(state.streamers.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`));

        state.alerts.forEach((alert) => {
            const tr = document.createElement("tr");
            tr.dataset.id = alert.id;
            if (alert.status === "canceled") {
                tr.classList.add("row-canceled");
            }
            if (alert.is_example === 1) {
                tr.classList.add("row-example");
            }

            const isMinus = alert.roulette_sign === "-" || alert.roulette_value < 0;
            const signChar = isMinus ? "-" : "+";
            const absVal = Math.abs(alert.roulette_value || 0);

            let streamerOptions = streamerOptionsList.map(opt => {
                if (alert.streamer_name && opt.includes(`value="${escapeHtml(alert.streamer_name)}"`)) {
                    return opt.replace('value=', 'selected value=');
                }
                return opt;
            }).join("");

            const isEx = alert.is_example === 1;

            tr.innerHTML = `
                <td class="td-time">
                    <div class="time-box">
                        <span class="time-elapsed">${alert.broadcast_elapsed || '미시작'}</span>
                        <span class="time-seoul">${alert.created_at || ''}</span>
                    </div>
                </td>
                <td class="td-id">
                    ${isEx ? '<span class="example-badge-tag">[예시]</span>' : ''}
                    <input type="text" class="table-input alert-id-input" data-id="${alert.id}" value="${escapeHtml(alert.user_id || '')}">
                </td>
                <td class="td-nickname">
                    ${isEx ? '<span class="example-badge-tag">[예시]</span>' : ''}
                    <input type="text" class="table-input alert-nickname-input" data-id="${alert.id}" value="${escapeHtml(alert.nickname || '')}">
                </td>
                <td class="td-chat">
                    <div class="chat-box">
                        ${alert.roulette_raw ? `
                            <span class="roulette-badge">
                                <i class="fa-solid fa-dice"></i> 룰렛: ${escapeHtml(alert.roulette_raw)}
                            </span>
                        ` : ''}
                        <input type="text" class="table-input alert-chat-input" data-id="${alert.id}" value="${escapeHtml(alert.chat_message || '')}">
                    </div>
                </td>
                <td class="td-streamer">
                    <select class="table-select alert-streamer-select" data-id="${alert.id}">
                        ${streamerOptions}
                    </select>
                </td>
                <td class="td-balloons">
                    <input type="number" class="table-input text-right font-bold alert-balloons-input" data-id="${alert.id}" value="${alert.balloons || 0}">
                </td>
                <td class="td-contrib">
                    <div class="contrib-input-group">
                        <button type="button" class="btn-sign-toggle ${isMinus ? 'minus' : 'plus'} btn-toggle-alert-sign" data-id="${alert.id}">
                            ${signChar}
                        </button>
                        <input type="number" class="table-input contrib-val font-bold alert-contrib-input" data-id="${alert.id}" value="${absVal}">
                    </div>
                </td>
                <td class="td-multiplier">
                    <select class="table-select alert-multiplier-select" data-id="${alert.id}">
                        <option value="기본배수" ${alert.multiplier === '기본배수' ? 'selected' : ''}>기본배수</option>
                        <option value="원플원" ${alert.multiplier === '원플원' ? 'selected' : ''}>원플원</option>
                        <option value="2배" ${alert.multiplier === '2배' ? 'selected' : ''}>2배</option>
                        <option value="3배" ${alert.multiplier === '3배' ? 'selected' : ''}>3배</option>
                        <option value="5배" ${alert.multiplier === '5배' ? 'selected' : ''}>5배</option>
                    </select>
                </td>
                <td class="td-memo">
                    <input type="text" class="table-input alert-memo-input" data-id="${alert.id}" value="${escapeHtml(alert.memo || '')}" placeholder="메모">
                </td>
                <td class="td-action">
                    <button class="btn-cancel-donation ${alert.status === 'canceled' ? 'btn-restore-donation' : ''} btn-toggle-cancel" data-id="${alert.id}">
                        ${alert.status === 'canceled' ? '복원' : '취소'}
                    </button>
                </td>
            `;

            alertsTbody.appendChild(tr);
        });

        attachRowEventListeners();
    }

    function attachRowEventListeners() {
        document.querySelectorAll(".alert-id-input").forEach(el => {
            el.onblur = (e) => {
                const id = e.target.dataset.id;
                updateAlertField(id, { user_id: e.target.value.trim() });
            };
        });

        document.querySelectorAll(".alert-nickname-input").forEach(el => {
            el.onblur = (e) => {
                const id = e.target.dataset.id;
                updateAlertField(id, { nickname: e.target.value.trim() });
            };
        });

        document.querySelectorAll(".alert-chat-input").forEach(el => {
            el.onblur = (e) => {
                const id = e.target.dataset.id;
                updateAlertField(id, { chat_message: e.target.value.trim() });
            };
        });

        document.querySelectorAll(".alert-streamer-select").forEach(el => {
            el.onchange = (e) => {
                const id = e.target.dataset.id;
                updateAlertField(id, { streamer_name: e.target.value });
            };
        });

        document.querySelectorAll(".alert-balloons-input").forEach(el => {
            el.onblur = (e) => {
                const id = e.target.dataset.id;
                const bVal = parseInt(e.target.value) || 0;
                updateAlertField(id, { balloons: bVal });
            };
        });

        document.querySelectorAll(".btn-toggle-alert-sign").forEach(el => {
            el.onclick = (e) => {
                const id = el.dataset.id;
                const alert = state.alerts.find(a => a.id == id);
                if (!alert) return;
                const newSign = alert.roulette_sign === "-" ? "+" : "-";
                const absVal = Math.abs(alert.roulette_value || 0);
                const newVal = newSign === "-" ? -absVal : absVal;
                updateAlertField(id, { roulette_sign: newSign, roulette_value: newVal });
            };
        });

        document.querySelectorAll(".alert-contrib-input").forEach(el => {
            el.onblur = (e) => {
                const id = e.target.dataset.id;
                const alert = state.alerts.find(a => a.id == id);
                if (!alert) return;
                const absVal = Math.abs(parseInt(e.target.value) || 0);
                const isMinus = alert.roulette_sign === "-" || alert.roulette_value < 0;
                const newVal = isMinus ? -absVal : absVal;
                updateAlertField(id, { roulette_value: newVal });
            };
        });

        document.querySelectorAll(".alert-multiplier-select").forEach(el => {
            el.onchange = (e) => {
                const id = e.target.dataset.id;
                updateAlertField(id, { multiplier: e.target.value });
            };
        });

        document.querySelectorAll(".alert-memo-input").forEach(el => {
            el.onblur = (e) => {
                const id = e.target.dataset.id;
                updateAlertField(id, { memo: e.target.value });
            };
        });

        document.querySelectorAll(".btn-toggle-cancel").forEach(el => {
            el.onclick = (e) => {
                const id = el.dataset.id;
                const alert = state.alerts.find(a => a.id == id);
                if (!alert) return;
                const newStatus = alert.status === "canceled" ? "active" : "canceled";
                updateAlertField(id, { status: newStatus });
            };
        });
    }

    async function updateAlertField(id, payload) {
        const idx = state.alerts.findIndex(a => a.id == id);
        if (idx !== -1) {
            Object.assign(state.alerts[idx], payload);
            saveAlertsToStorage();
            renderAlerts();
            refreshSummary();
        }

        try {
            await fetch(`/api/alerts/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (e) {}
    }

    // --- Streamers & Keywords Management ---
    function renderStreamersManageTable() {
        if (!streamersTableBody) return;
        streamersTableBody.innerHTML = "";

        state.streamers.forEach((s, idx) => {
            const tr = document.createElement("tr");
            tr.dataset.id = s.id;

            const kwList = [s.name.split('(')[0].trim()].concat((s.keywords || '').split(',')).map(k => k.trim()).filter((v, i, a) => v && a.indexOf(v) === i);

            const plusChipsHtml = kwList.map(kw => `
                <span class="kw-chip">
                    ${escapeHtml(kw)}
                    <span class="kw-chip-del btn-del-kw" data-id="${s.id}" data-kw="${escapeHtml(kw)}">&times;</span>
                </span>
            `).join("");

            tr.innerHTML = `
                <td class="text-center font-bold text-gray">${idx + 1}</td>
                <td>
                    <input type="text" class="modal-input w-full font-bold streamer-edit-name" data-id="${s.id}" value="${escapeHtml(s.name)}">
                </td>
                <td>
                    <div class="kw-chips-container">
                        ${plusChipsHtml}
                        <input type="text" class="kw-add-input" placeholder="+입력 (Enter)" data-id="${s.id}">
                    </div>
                </td>
                <td class="text-center">
                    <input type="color" class="modal-color-input streamer-edit-color" data-id="${s.id}" value="${s.color || '#3b82f6'}">
                </td>
                <td class="text-center">
                    <button class="btn-pill btn-save btn-sm btn-save-streamer" data-id="${s.id}">저장</button>
                    <button class="btn-pill btn-danger btn-sm btn-del-streamer" data-id="${s.id}">삭제</button>
                </td>
            `;

            streamersTableBody.appendChild(tr);
        });

        attachStreamerTableEvents();
    }

    function attachStreamerTableEvents() {
        document.querySelectorAll(".btn-save-streamer").forEach(btn => {
            btn.onclick = async () => {
                const id = btn.dataset.id;
                const tr = btn.closest("tr");
                const name = tr.querySelector(".streamer-edit-name").value.trim();
                const color = tr.querySelector(".streamer-edit-color").value;

                if (!name) return alert("스트리머 이름을 입력해주세요.");

                const s = state.streamers.find(x => x.id == id);
                if (!s) return;
                const oldName = s.name;
                s.name = name;
                s.color = color;

                if (oldName !== name) {
                    state.alerts.forEach(a => {
                        if (a.streamer_name === oldName) a.streamer_name = name;
                    });
                    saveAlertsToStorage();
                    renderAlerts();
                }

                saveStreamersToStorage();
                renderStreamerDropdowns();
                renderStreamersManageTable();
                refreshSummary();
                showToast(`✅ [${name}] 설정이 저장되었습니다.`);

                try {
                    await fetch(`/api/streamers/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, color })
                    });
                } catch (e) {}
            };
        });

        document.querySelectorAll(".btn-del-streamer").forEach(btn => {
            btn.onclick = async () => {
                const id = btn.dataset.id;
                if (confirm("이 스트리머를 삭제하시겠습니까?")) {
                    state.streamers = state.streamers.filter(x => x.id != id);
                    saveStreamersToStorage();
                    renderStreamerDropdowns();
                    renderStreamersManageTable();
                    refreshSummary();
                    showToast("🗑️ 스트리머가 삭제되었습니다.");

                    try {
                        await fetch(`/api/streamers/${id}`, { method: "DELETE" });
                    } catch (e) {}
                }
            };
        });

        document.querySelectorAll(".kw-add-input").forEach(input => {
            input.onkeydown = async (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const newKw = input.value.trim();
                    if (!newKw) return;
                    const id = input.dataset.id;
                    const s = state.streamers.find(x => x.id == id);
                    if (!s) return;

                    const curList = (s.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
                    if (!curList.includes(newKw)) curList.push(newKw);
                    const updatedKw = curList.join(',');
                    s.keywords = updatedKw;
                    saveStreamersToStorage();
                    input.value = "";
                    renderStreamersManageTable();
                    showToast(`✅ 키워드 '${newKw}' 추가 완료`);

                    try {
                        await fetch(`/api/streamers/${id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ keywords: updatedKw })
                        });
                    } catch (e) {}
                }
            };
        });

        document.querySelectorAll(".btn-del-kw").forEach(delBtn => {
            delBtn.onclick = async () => {
                const id = delBtn.dataset.id;
                const kw = delBtn.dataset.kw;
                const s = state.streamers.find(x => x.id == id);
                if (!s) return;

                const curList = (s.keywords || '').split(',').map(k => k.trim()).filter(k => k && k !== kw);
                const updatedKw = curList.join(',');
                s.keywords = updatedKw;
                saveStreamersToStorage();
                renderStreamersManageTable();
                showToast(`🗑️ 키워드 '${kw}' 삭제 완료`);

                try {
                    await fetch(`/api/streamers/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ keywords: updatedKw })
                    });
                } catch (e) {}
            };
        });
    }

    // --- Actions ---
    btnBroadcastToggle.onclick = async () => {
        const newActive = !state.status.broadcast_active;
        state.status.broadcast_active = newActive;
        state.status.broadcast_started_at = newActive ? getSeoulTimeStr() : "";
        state.status.elapsed = "00:00:00";
        saveSettingsToStorage();
        updateBroadcastUI();
        showToast(newActive ? "▶️ 방송이 시작되었습니다." : "⏹️ 방송이 종료되었습니다.");

        try {
            const res = await fetch("/api/broadcast/toggle", { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                state.status.broadcast_active = data.broadcast_active;
                state.status.broadcast_started_at = data.broadcast_started_at;
                saveSettingsToStorage();
                updateBroadcastUI();
            }
        } catch (e) {}
    };

    if (roundNameInput) {
        const saveRoundName = async () => {
            const val = roundNameInput.value.trim();
            if (!val) return;
            state.status.round_name = val;
            saveSettingsToStorage();
            refreshSummary();
            showToast(`✅ 라운드 이름이 [${val}]로 변경되었습니다.`);

            try {
                await fetch("/api/round/update", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ round_name: val })
                });
            } catch (e) {}
        };

        roundNameInput.onblur = saveRoundName;
        roundNameInput.onkeydown = (e) => {
            if (e.key === "Enter") {
                roundNameInput.blur();
            }
        };
    }

    if (btnClearExamples) {
        btnClearExamples.onclick = async () => {
            if (confirm("테스트용 [예시] 데이터를 모두 삭제하시겠습니까?")) {
                state.alerts = state.alerts.filter(a => a.is_example !== 1);
                saveAlertsToStorage();
                renderAlerts();
                refreshSummary();
                showToast("✅ 예시 데이터가 모두 삭제되었습니다.");

                try {
                    await fetch("/api/alerts/clear-examples", { method: "POST" });
                } catch (e) {}
            }
        };
    }

    btnResetContribution.onclick = async () => {
        if (confirm("⚠️ 스트리머들의 현재 기여도를 0으로 초기화하시겠습니까?\n\n(이전 모든 후원 기록과 누적 총합 기여도, 풍 개수는 안전하게 유지됩니다)")) {
            const newRound = (parseInt(state.status.current_round) || 1) + 1;
            const newRoundName = `${newRound}라운드`;
            state.status.current_round = newRound;
            state.status.round_name = newRoundName;
            if (roundNameInput) roundNameInput.value = newRoundName;
            saveSettingsToStorage();
            refreshSummary();
            showToast(`🔄 [${newRoundName}] 시작! 현재 기여도가 0으로 초기화되었습니다.`);

            try {
                await fetch("/api/contribution/reset", { method: "POST" });
            } catch (e) {}
        }
    };

    if (manualSignBtn) {
        manualSignBtn.onclick = () => {
            state.manualSign = state.manualSign === "+" ? "-" : "+";
            manualSignBtn.innerText = state.manualSign;
            manualSignBtn.className = `btn-sign-toggle ${state.manualSign === '+' ? 'plus' : 'minus'}`;
        };
    }

    if (btnManualAdd) {
        btnManualAdd.onclick = async () => {
            const id = manualId.value.trim();
            const nickname = manualNickname.value.trim() || id;
            const chat = manualChat.value.trim();
            let streamer = manualStreamer.value;
            const balloons = parseInt(manualBalloons.value) || 0;
            const absContrib = parseInt(manualContribVal.value) || 0;
            const contrib = state.manualSign === "-" ? -absContrib : absContrib;
            const multiplier = manualMultiplier.value;
            const memo = manualMemo.value.trim();

            if (!id && !chat && balloons === 0 && absContrib === 0) {
                alert("아이디 또는 채팅, 풍 개수/기여도를 입력해주세요.");
                return;
            }

            if (!streamer || streamer === "선택") {
                streamer = matchStreamerByChat(chat, state.streamers);
            }

            const parsed = parseRouletteResult(chat);
            let finalContrib = contrib;
            if (absContrib === 0 && parsed.value !== 0) {
                finalContrib = parsed.value;
            }
            const finalSign = finalContrib < 0 ? "-" : "+";

            const seoulTime = getSeoulTimeStr();
            const elapsed = state.status.broadcast_active ? formatElapsed(state.status.broadcast_started_at) : "미시작";
            const curRound = parseInt(state.status.current_round) || 1;

            const newAlert = {
                id: Date.now(),
                external_id: `manual_${Date.now()}`,
                platform: "SOOP",
                created_at: seoulTime,
                broadcast_elapsed: elapsed,
                user_id: id,
                nickname: nickname,
                balloons: balloons,
                chat_message: chat,
                roulette_raw: parsed.raw || (absContrib ? `${state.manualSign}${absContrib}` : ""),
                roulette_percent: parsed.percent || "",
                roulette_sign: finalSign,
                roulette_value: finalContrib,
                streamer_name: streamer,
                multiplier: multiplier,
                contribution: finalContrib,
                memo: memo,
                status: "active",
                round_number: curRound,
                is_example: 0
            };

            state.alerts.unshift(newAlert);
            saveAlertsToStorage();

            manualId.value = "";
            manualNickname.value = "";
            manualChat.value = "";
            manualBalloons.value = "";
            manualContribVal.value = "";
            manualMemo.value = "";

            renderAlerts();
            refreshSummary();
            showToast("✅ 후원 내역이 추가되었습니다.");

            try {
                const res = await fetch("/api/alerts/ingest", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        user_id: id,
                        nickname: nickname,
                        balloons: balloons,
                        chat_message: chat,
                        roulette_result: newAlert.roulette_raw,
                        contribution: finalContrib,
                        streamer_name: streamer !== "선택" ? streamer : null,
                        multiplier: multiplier,
                        memo: memo,
                        is_example: 0
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.alert && data.alert.id) {
                        newAlert.id = data.alert.id;
                        saveAlertsToStorage();
                    }
                }
            } catch (e) {}
        };
    }

    // --- Streamer Add Submit (Key Fix for User Request) ---
    btnAddStreamerSubmit.onclick = async () => {
        const name = newStreamerName.value.trim();
        const keywords = newStreamerKeywords.value.trim();
        const color = newStreamerColor.value || "#3b82f6";

        if (!name) {
            alert("스트리머 이름을 입력해주세요.");
            return;
        }

        if (state.streamers.some(s => s.name.trim().toLowerCase() === name.toLowerCase())) {
            alert("이미 등록된 스트리머 이름입니다.");
            return;
        }

        const newStreamer = {
            id: Date.now(),
            name: name,
            keywords: keywords,
            minus_keywords: "",
            color: color,
            order_index: state.streamers.length + 1,
            is_pinned: 0
        };

        // Always add to state and save to localStorage immediately!
        state.streamers.push(newStreamer);
        saveStreamersToStorage();

        newStreamerName.value = "";
        newStreamerKeywords.value = "";

        renderStreamerDropdowns();
        renderStreamersManageTable();
        refreshSummary();
        showToast(`✅ 스트리머 [${name}] 등록 완료!`);

        // Sync with backend if available
        try {
            const res = await fetch("/api/streamers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, keywords, color })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.id) {
                    newStreamer.id = data.id;
                    saveStreamersToStorage();
                    renderStreamersManageTable();
                }
            }
        } catch (e) {
            console.warn("Backend offline or error, kept in local storage", e);
        }
    };

    chkShowZero.onchange = (e) => {
        state.showZero = e.target.checked;
        saveSettingsToStorage();
        renderScoreboard();
        fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ show_zero_streamers: state.showZero })
        }).catch(() => {});
    };

    chkShowTotal.onchange = (e) => {
        state.showTotal = e.target.checked;
        saveSettingsToStorage();
        renderScoreboard();
        fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ show_total: state.showTotal })
        }).catch(() => {});
    };

    // Excel Export (Dual Mode: Server API with Client-side SheetJS Fallback)
    btnExportExcel.onclick = async () => {
        // Try server API first if running locally
        try {
            const testRes = await fetch("/api/status");
            if (testRes.ok) {
                window.location.href = "/api/export/excel";
                return;
            }
        } catch (e) {}

        // Fallback: Generate Excel directly in the browser via SheetJS
        if (typeof XLSX === "undefined") {
            alert("엑셀 생성 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
            return;
        }

        const wb = XLSX.utils.book_new();

        // 1. 후원목록 시트
        const donationRows = [
            ['ID', '시간', '방송시간', '닉네임', '아이디', '후원스트리머', '풍선종류', '개수', '기여도', '원플원', '채팅']
        ];
        const activeAlerts = state.alerts.filter(a => a.status === 'active' && !a.is_example);
        activeAlerts.forEach(a => {
            donationRows.push([
                a.id,
                a.created_at || '',
                a.broadcast_elapsed || '',
                a.nickname || '',
                a.user_id || '',
                a.streamer_name || '',
                '별풍선',
                a.balloons || 0,
                a.roulette_value || 0,
                a.multiplier || '기본배수',
                a.chat_message || ''
            ]);
        });
        const wsAll = XLSX.utils.aoa_to_sheet(donationRows);
        XLSX.utils.book_append_sheet(wb, wsAll, '후원목록');

        // 2. 스트리머별 통계 시트
        const statsRows = [
            ['순위', '스트리머', '후원 건수', '총 별풍선 (개)', '현재 라운드 기여도', '누적 총 기여도']
        ];
        const sum = computeSummary();
        sum.streamers.forEach((s, idx) => {
            statsRows.push([
                idx + 1,
                s.name,
                s.count,
                s.balloons,
                s.current_score,
                s.total_score
            ]);
        });
        statsRows.push([
            '총합',
            '전체 합계',
            sum.total.count,
            sum.total.balloons,
            sum.total.current_score,
            sum.total.total_score
        ]);
        const wsStats = XLSX.utils.aoa_to_sheet(statsRows);
        XLSX.utils.book_append_sheet(wb, wsStats, '스트리머별 통계');

        const fileName = `danbal_roulette_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
        showToast("📊 엑셀 파일이 다운로드되었습니다.");
    };

    // Project Save (Download JSON backup)
    if (btnSaveProject) {
        btnSaveProject.onclick = () => {
            const backupData = {
                version: "1.0",
                exported_at: getSeoulTimeStr(),
                streamers: state.streamers,
                alerts: state.alerts,
                settings: {
                    broadcast_active: state.status.broadcast_active,
                    broadcast_started_at: state.status.broadcast_started_at,
                    current_round: state.status.current_round,
                    round_name: state.status.round_name,
                    show_zero_streamers: state.showZero,
                    show_total: state.showTotal
                }
            };
            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const nowStr = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "_");
            a.download = `danbal_project_backup_${nowStr}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("💾 프로젝트 데이터 백업 파일이 다운로드되었습니다.");
        };
    }

    // Project Load (Upload JSON backup)
    if (btnLoadProject && projectFileInput) {
        btnLoadProject.onclick = () => {
            projectFileInput.value = "";
            projectFileInput.click();
        };

        projectFileInput.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            if (!confirm(`[${file.name}] 프로젝트 파일을 불러오시겠습니까?\n현재 화면의 데이터가 파일의 내용으로 복원됩니다.`)) {
                return;
            }

            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data.streamers || !data.alerts) {
                    alert("잘못된 프로젝트 파일 형식입니다.");
                    return;
                }

                state.streamers = data.streamers;
                state.alerts = data.alerts;
                if (data.settings) {
                    state.status.current_round = parseInt(data.settings.current_round) || 1;
                    state.status.round_name = data.settings.round_name || `${state.status.current_round}라운드`;
                    state.status.broadcast_active = data.settings.broadcast_active === true || data.settings.broadcast_active === "true";
                    state.status.broadcast_started_at = data.settings.broadcast_started_at || "";
                    state.showZero = data.settings.show_zero_streamers !== false && data.settings.show_zero_streamers !== "false";
                    state.showTotal = data.settings.show_total !== false && data.settings.show_total !== "false";
                    chkShowZero.checked = state.showZero;
                    chkShowTotal.checked = state.showTotal;
                    if (roundNameInput) roundNameInput.value = state.status.round_name;
                }
                saveStreamersToStorage();
                saveAlertsToStorage();
                saveSettingsToStorage();
                renderStreamerDropdowns();
                renderStreamersManageTable();
                renderAlerts();
                refreshSummary();
                updateBroadcastUI();
                showToast(`✅ 프로젝트 복원 성공! (스트리머: ${state.streamers.length}명, 후원: ${state.alerts.length}건)`);

                // Also sync with backend if available
                const formData = new FormData();
                formData.append("file", file);
                fetch("/api/project/import", { method: "POST", body: formData }).catch(() => {});
            } catch (err) {
                console.error("Project import error", err);
                alert("프로젝트 파일을 읽는 중 오류가 발생했습니다.");
            }
        };
    }

    btnClearAll.onclick = async () => {
        if (confirm("정말로 모든 후원 내역을 영구 초기화하시겠습니까? (되돌릴 수 없습니다)")) {
            state.alerts = [];
            saveAlertsToStorage();
            renderAlerts();
            refreshSummary();
            showToast("🗑️ 모든 후원 내역이 삭제되었습니다.");
            try {
                await fetch("/api/alerts/clear", { method: "POST" });
            } catch (e) {}
        }
    };

    btnScrollBottom.onclick = () => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    };

    btnOpenStreamers.onclick = () => modalStreamers.classList.remove("hide");
    btnCloseStreamers.onclick = () => modalStreamers.classList.add("hide");

    btnOpenSync.onclick = () => modalSync.classList.remove("hide");
    btnCloseSync.onclick = () => modalSync.classList.add("hide");

    window.onclick = (e) => {
        if (e.target === modalStreamers) modalStreamers.classList.add("hide");
        if (e.target === modalSync) modalSync.classList.add("hide");
    };

    function escapeHtml(text) {
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showToast(msg) {
        const toast = document.createElement("div");
        toast.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: #1e293b;
            color: #ffffff;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 700;
            z-index: 3000;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            border: 1px solid #3b82f6;
        `;
        toast.innerText = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    // --- Init ---
    initWebSocket();
    loadStatus();
    loadStreamers();
    loadAlerts();
    checkExternalScore();
    setInterval(checkExternalScore, 3000);
});
