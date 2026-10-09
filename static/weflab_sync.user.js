// ==UserScript==
// @name         단발 용돈룰렛 위플랩 및 점수판(score.flabs.kr) 통합 실시간 자동 연동
// @namespace    https://moneyroulette-excp.vercel.app/
// @version      3.0
// @description  weflab.com 알림 자동 수집 및 score.flabs.kr 점수판 실시간 비교 동기화 (Vercel 웹 배포 및 로컬 완벽 지원)
// @author       danbal
// @match        *://*.weflab.com/*
// @match        *://score.flabs.kr/*
// @connect      moneyroulette-excp.vercel.app
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @allFrames    true
// ==/UserScript==

(function() {
    'use strict';

    const currentHost = window.location.hostname;
    const isWeflab = currentHost.includes("weflab.com");
    const isScoreFlabs = currentHost.includes("score.flabs.kr");

    function getTargetHost() {
        if (typeof GM_getValue === "function") {
            const val = GM_getValue("danbal_target_host");
            if (val) return val;
        }
        try {
            const val = localStorage.getItem("danbal_target_host");
            if (val) return val;
        } catch (e) {}
        return "https://moneyroulette-excp.vercel.app";
    }

    function setTargetHost(val) {
        if (typeof GM_setValue === "function") {
            GM_setValue("danbal_target_host", val);
        }
        try {
            localStorage.setItem("danbal_target_host", val);
        } catch (e) {}
    }

    // ==========================================
    // 1. WEFLAB ALERT RECORDING SYNC (weflab.com)
    // ==========================================
    if (isWeflab) {
        initWeflabSync();
    }

    // ==========================================
    // 2. SCORE.FLABS.KR LIVE SCORE COMPARISON
    // ==========================================
    if (isScoreFlabs) {
        initScoreFlabsSync();
    }

    // ------------------------------------------
    // WEFLAB IMPLEMENTATION
    // ------------------------------------------
    function initWeflabSync() {
        const processedHashes = new Set();
        let sentCount = 0;

        // Avoid duplicate badges in iframes
        if (document.getElementById('danbal-sync-badge')) return;

        const currentTarget = getTargetHost();

        const badge = document.createElement('div');
        badge.id = 'danbal-sync-badge';
        badge.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            background: #1e293b;
            color: #ffffff;
            padding: 12px 16px;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.45);
            font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Pretendard", "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            border: 2px solid #3b82f6;
            min-width: 280px;
        `;
        badge.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="display:flex; align-items:center; gap:8px; font-weight:800;">
                    <span id="danbal-indicator" style="width:10px; height:10px; border-radius:50%; background:#10b981; display:inline-block; box-shadow:0 0 6px #10b981;"></span>
                    <span>위플랩 실시간 기록 v3.0</span>
                </div>
                <span id="danbal-sync-count" style="background:#2563eb; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:bold;">0건 전송</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; background:#0f172a; padding:6px 8px; border-radius:6px; font-size:11px;">
                <span style="color:#94a3b8; white-space:nowrap;">전송 대상:</span>
                <select id="danbal-target-select" style="background:#1e293b; color:#fff; border:1px solid #475569; border-radius:4px; font-size:11px; padding:2px 4px; flex:1; cursor:pointer;">
                    <option value="https://moneyroulette-excp.vercel.app">Vercel (웹 배포)</option>
                    <option value="http://localhost:8000">로컬 (localhost:8000)</option>
                </select>
            </div>
            <div id="danbal-last-info" style="font-size:11px; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">새 알림 발생 시 0.1초 내 자동 전송됩니다.</div>
            <div style="display:flex; gap:6px; margin-top:2px;">
                <button id="danbal-manual-btn" style="flex:1; background:#2563eb; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">전체 수동전송</button>
                <button id="danbal-ping-btn" style="background:#475569; color:#fff; border:none; padding:6px 8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;" title="서버 연결 확인">연결확인</button>
                <a id="danbal-dash-link" href="${currentTarget}" target="_blank" style="background:#334155; color:#fff; text-decoration:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:bold; display:flex; align-items:center;">대시보드</a>
            </div>
        `;
        document.body.appendChild(badge);

        const targetSelect = document.getElementById('danbal-target-select');
        if (targetSelect) {
            targetSelect.value = currentTarget.includes("localhost") ? "http://localhost:8000" : "https://moneyroulette-excp.vercel.app";
            targetSelect.addEventListener('change', () => {
                const newTarget = targetSelect.value;
                setTargetHost(newTarget);
                const dashLink = document.getElementById('danbal-dash-link');
                if (dashLink) dashLink.href = newTarget;
                testPing(newTarget);
            });
        }

        const updateCount = (alertData) => {
            const el = document.getElementById('danbal-sync-count');
            if (el) el.innerText = `${sentCount}건 전송`;
            const infoEl = document.getElementById('danbal-last-info');
            if (infoEl && alertData) {
                const nick = alertData.nickname || "후원";
                const b = alertData.balloons ? `${alertData.balloons}개` : "";
                const r = alertData.roulette_result ? ` [${alertData.roulette_result}]` : "";
                infoEl.innerHTML = `<span style="color:#60a5fa;">최근:</span> ${nick} ${b}${r}`;
            }
        };

        function setIndicator(color, titleText) {
            const ind = document.getElementById('danbal-indicator');
            if (ind) {
                ind.style.background = color;
                ind.style.boxShadow = `0 0 6px ${color}`;
                if (titleText) ind.title = titleText;
            }
        }

        function testPing(targetUrl) {
            const pingHost = targetUrl || getTargetHost();
            setIndicator('#eab308', '연결 확인 중...');
            GM_xmlhttpRequest({
                method: "GET",
                url: `${pingHost}/api/status`,
                timeout: 5000,
                onload: function(res) {
                    if (res.status === 200) {
                        setIndicator('#10b981', '정상 연결됨');
                        const infoEl = document.getElementById('danbal-last-info');
                        if (infoEl) infoEl.innerText = `서버 연결 성공 (${res.status} OK)`;
                    } else {
                        setIndicator('#ef4444', `오류 (${res.status})`);
                    }
                },
                onerror: function() {
                    setIndicator('#ef4444', '서버 연결 실패');
                    const infoEl = document.getElementById('danbal-last-info');
                    if (infoEl) infoEl.innerText = `서버 연결 실패: ${pingHost}`;
                }
            });
        }

        const pingBtn = document.getElementById('danbal-ping-btn');
        if (pingBtn) {
            pingBtn.addEventListener('click', (e) => {
                e.preventDefault();
                testPing();
            });
        }

        function parseAlertRow(row) {
            try {
                const text = row.innerText || row.textContent || "";
                if (!text || text.length < 3) return null;

                // 1. Balloons
                const balloonMatch = text.match(/([0-9,]+)\s*(?:개|풍)/);
                const balloons = balloonMatch ? parseInt(balloonMatch[1].replace(/,/g, '')) : 0;

                // 2. Roulette result: e.g. (0.6%) 1812 or (50%) 꽝 or (1.2%) -500
                const rouletteMatch = text.match(/\(\s*([0-9.]+%?)\s*\)\s*([^\n\r\t]+)/);
                const rouletteResult = rouletteMatch ? rouletteMatch[0].trim() : "";

                // 3. Date / Time
                let timeStr = "";
                const fullTimeMatch = text.match(/\b(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\b/);
                if (fullTimeMatch) {
                    timeStr = fullTimeMatch[1];
                } else {
                    const shortTimeMatch = text.match(/\b([0-2]?[0-9]:[0-5][0-9](?::[0-5][0-9])?)\b/);
                    if (shortTimeMatch) timeStr = shortTimeMatch[0];
                }

                // 4. Nickname & User ID
                let nickname = "";
                let userId = "";

                const userEl = row.querySelector('.user, .user_id, .nickname, .name, [class*="user"], [class*="nick"]');
                if (userEl) {
                    nickname = userEl.innerText.trim();
                }

                const userMatch = text.match(/([^\n\r()]+?)\s*\(([^)]+)\)/);
                if (userMatch) {
                    let rawNick = userMatch[1].trim();
                    rawNick = rawNick.replace(/\d{4}-\d{2}-\d{2}.*/, '').replace(/별풍선/g, '').trim();
                    const lines = rawNick.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    nickname = lines.length > 0 ? lines[lines.length - 1] : rawNick;
                    userId = userMatch[2].trim();
                } else if (!nickname) {
                    const words = text.split(/\s+/).filter(w => w !== "별풍선");
                    if (words.length > 0) nickname = words[0];
                }

                // 5. Chat message: Clean text
                let chatMessage = "";
                const chatEl = row.querySelector('.chat, .comment, .msg, [class*="chat"], [class*="msg"]');
                if (chatEl) {
                    chatMessage = chatEl.innerText.trim();
                } else {
                    chatMessage = text;
                    if (timeStr) chatMessage = chatMessage.replace(timeStr, '');
                    if (userId) chatMessage = chatMessage.replace(`(${userId})`, '');
                    if (nickname) chatMessage = chatMessage.replace(nickname, '');
                    if (rouletteResult) chatMessage = chatMessage.replace(rouletteResult, '');
                    if (balloonMatch) chatMessage = chatMessage.replace(balloonMatch[0], '');
                    chatMessage = chatMessage.replace(/별풍선/g, '').replace(/[\r\n]+/g, ' ').trim();
                }

                const extId = `weflab_${userId}_${nickname}_${balloons}_${timeStr}_${chatMessage.slice(0, 15)}_${rouletteResult}`.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');

                return {
                    user_id: userId,
                    nickname: nickname,
                    balloons: balloons,
                    chat_message: chatMessage,
                    roulette_result: rouletteResult,
                    streamer_name: "선택",
                    created_at: timeStr || null,
                    external_id: extId
                };
            } catch (err) {
                return null;
            }
        }

        function sendAlert(data) {
            if (!data || processedHashes.has(data.external_id)) return;
            processedHashes.add(data.external_id);

            const target = getTargetHost();
            const apiUrl = `${target}/api/alerts/ingest`;

            GM_xmlhttpRequest({
                method: "POST",
                url: apiUrl,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(data),
                timeout: 8000,
                onload: function(response) {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (result.status === "ok" || result.status === "duplicate") {
                            if (result.status === "ok") sentCount++;
                            updateCount(data);
                            setIndicator('#10b981', '정상 연동');
                        }
                    } catch(e) {}
                },
                onerror: function(err) {
                    setIndicator('#ef4444', '전송 실패');
                    const infoEl = document.getElementById('danbal-last-info');
                    if (infoEl) infoEl.innerText = `전송 오류 (${apiUrl})`;
                }
            });
        }

        function scanPage() {
            const selectors = [
                '#alertlist_table tbody tr',
                '#alertlist_table tr',
                '.alert_list .tr',
                '.alert_list tr',
                '#popup_roulette_static .tbody .tr',
                '#popup_roulette_static tr',
                '.table_alert tbody tr',
                '.table_alert tr',
                '.table-responsive table tbody tr',
                'table tbody tr',
                'div[class*="alert_item"]',
                'div[class*="alert-item"]',
                'div[class*="alert"]'
            ];

            const allRows = new Set();
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els && els.length > 0) {
                    els.forEach(el => allRows.add(el));
                }
            }

            allRows.forEach(row => {
                const parsed = parseAlertRow(row);
                if (parsed && (parsed.balloons > 0 || parsed.roulette_result)) {
                    sendAlert(parsed);
                }
            });
        }

        const btnManual = document.getElementById('danbal-manual-btn');
        if (btnManual) {
            btnManual.addEventListener('click', (e) => {
                e.preventDefault();
                scanPage();
            });
        }

        setTimeout(() => {
            testPing();
            scanPage();
        }, 1200);

        const observer = new MutationObserver(() => scanPage());
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(scanPage, 3000);
    }

    // ------------------------------------------
    // SCORE.FLABS.KR IMPLEMENTATION (점수판 비교)
    // ------------------------------------------
    function initScoreFlabsSync() {
        if (document.getElementById('danbal-flabs-badge')) return;

        const currentTarget = getTargetHost();

        const badge = document.createElement('div');
        badge.id = 'danbal-flabs-badge';
        badge.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999999;
            background: #0f172a;
            color: #ffffff;
            padding: 12px 16px;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.5);
            font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Pretendard", "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            border: 2px solid #10b981;
            min-width: 280px;
        `;
        badge.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                <div style="display:flex; align-items:center; gap:8px; font-weight:800;">
                    <span id="flabs-indicator" style="width:10px; height:10px; border-radius:50%; background:#10b981; display:inline-block; box-shadow:0 0 6px #10b981;"></span>
                    <span>점수판 실시간 비교 v3.0</span>
                </div>
                <span id="flabs-sync-time" style="background:#10b981; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:bold;">동기화중</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; background:#1e293b; padding:6px 8px; border-radius:6px; font-size:11px;">
                <span style="color:#94a3b8; white-space:nowrap;">전송 대상:</span>
                <select id="flabs-target-select" style="background:#0f172a; color:#fff; border:1px solid #475569; border-radius:4px; font-size:11px; padding:2px 4px; flex:1; cursor:pointer;">
                    <option value="https://moneyroulette-excp.vercel.app">Vercel (웹 배포)</option>
                    <option value="http://localhost:8000">로컬 (localhost:8000)</option>
                </select>
            </div>
            <div style="font-size:11px; color:#cbd5e1;">이 창을 켜두시면 우리 대시보드와 점수를 자동 비교합니다.</div>
            <div style="display:flex; gap:6px;">
                <button id="flabs-scan-btn" style="flex:1; background:#2563eb; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">점수판 즉시 읽기</button>
                <a id="flabs-dash-link" href="${currentTarget}" target="_blank" style="background:#334155; color:#fff; text-decoration:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:bold; display:flex; align-items:center;">대시보드</a>
            </div>
        `;
        document.body.appendChild(badge);

        const targetSelect = document.getElementById('flabs-target-select');
        if (targetSelect) {
            targetSelect.value = currentTarget.includes("localhost") ? "http://localhost:8000" : "https://moneyroulette-excp.vercel.app";
            targetSelect.addEventListener('change', () => {
                const newTarget = targetSelect.value;
                setTargetHost(newTarget);
                const dashLink = document.getElementById('flabs-dash-link');
                if (dashLink) dashLink.href = newTarget;
            });
        }

        function extractNumber(str) {
            if (!str) return 0;
            const clean = str.replace(/,/g, '').replace(/[^0-9-]/g, '');
            const parsed = parseInt(clean, 10);
            return isNaN(parsed) ? 0 : parsed;
        }

        function scrapeScoreboard() {
            const streamers = [];
            let totalBalloons = 0;
            let totalScore = 0;

            const cardCandidates = document.querySelectorAll(
                '.board_list .item, .scoreboard_list .item, .bj_list .item, .rank_list .item, ' +
                'table tr, .score_box, .list_box .item, .streamer_item, [class*="streamer"], [class*="bj"]'
            );

            const foundMap = {};

            cardCandidates.forEach(card => {
                const nameEl = card.querySelector('.name, .bj_name, .nick, .title, strong, b, [class*="name"]');
                const scoreEl = card.querySelector('.score, .point, .cnt, .total, [class*="score"], [class*="point"]');
                const balloonEl = card.querySelector('.balloon, .star, .fan, [class*="star"], [class*="balloon"]');

                if (nameEl && scoreEl) {
                    const name = nameEl.innerText.trim();
                    if (name && name.length >= 2 && !name.includes("순위") && !name.includes("스트리머") && !name.includes("닉네임")) {
                        const score = extractNumber(scoreEl.innerText);
                        const balloons = balloonEl ? extractNumber(balloonEl.innerText) : 0;
                        foundMap[name] = { name: name, score: score, balloons: balloons };
                    }
                }
            });

            const rows = document.querySelectorAll('table tbody tr, .tbody .tr');
            rows.forEach(tr => {
                const tds = tr.querySelectorAll('td, .td');
                if (tds.length >= 2) {
                    const text0 = tds[0].innerText.trim();
                    const text1 = tds[1].innerText.trim();
                    const text2 = tds.length >= 3 ? tds[2].innerText.trim() : "";

                    let potentialName = "";
                    let potentialScore = 0;
                    let potentialBalloons = 0;

                    if (isNaN(parseInt(text0)) && text0.length >= 2) {
                        potentialName = text0;
                        potentialScore = extractNumber(text1);
                        potentialBalloons = extractNumber(text2);
                    } else if (isNaN(parseInt(text1)) && text1.length >= 2) {
                        potentialName = text1;
                        potentialScore = extractNumber(text2);
                        potentialBalloons = tds.length >= 4 ? extractNumber(tds[3].innerText) : 0;
                    }

                    if (potentialName && !potentialName.includes("합계") && !potentialName.includes("총합") && !foundMap[potentialName]) {
                        foundMap[potentialName] = {
                            name: potentialName,
                            score: potentialScore,
                            balloons: potentialBalloons
                        };
                    }
                }
            });

            for (const k in foundMap) {
                streamers.push(foundMap[k]);
                totalScore += foundMap[k].score;
                totalBalloons += foundMap[k].balloons;
            }

            const totalScoreEl = document.querySelector('.total_score, .total_point, .total .score, #total_score');
            if (totalScoreEl) {
                totalScore = extractNumber(totalScoreEl.innerText);
            }

            return {
                source: "score.flabs.kr",
                url: window.location.href,
                timestamp: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
                streamers: streamers,
                total_balloons: totalBalloons,
                total_score: totalScore
            };
        }

        function sendScoreSync() {
            const payload = scrapeScoreboard();
            if (!payload || payload.streamers.length === 0) return;

            const target = getTargetHost();
            const syncUrl = `${target}/api/external_score/sync`;

            GM_xmlhttpRequest({
                method: "POST",
                url: syncUrl,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload),
                timeout: 5000,
                onload: function(response) {
                    try {
                        const timeEl = document.getElementById('flabs-sync-time');
                        if (timeEl) {
                            timeEl.innerText = `${payload.streamers.length}명 비교중`;
                        }
                        const ind = document.getElementById('flabs-indicator');
                        if (ind) {
                            ind.style.background = '#10b981';
                            ind.style.boxShadow = '0 0 6px #10b981';
                        }
                    } catch(e) {}
                },
                onerror: function(err) {
                    const ind = document.getElementById('flabs-indicator');
                    if (ind) {
                        ind.style.background = '#ef4444';
                        ind.style.boxShadow = '0 0 6px #ef4444';
                    }
                }
            });
        }

        const btnScan = document.getElementById('flabs-scan-btn');
        if (btnScan) {
            btnScan.addEventListener('click', (e) => {
                e.preventDefault();
                sendScoreSync();
            });
        }

        setTimeout(sendScoreSync, 2000);
        setInterval(sendScoreSync, 2000);
        const observer = new MutationObserver(() => sendScoreSync());
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
