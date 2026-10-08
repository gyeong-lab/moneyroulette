// Danbal Roulette Manager App
document.addEventListener("DOMContentLoaded", () => {
    let state = {
        streamers: [],
        alerts: [],
        status: {
            broadcast_active: false,
            broadcast_started_at: "",
            elapsed: "00:00:00",
            seoul_time: "",
            current_round: 1,
            round_name: "1라운드"
        },
        summary: {
            current_round: 1,
            round_name: "1라운드",
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
        showZero: true,
        showTotal: true,
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

    // --- WebSocket Connection ---
    function initWebSocket() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws`;

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

        ws.onclose = () => {
            setTimeout(initWebSocket, 2000);
        };
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
                state.alerts.unshift(msg.data);
                renderAlerts();
                refreshSummary();
                break;
            case "UPDATE_ALERT":
                const idx = state.alerts.findIndex(a => a.id === msg.data.id);
                if (idx !== -1) {
                    state.alerts[idx] = msg.data;
                    renderAlerts();
                    refreshSummary();
                }
                break;
            case "DELETE_ALERT":
                state.alerts = state.alerts.filter(a => a.id !== msg.id);
                renderAlerts();
                refreshSummary();
                break;
            case "CLEAR_ALERTS":
                state.alerts = [];
                renderAlerts();
                refreshSummary();
                break;
            case "CLEAR_EXAMPLES":
                state.alerts = state.alerts.filter(a => a.is_example !== 1);
                renderAlerts();
                refreshSummary();
                showToast("✅ 예시 데이터가 모두 삭제되었습니다.");
                break;
            case "CONTRIBUTION_RESET":
                state.status.current_round = msg.new_round;
                state.status.round_name = msg.round_name;
                if (roundNameInput) roundNameInput.value = msg.round_name;
                refreshSummary();
                showToast(`🔄 [${msg.round_name}] 시작! 현재 기여도가 0으로 초기화되었습니다.`);
                break;
            case "ROUND_UPDATED":
                if (msg.data.round_name && roundNameInput) {
                    roundNameInput.value = msg.data.round_name;
                    state.status.round_name = msg.data.round_name;
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
                updateBroadcastUI();
                break;
        }
    }

    // --- Data Loaders ---
    async function loadStatus() {
        try {
            const res = await fetch("/api/status");
            const data = await res.json();
            state.status = data;
            state.showZero = data.show_zero_streamers;
            state.showTotal = data.show_total;
            chkShowZero.checked = state.showZero;
            chkShowTotal.checked = state.showTotal;
            if (roundNameInput) roundNameInput.value = data.round_name || `${data.current_round || 1}라운드`;
            updateBroadcastUI();
        } catch (e) {
            console.error("Load status error", e);
        }
    }

    async function loadStreamers() {
        try {
            const res = await fetch("/api/streamers");
            state.streamers = await res.json();
            renderStreamerDropdowns();
            renderStreamersManageTable();
            refreshSummary();
        } catch (e) {
            console.error("Load streamers error", e);
        }
    }

    async function loadAlerts() {
        try {
            const res = await fetch("/api/alerts");
            state.alerts = await res.json();
            renderAlerts();
            refreshSummary();
        } catch (e) {
            console.error("Load alerts error", e);
        }
    }

    async function refreshSummary() {
        try {
            const res = await fetch("/api/summary");
            state.summary = await res.json();
            renderScoreboard();
        } catch (e) {
            console.error("Refresh summary error", e);
        }
    }

    async function checkExternalScore() {
        try {
            const res = await fetch("/api/external_score");
            state.externalScore = await res.json();
            updateFlabsIndicator();
            renderScoreboard();
        } catch (e) {
            console.error("Check external score error", e);
        }
    }

    function updateFlabsIndicator() {
        if (!flabsStatusPill || !flabsStatusText) return;
        if (!state.externalScore || !state.externalScore.connected) {
            flabsStatusPill.className = "flabs-status-pill";
            flabsStatusPill.innerHTML = '<i class="fa-solid fa-scale-balanced"></i> <span>점수판 대기중</span>';
            flabsStatusPill.title = "score.flabs.kr 점수판 창을 로그인해서 열어두시면 실시간 자동 비교됩니다.";
            return;
        }

        // Check if there are any mismatches using net values (since broadcast start)
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
                // Compare score or balloons
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
            broadcastElapsedTimer.innerText = state.status.elapsed || "00:00:00";
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

        manualStreamer.innerHTML = optionsHtml;
    }

    function renderScoreboard() {
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

            // Comparison with external score.flabs.kr
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
                    <span class="streamer-card-name">🏆 총합 (전체) ${isTotalMismatch ? '<span class="mismatch-badge">불일치</span>' : ''}</span>
                    <span class="streamer-card-count">${tot.count}건</span>
                </div>
                <div class="card-middle">
                    <span class="score-label-sub">현재 기여도 총합</span>
                    <span class="streamer-card-score ${scoreClass}">
                        ${scoreSign}${curTot.toLocaleString()}
                    </span>
                </div>
                <div class="card-bottom">
                    <span class="total-score-badge">전체 누적: ${allSign}${allTot.toLocaleString()}</span>
                    <span class="balloons-badge-card">총 ${tot.balloons.toLocaleString()}개 풍</span>
                </div>
                ${totalMismatchHtml}
            `;
            streamerCardsContainer.appendChild(card);
        }
    }

    function renderAlerts() {
        alertsTbody.innerHTML = "";

        const hasExamples = state.alerts.some(a => a.is_example === 1);
        if (btnClearExamples) {
            if (hasExamples) btnClearExamples.classList.remove("hide");
            else btnClearExamples.classList.add("hide");
        }

        state.alerts.forEach(alert => {
            const tr = document.createElement("tr");
            const isEx = alert.is_example === 1;
            tr.className = `alert-row ${alert.status === 'canceled' ? 'canceled' : ''} ${isEx ? 'is-example' : ''}`;
            tr.dataset.id = alert.id;

            const streamerOptions = ['<option value="선택">선택</option>']
                .concat(state.streamers.map(s => {
                    const sel = s.name === alert.streamer_name ? "selected" : "";
                    return `<option value="${escapeHtml(s.name)}" ${sel}>${escapeHtml(s.name)}</option>`;
                })).join("");

            const isMinus = alert.roulette_sign === "-" || alert.roulette_value < 0;
            const signChar = isMinus ? "-" : "+";
            const absVal = Math.abs(alert.roulette_value || 0);

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
        try {
            const res = await fetch(`/api/alerts/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const updated = await res.json();
                const idx = state.alerts.findIndex(a => a.id == id);
                if (idx !== -1) {
                    state.alerts[idx] = updated;
                    renderAlerts();
                    refreshSummary();
                }
            }
        } catch (e) {
            console.error("Update alert error", e);
        }
    }

    // --- Streamers & Keywords Management (Clean single keywords column) ---
    function renderStreamersManageTable() {
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

                await fetch(`/api/streamers/${id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, color })
                });
                showToast(`✅ [${name}] 설정이 저장되었습니다.`);
                loadStreamers();
            };
        });

        document.querySelectorAll(".btn-del-streamer").forEach(btn => {
            btn.onclick = async () => {
                const id = btn.dataset.id;
                if (confirm("이 스트리머를 삭제하시겠습니까?")) {
                    await fetch(`/api/streamers/${id}`, { method: "DELETE" });
                    loadStreamers();
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
                    await fetch(`/api/streamers/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ keywords: updatedKw })
                    });
                    input.value = "";
                    loadStreamers();
                    showToast(`✅ 키워드 '${newKw}' 추가 완료`);
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
                await fetch(`/api/streamers/${id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ keywords: curList.join(',') })
                });
                loadStreamers();
                showToast(`🗑️ 키워드 '${kw}' 삭제 완료`);
            };
        });
    }

    // --- Actions ---
    btnBroadcastToggle.onclick = async () => {
        try {
            const res = await fetch("/api/broadcast/toggle", { method: "POST" });
            const data = await res.json();
            state.status.broadcast_active = data.broadcast_active;
            state.status.broadcast_started_at = data.broadcast_started_at;
            updateBroadcastUI();
        } catch (e) {
            console.error("Broadcast toggle error", e);
        }
    };

    if (roundNameInput) {
        const saveRoundName = async () => {
            const val = roundNameInput.value.trim();
            if (!val) return;
            try {
                await fetch("/api/round/update", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ round_name: val })
                });
                showToast(`✅ 라운드 이름이 [${val}]로 변경되었습니다.`);
            } catch (e) {
                console.error("Round update error", e);
            }
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
                try {
                    await fetch("/api/alerts/clear-examples", { method: "POST" });
                } catch (e) {
                    console.error("Clear examples error", e);
                }
            }
        };
    }

    btnResetContribution.onclick = async () => {
        if (confirm("⚠️ 스트리머들의 현재 기여도를 0으로 초기화하시겠습니까?\n\n(이전 모든 후원 기록과 누적 총합 기여도, 풍 개수는 안전하게 유지됩니다)")) {
            try {
                await fetch("/api/contribution/reset", { method: "POST" });
            } catch (e) {
                console.error("Contribution reset error", e);
            }
        }
    };

    manualSignBtn.onclick = () => {
        state.manualSign = state.manualSign === "+" ? "-" : "+";
        manualSignBtn.innerText = state.manualSign;
        manualSignBtn.className = `btn-sign-toggle ${state.manualSign === '+' ? 'plus' : 'minus'}`;
    };

    btnManualAdd.onclick = async () => {
        const id = manualId.value.trim();
        const nickname = manualNickname.value.trim() || id;
        const chat = manualChat.value.trim();
        const streamer = manualStreamer.value;
        const balloons = parseInt(manualBalloons.value) || 0;
        const absContrib = parseInt(manualContribVal.value) || 0;
        const contrib = state.manualSign === "-" ? -absContrib : absContrib;
        const multiplier = manualMultiplier.value;
        const memo = manualMemo.value.trim();

        if (!id && !chat && balloons === 0 && absContrib === 0) {
            alert("아이디 또는 채팅, 풍 개수/기여도를 입력해주세요.");
            return;
        }

        const payload = {
            user_id: id,
            nickname: nickname,
            balloons: balloons,
            chat_message: chat,
            roulette_result: absContrib ? `${state.manualSign}${absContrib}` : "",
            contribution: contrib,
            streamer_name: streamer !== "선택" ? streamer : null,
            multiplier: multiplier,
            memo: memo,
            is_example: 0
        };

        try {
            const res = await fetch("/api/alerts/ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                manualId.value = "";
                manualNickname.value = "";
                manualChat.value = "";
                manualBalloons.value = "";
                manualContribVal.value = "";
                manualMemo.value = "";
            }
        } catch (e) {
            console.error("Manual add error", e);
        }
    };

    btnAddStreamerSubmit.onclick = async () => {
        const name = newStreamerName.value.trim();
        const keywords = newStreamerKeywords.value.trim();
        const color = newStreamerColor.value;

        if (!name) {
            alert("스트리머 이름을 입력해주세요.");
            return;
        }

        try {
            const res = await fetch("/api/streamers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, keywords, color })
            });
            if (res.ok) {
                newStreamerName.value = "";
                newStreamerKeywords.value = "";
                loadStreamers();
                showToast(`✅ 스트리머 [${name}] 등록 완료!`);
            }
        } catch (e) {
            console.error("Add streamer error", e);
        }
    };

    chkShowZero.onchange = (e) => {
        state.showZero = e.target.checked;
        fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ show_zero_streamers: state.showZero })
        });
        renderScoreboard();
    };

    chkShowTotal.onchange = (e) => {
        state.showTotal = e.target.checked;
        fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ show_total: state.showTotal })
        });
        renderScoreboard();
    };

    btnExportExcel.onclick = () => {
        window.location.href = "/api/export/excel";
    };

    // Project Save (Download JSON backup)
    if (btnSaveProject) {
        btnSaveProject.onclick = () => {
            window.location.href = "/api/project/export";
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

            const formData = new FormData();
            formData.append("file", file);

            try {
                const res = await fetch("/api/project/import", {
                    method: "POST",
                    body: formData
                });
                const result = await res.json();
                if (res.ok) {
                    showToast(`✅ 프로젝트 복원 성공! (스트리머: ${result.streamers_count}명, 후원: ${result.alerts_count}건)`);
                    loadStatus();
                    loadStreamers();
                    loadAlerts();
                } else {
                    alert(`프로젝트 불러오기 실패: ${result.error || '파일 형식 오류'}`);
                }
            } catch (err) {
                console.error("Project import error", err);
                alert("프로젝트 파일을 읽는 중 오류가 발생했습니다.");
            }
        };
    }

    btnClearAll.onclick = async () => {
        if (confirm("정말로 모든 후원 내역을 영구 초기화하시겠습니까? (되돌릴 수 없습니다)")) {
            await fetch("/api/alerts/clear", { method: "POST" });
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
