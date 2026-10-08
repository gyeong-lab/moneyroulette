// ==UserScript==
// @name         단발 용돈룰렛 위플랩 및 점수판(score.flabs.kr) 통합 실시간 자동 연동
// @namespace    https://danbal-roulette.local/
// @version      2.0
// @description  weflab.com 알림 자동 수집 및 score.flabs.kr 점수판 실시간 비교 동기화
// @author       danbal
// @match        *://*.weflab.com/*
// @match        *://score.flabs.kr/*
// @connect      localhost
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const currentHost = window.location.hostname;
    const isWeflab = currentHost.includes("weflab.com");
    const isScoreFlabs = currentHost.includes("score.flabs.kr");

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
        const LOCAL_API = "http://localhost:8000/api/alerts/ingest";
        const processedHashes = new Set();
        let sentCount = 0;

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
            box-shadow: 0 6px 25px rgba(0,0,0,0.35);
            font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Pretendard", "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            border: 2px solid #3b82f6;
        `;
        badge.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="display:flex; align-items:center; gap:8px; font-weight:800;">
                    <span id="danbal-indicator" style="width:10px; height:10px; border-radius:50%; background:#10b981; display:inline-block; box-shadow:0 0 6px #10b981;"></span>
                    <span>위플랩 실시간 기록 연동 중</span>
                </div>
                <span id="danbal-sync-count" style="background:#2563eb; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:bold;">0건 전송</span>
            </div>
            <div style="font-size:11px; color:#94a3b8;">새 알림 발생 시 0.1초 내 자동 전송됩니다.</div>
            <div style="display:flex; gap:6px; margin-top:2px;">
                <button id="danbal-manual-btn" style="flex:1; background:#2563eb; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">현재 화면 전체 수동전송</button>
                <a href="http://localhost:8000" target="_blank" style="background:#334155; color:#fff; text-decoration:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:bold; display:flex; align-items:center;">대시보드 열기</a>
            </div>
        `;
        document.body.appendChild(badge);

        const updateCount = () => {
            const el = document.getElementById('danbal-sync-count');
            if (el) el.innerText = `${sentCount}건 전송`;
        };

        function parseAlertRow(row) {
            try {
                const text = row.innerText || "";
                if (!text || text.length < 3) return null;

                const balloonMatch = text.match(/([0-9,]+)\s*(개|풍)/);
                const balloons = balloonMatch ? parseInt(balloonMatch[1].replace(/,/g, '')) : 0;

                const rouletteMatch = text.match(/\(([0-9.]+%?)\)\s*([+-]?[0-9,]+)/);
                const rouletteResult = rouletteMatch ? rouletteMatch[0] : "";

                let userId = "";
                let nickname = "";

                const userEl = row.querySelector('.user, .user_id, .nickname, .name, [class*="user"], [class*="nick"]');
                if (userEl) {
                    nickname = userEl.innerText.trim();
                }

                const userMatch = text.match(/([^\s()]+)\(([^)]+)\)/);
                if (userMatch) {
                    nickname = userMatch[1].trim();
                    userId = userMatch[2].trim();
                } else if (!nickname) {
                    const words = text.split(/\s+/);
                    if (words.length > 0) nickname = words[0];
                }

                const timeMatch = text.match(/\b([0-2]?[0-9]:[0-5][0-9](?::[0-5][0-9])?)\b/);
                const timeStr = timeMatch ? timeMatch[0] : "";

                let chatMessage = "";
                const chatEl = row.querySelector('.chat, .comment, .msg, [class*="chat"], [class*="msg"]');
                if (chatEl) {
                    chatMessage = chatEl.innerText.trim();
                } else {
                    chatMessage = text.replace(rouletteResult, '').replace(timeStr, '').trim();
                }

                const extId = `${userId}_${nickname}_${balloons}_${timeStr}_${chatMessage.slice(0, 20)}_${rouletteResult}`.replace(/\s+/g, '_');

                return {
                    user_id: userId,
                    nickname: nickname,
                    balloons: balloons,
                    chat_message: chatMessage,
                    roulette_result: rouletteResult,
                    streamer_name: "선택",
                    created_at: null,
                    external_id: extId
                };
            } catch (err) {
                return null;
            }
        }

        function sendAlert(data) {
            if (!data || processedHashes.has(data.external_id)) return;
            processedHashes.add(data.external_id);

            GM_xmlhttpRequest({
                method: "POST",
                url: LOCAL_API,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(data),
                onload: function(response) {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (result.status === "ok") {
                            sentCount++;
                            updateCount();
                            const ind = document.getElementById('danbal-indicator');
                            if (ind) {
                                ind.style.background = '#10b981';
                                ind.style.boxShadow = '0 0 6px #10b981';
                            }
                        }
                    } catch(e) {}
                },
                onerror: function(err) {
                    const ind = document.getElementById('danbal-indicator');
                    if (ind) {
                        ind.style.background = '#ef4444';
                        ind.style.boxShadow = '0 0 6px #ef4444';
                    }
                }
            });
        }

        function scanPage() {
            const selectors = [
                '#alertlist_table tbody tr',
                '.alert_list .tr',
                '#popup_roulette_static .tbody .tr',
                '.table_alert tbody tr',
                'table tr',
                'div[class*="alert"]'
            ];

            let foundRows = [];
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els && els.length > 0) {
                    foundRows = Array.from(els);
                    break;
                }
            }

            foundRows.forEach(row => {
                const parsed = parseAlertRow(row);
                if (parsed) sendAlert(parsed);
            });
        }

        const btnManual = document.getElementById('danbal-manual-btn');
        if (btnManual) {
            btnManual.addEventListener('click', (e) => {
                e.preventDefault();
                scanPage();
            });
        }

        setTimeout(scanPage, 1500);
        const observer = new MutationObserver(() => scanPage());
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(scanPage, 4000);
    }

    // ------------------------------------------
    // SCORE.FLABS.KR IMPLEMENTATION (점수판 비교)
    // ------------------------------------------
    function initScoreFlabsSync() {
        const SYNC_API = "http://localhost:8000/api/external_score/sync";
        let lastSyncStatus = "대기중";

        // Create Badge on score.flabs.kr
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
        `;
        badge.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                <div style="display:flex; align-items:center; gap:8px; font-weight:800;">
                    <span id="flabs-indicator" style="width:10px; height:10px; border-radius:50%; background:#10b981; display:inline-block; box-shadow:0 0 6px #10b981;"></span>
                    <span>점수판 실시간 비교 연동 중</span>
                </div>
                <span id="flabs-sync-time" style="background:#10b981; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:bold;">동기화중</span>
            </div>
            <div style="font-size:11px; color:#cbd5e1;">이 창을 켜두시면 우리 대시보드와 점수를 1초마다 자동 비교합니다.</div>
            <div style="display:flex; gap:6px;">
                <button id="flabs-scan-btn" style="flex:1; background:#2563eb; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">점수판 즉시 읽기</button>
                <a href="http://localhost:8000" target="_blank" style="background:#334155; color:#fff; text-decoration:none; padding:6px 10px; border-radius:6px; font-size:12px; font-weight:bold; display:flex; align-items:center;">대시보드 보기</a>
            </div>
        `;
        document.body.appendChild(badge);

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

            // Strategy A: Check standard scoreboard containers / table rows
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

            // Strategy B: General Table Parsing if table rows exist
            const rows = document.querySelectorAll('table tbody tr, .tbody .tr');
            rows.forEach(tr => {
                const tds = tr.querySelectorAll('td, .td');
                if (tds.length >= 2) {
                    const text0 = tds[0].innerText.trim();
                    const text1 = tds[1].innerText.trim();
                    const text2 = tds.length >= 3 ? tds[2].innerText.trim() : "";

                    // If column 0 or 1 is a name
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

            // Strategy C: Check window javascript global data if available
            try {
                if (window.boardData && typeof window.boardData === 'object') {
                    // Inspect boardData
                }
            } catch(e) {}

            for (const k in foundMap) {
                streamers.push(foundMap[k]);
                totalScore += foundMap[k].score;
                totalBalloons += foundMap[k].balloons;
            }

            // Total box check
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

            GM_xmlhttpRequest({
                method: "POST",
                url: SYNC_API,
                headers: { "Content-Type": "application/json" },
                data: JSON.stringify(payload),
                onload: function(response) {
                    try {
                        const result = JSON.parse(response.responseText);
                        const timeEl = document.getElementById('flabs-sync-time');
                        if (timeEl) {
                            timeEl.innerText = `${payload.streamers.length}명 비교중`;
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
