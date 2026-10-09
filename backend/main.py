import os
import io
import json
import asyncio
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body, Response, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import xlsxwriter

from backend.database import (
    init_db, get_db, get_current_seoul_time,
    calculate_broadcast_elapsed
)
from backend.parser import parse_roulette_result, match_streamer_by_chat

init_db()

app = FastAPI(title="Danbal Roulette Manager")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def normalize_api_path(request, call_next):
    path = request.scope.get("path", "")
    if path and not path.startswith("/api") and not path.startswith("/static") and not path.startswith("/ws") and not any(path.endswith(ext) for ext in [".js", ".css", ".html", ".png", ".jpg", ".ico", ".xlsx"]) and path != "/":
        request.scope["path"] = "/api" + path
    response = await call_next(request)
    return response

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        text_data = json.dumps(message, ensure_ascii=False)
        for connection in list(self.active_connections):
            try:
                await connection.send_text(text_data)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    if os.environ.get("VERCEL"):
        return
    async def timer_tick():
        while True:
            await asyncio.sleep(1)
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings WHERE key IN ('broadcast_active', 'broadcast_started_at')")
            rows = {r['key']: r['value'] for r in cursor.fetchall()}
            conn.close()
            
            is_active = (rows.get('broadcast_active') == 'true')
            started_at = rows.get('broadcast_started_at', '')
            if is_active and started_at:
                elapsed = calculate_broadcast_elapsed(started_at)
                await manager.broadcast({
                    "type": "TICK",
                    "elapsed": elapsed,
                    "seoul_time": get_current_seoul_time()
                })
    asyncio.create_task(timer_tick())

# Schemas
class AlertIngestRequest(BaseModel):
    user_id: Optional[str] = ""
    nickname: Optional[str] = ""
    balloons: Optional[int] = 0
    chat_message: Optional[str] = ""
    roulette_result: Optional[str] = ""
    streamer_name: Optional[str] = None
    created_at: Optional[str] = None
    external_id: Optional[str] = None
    multiplier: Optional[str] = "기본배수"
    contribution: Optional[int] = None
    memo: Optional[str] = ""
    is_example: Optional[int] = 0

class StreamerCreateRequest(BaseModel):
    name: str
    keywords: Optional[str] = ""
    minus_keywords: Optional[str] = ""
    color: Optional[str] = "#3b82f6"
    is_pinned: Optional[int] = 0

class StreamerUpdateRequest(BaseModel):
    name: Optional[str] = None
    keywords: Optional[str] = None
    minus_keywords: Optional[str] = None
    color: Optional[str] = None
    order_index: Optional[int] = None
    is_pinned: Optional[int] = None

class AlertUpdateRequest(BaseModel):
    user_id: Optional[str] = None
    nickname: Optional[str] = None
    balloons: Optional[int] = None
    chat_message: Optional[str] = None
    streamer_name: Optional[str] = None
    roulette_sign: Optional[str] = None
    roulette_value: Optional[int] = None
    multiplier: Optional[str] = None
    contribution: Optional[int] = None
    memo: Optional[str] = None
    status: Optional[str] = None
    is_example: Optional[int] = None

class RoundUpdateRequest(BaseModel):
    current_round: Optional[int] = None
    round_name: Optional[str] = None

# External Scoreboard (score.flabs.kr) Sync Schema
class ExternalScoreStreamer(BaseModel):
    name: str
    balloons: Optional[int] = 0
    score: Optional[int] = 0

class ExternalScoreSyncRequest(BaseModel):
    source: Optional[str] = "score.flabs.kr"
    url: Optional[str] = ""
    timestamp: Optional[str] = ""
    streamers: List[ExternalScoreStreamer] = []
    total_balloons: Optional[int] = None
    total_score: Optional[int] = None

# In-memory external scoreboard cache and baseline
external_score_cache = {
    "connected": False,
    "last_sync_time": "",
    "url": "",
    "streamers": {},
    "total_balloons": 0,
    "total_score": 0,
    # Net delta since broadcast started
    "net_streamers": {},
    "net_total_balloons": 0,
    "net_total_score": 0,
    "baseline_active": False
}

external_baseline = {
    "active": False,
    "started_at": "",
    "streamers": {},
    "total_balloons": 0,
    "total_score": 0
}

@app.post("/api/external_score/sync")
async def sync_external_score(req: ExternalScoreSyncRequest):
    global external_score_cache, external_baseline
    now_str = req.timestamp or get_current_seoul_time()
    raw_map = {}
    for item in req.streamers:
        raw_map[item.name.strip()] = {
            "name": item.name.strip(),
            "balloons": item.balloons or 0,
            "score": item.score or 0
        }

    raw_total_balloons = req.total_balloons if req.total_balloons is not None else sum(s['balloons'] for s in raw_map.values())
    raw_total_score = req.total_score if req.total_score is not None else sum(s['score'] for s in raw_map.values())

    # Check broadcast status for automatic baseline
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('broadcast_active', 'broadcast_started_at')")
    settings = {r['key']: r['value'] for r in cursor.fetchall()}
    conn.close()

    is_active = (settings.get('broadcast_active') == 'true')

    # If broadcast is active, initialize baseline if not yet set
    if is_active and not external_baseline["active"]:
        external_baseline["active"] = True
        external_baseline["started_at"] = settings.get('broadcast_started_at', now_str)
        external_baseline["streamers"] = {k: {"balloons": v["balloons"], "score": v["score"]} for k, v in raw_map.items()}
        external_baseline["total_balloons"] = raw_total_balloons
        external_baseline["total_score"] = raw_total_score

    # Compute net streamers if baseline active
    net_streamers = {}
    if external_baseline["active"]:
        base_s = external_baseline["streamers"]
        for name, data in raw_map.items():
            b_data = base_s.get(name, {"balloons": data["balloons"], "score": data["score"]})
            # If a new streamer appeared after baseline, base is 0 or initial
            if name not in base_s:
                base_s[name] = {"balloons": data["balloons"], "score": data["score"]}
                b_data = base_s[name]

            net_balloons = data["balloons"] - b_data["balloons"]
            net_score = data["score"] - b_data["score"]
            net_streamers[name] = {
                "name": name,
                "balloons": max(0, net_balloons),
                "score": net_score
            }
        net_tot_b = raw_total_balloons - external_baseline["total_balloons"]
        net_tot_s = raw_total_score - external_baseline["total_score"]
    else:
        net_streamers = raw_map
        net_tot_b = raw_total_balloons
        net_tot_s = raw_total_score

    external_score_cache = {
        "connected": True,
        "last_sync_time": now_str,
        "url": req.url,
        "streamers": raw_map,
        "total_balloons": raw_total_balloons,
        "total_score": raw_total_score,
        "net_streamers": net_streamers,
        "net_total_balloons": max(0, net_tot_b),
        "net_total_score": net_tot_s,
        "baseline_active": external_baseline["active"]
    }

    # Broadcast to all connected clients
    await manager.broadcast({
        "type": "EXTERNAL_SCORE_UPDATE",
        "data": external_score_cache
    })
    return {"status": "ok", "count": len(raw_map), "time": now_str, "baseline_active": external_baseline["active"]}

@app.post("/api/external_score/reset_baseline")
async def reset_external_baseline():
    global external_baseline, external_score_cache
    raw_map = external_score_cache.get("streamers", {})
    external_baseline["active"] = True
    external_baseline["started_at"] = get_current_seoul_time()
    external_baseline["streamers"] = {k: {"balloons": v["balloons"], "score": v["score"]} for k, v in raw_map.items()}
    external_baseline["total_balloons"] = external_score_cache.get("total_balloons", 0)
    external_baseline["total_score"] = external_score_cache.get("total_score", 0)

    # Recompute net
    net_streamers = {k: {"name": k, "balloons": 0, "score": 0} for k in raw_map}
    external_score_cache["net_streamers"] = net_streamers
    external_score_cache["net_total_balloons"] = 0
    external_score_cache["net_total_score"] = 0
    external_score_cache["baseline_active"] = True

    await manager.broadcast({
        "type": "EXTERNAL_SCORE_UPDATE",
        "data": external_score_cache
    })
    return {"status": "ok", "message": "Baseline reset to current"}

@app.get("/api/external_score")
def get_external_score():
    return external_score_cache

# Project Backup Save / Restore APIs
@app.get("/api/project/export")
def export_project_json():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM streamers")
    streamers = [dict(s) for s in cursor.fetchall()]
    cursor.execute("SELECT * FROM alerts")
    alerts = [dict(a) for a in cursor.fetchall()]
    cursor.execute("SELECT key, value FROM settings")
    settings = {r['key']: r['value'] for r in cursor.fetchall()}
    conn.close()

    backup_data = {
        "version": "1.0",
        "exported_at": get_current_seoul_time(),
        "streamers": streamers,
        "alerts": alerts,
        "settings": settings
    }
    content = json.dumps(backup_data, ensure_ascii=False, indent=2)
    filename = f"danbal_project_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.post("/api/project/import")
async def import_project_json(file: UploadFile = File(...)):
    try:
        content = await file.read()
        data = json.loads(content.decode("utf-8"))
        if "streamers" not in data or "alerts" not in data:
            return JSONResponse(status_code=400, content={"error": "잘못된 프로젝트 파일 형식입니다."})

        conn = get_db()
        cursor = conn.cursor()

        # Restore streamers
        cursor.execute("DELETE FROM streamers")
        for s in data["streamers"]:
            cursor.execute(
                "INSERT INTO streamers (id, name, keywords, minus_keywords, color, order_index, is_pinned) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (s.get("id"), s["name"], s.get("keywords", ""), s.get("minus_keywords", ""), s.get("color", "#3b82f6"), s.get("order_index", 0), s.get("is_pinned", 0))
            )

        # Restore alerts
        cursor.execute("DELETE FROM alerts")
        for a in data["alerts"]:
            cursor.execute("""
                INSERT INTO alerts (
                    id, external_id, platform, created_at, broadcast_elapsed, user_id, nickname,
                    balloons, chat_message, roulette_raw, roulette_percent, roulette_sign,
                    roulette_value, streamer_name, multiplier, contribution, memo, status, round_number, is_example
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                a.get("id"), a.get("external_id"), a.get("platform", "SOOP"), a.get("created_at"), a.get("broadcast_elapsed"),
                a.get("user_id"), a.get("nickname"), a.get("balloons", 0), a.get("chat_message", ""),
                a.get("roulette_raw", ""), a.get("roulette_percent", ""), a.get("roulette_sign", "+"),
                a.get("roulette_value", 0), a.get("streamer_name"), a.get("multiplier", "기본배수"),
                a.get("contribution", 0), a.get("memo", ""), a.get("status", "active"),
                a.get("round_number", 1), a.get("is_example", 0)
            ))

        # Restore settings
        if "settings" in data:
            for k, v in data["settings"].items():
                cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, str(v)))

        conn.commit()
        conn.close()

        # Notify UI to reload all
        await manager.broadcast({"type": "STREAMERS_CHANGED"})
        await manager.broadcast({"type": "CLEAR_ALERTS"})
        return {"status": "ok", "streamers_count": len(data["streamers"]), "alerts_count": len(data["alerts"])}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/status")
def get_status():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    settings = {r['key']: r['value'] for r in cursor.fetchall()}
    
    is_active = (settings.get('broadcast_active') == 'true')
    started_at = settings.get('broadcast_started_at', '')
    elapsed = calculate_broadcast_elapsed(started_at) if is_active else "00:00:00"
    current_round = int(settings.get('current_round', '1'))
    round_name = settings.get('round_name', f'{current_round}라운드')
    
    conn.close()
    return {
        "broadcast_active": is_active,
        "broadcast_started_at": started_at,
        "elapsed": elapsed,
        "seoul_time": get_current_seoul_time(),
        "show_zero_streamers": (settings.get('show_zero_streamers') == 'true'),
        "show_total": (settings.get('show_total', 'true') == 'true'),
        "compare_flabs": (settings.get('compare_flabs', 'true') == 'true'),
        "roulette_balloons": settings.get('roulette_balloons', '500, 501, 1000, 1001, 3000, 3001, 5000, 5001'),
        "allow_all_balloons": (settings.get('allow_all_balloons', 'false') == 'true'),
        "current_round": current_round,
        "round_name": round_name
    }

@app.post("/api/broadcast/toggle")
async def toggle_broadcast():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'broadcast_active'")
    row = cursor.fetchone()
    current_active = (row['value'] == 'true') if row else False
    
    new_active = not current_active
    now_seoul = get_current_seoul_time() if new_active else ""
    
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('broadcast_active', ?)", ('true' if new_active else 'false',))
    if new_active:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('broadcast_started_at', ?)", (now_seoul,))
        # Automatically reset baseline for external score comparator
        raw_map = external_score_cache.get("streamers", {})
        external_baseline["active"] = True
        external_baseline["started_at"] = now_seoul
        external_baseline["streamers"] = {k: {"balloons": v["balloons"], "score": v["score"]} for k, v in raw_map.items()}
        external_baseline["total_balloons"] = external_score_cache.get("total_balloons", 0)
        external_baseline["total_score"] = external_score_cache.get("total_score", 0)
        
        external_score_cache["net_streamers"] = {k: {"name": k, "balloons": 0, "score": 0} for k in raw_map}
        external_score_cache["net_total_balloons"] = 0
        external_score_cache["net_total_score"] = 0
        external_score_cache["baseline_active"] = True
    else:
        external_baseline["active"] = False
        external_score_cache["baseline_active"] = False

    conn.commit()
    conn.close()
    
    status_payload = {
        "broadcast_active": new_active,
        "broadcast_started_at": now_seoul,
        "elapsed": "00:00:00" if not new_active else "00:00:00"
    }
    await manager.broadcast({"type": "STATUS_CHANGE", "data": status_payload})
    await manager.broadcast({"type": "EXTERNAL_SCORE_UPDATE", "data": external_score_cache})
    return status_payload

@app.post("/api/round/update")
async def update_round(req: RoundUpdateRequest):
    conn = get_db()
    cursor = conn.cursor()
    if req.current_round is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('current_round', ?)", (str(req.current_round),))
    if req.round_name is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('round_name', ?)", (req.round_name.strip(),))
    conn.commit()
    conn.close()

    payload = {
        "current_round": req.current_round,
        "round_name": req.round_name
    }
    await manager.broadcast({"type": "ROUND_UPDATED", "data": payload})
    return {"ok": True, **payload}

@app.post("/api/contribution/reset")
async def reset_contribution():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'current_round'")
    row = cursor.fetchone()
    current_round = int(row['value']) if row else 1
    new_round = current_round + 1
    new_round_name = f"{new_round}라운드"

    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('current_round', ?)", (str(new_round),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('round_name', ?)", (new_round_name,))
    conn.commit()
    conn.close()

    await manager.broadcast({
        "type": "CONTRIBUTION_RESET",
        "new_round": new_round,
        "round_name": new_round_name
    })
    return {"ok": True, "new_round": new_round, "round_name": new_round_name}

@app.get("/api/streamers")
def get_streamers():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM streamers ORDER BY order_index ASC, id ASC")
    streamers = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return streamers

@app.post("/api/streamers")
async def add_streamer(req: StreamerCreateRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(order_index) as max_idx FROM streamers")
    row = cursor.fetchone()
    next_idx = (row['max_idx'] or 0) + 1
    
    cursor.execute(
        "INSERT INTO streamers (name, keywords, minus_keywords, color, order_index, is_pinned) VALUES (?, ?, ?, ?, ?, ?)",
        (req.name.strip(), req.keywords.strip(), req.minus_keywords.strip(), req.color or "#3b82f6", next_idx, req.is_pinned or 0)
    )
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    await manager.broadcast({"type": "STREAMERS_CHANGED"})
    return {"id": new_id, "name": req.name, "keywords": req.keywords, "color": req.color}

@app.put("/api/streamers/{streamer_id}")
async def update_streamer(streamer_id: int, req: StreamerUpdateRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM streamers WHERE id = ?", (streamer_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Streamer not found")

    old_name = existing['name']

    updates = []
    params = []
    if req.name is not None:
        updates.append("name = ?")
        params.append(req.name.strip())
    if req.keywords is not None:
        updates.append("keywords = ?")
        params.append(req.keywords.strip())
    if req.minus_keywords is not None:
        updates.append("minus_keywords = ?")
        params.append(req.minus_keywords.strip())
    if req.color is not None:
        updates.append("color = ?")
        params.append(req.color)
    if req.order_index is not None:
        updates.append("order_index = ?")
        params.append(req.order_index)
    if req.is_pinned is not None:
        updates.append("is_pinned = ?")
        params.append(req.is_pinned)

    if updates:
        params.append(streamer_id)
        cursor.execute(f"UPDATE streamers SET {', '.join(updates)} WHERE id = ?", params)
        
        if req.name and req.name.strip() != old_name:
            cursor.execute("UPDATE alerts SET streamer_name = ? WHERE streamer_name = ?", (req.name.strip(), old_name))

        conn.commit()

    cursor.execute("SELECT * FROM streamers WHERE id = ?", (streamer_id,))
    updated_row = dict(cursor.fetchone())
    conn.close()

    await manager.broadcast({"type": "STREAMERS_CHANGED"})
    return updated_row

@app.delete("/api/streamers/{streamer_id}")
async def delete_streamer(streamer_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM streamers WHERE id = ?", (streamer_id,))
    conn.commit()
    conn.close()
    await manager.broadcast({"type": "STREAMERS_CHANGED"})
    return {"ok": True}

@app.get("/api/alerts")
def get_alerts():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM alerts ORDER BY id DESC")
    alerts = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return alerts

@app.post("/api/alerts/ingest")
async def ingest_alert(req: AlertIngestRequest):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('broadcast_active', 'broadcast_started_at', 'current_round', 'roulette_balloons', 'allow_all_balloons')")
    settings = {r['key']: r['value'] for r in cursor.fetchall()}
    is_active = (settings.get('broadcast_active') == 'true')
    started_at = settings.get('broadcast_started_at', '')
    cur_round = int(settings.get('current_round', '1'))
    allow_all = (settings.get('allow_all_balloons', 'false') == 'true')
    raw_balloons = settings.get('roulette_balloons', '500, 501, 1000, 1001, 3000, 3001, 5000, 5001')

    import re
    recognized_balloons = set()
    for token in re.split(r'[, \s]+', raw_balloons):
        digits = re.sub(r'[^0-9]', '', token)
        if digits:
            recognized_balloons.add(int(digits))
    if not recognized_balloons:
        recognized_balloons = {500, 501, 1000, 1001, 3000, 3001, 5000, 5001}

    b_count = req.balloons or 0
    is_roulette_qualifying = allow_all or (b_count in recognized_balloons) or (b_count == 0 and req.external_id and str(req.external_id).startswith('manual_'))
    
    seoul_time = req.created_at or get_current_seoul_time()
    elapsed = calculate_broadcast_elapsed(started_at) if (is_active and started_at) else "미시작"
    
    if req.external_id:
        cursor.execute("SELECT id FROM alerts WHERE external_id = ?", (req.external_id,))
        if cursor.fetchone():
            conn.close()
            return {"status": "duplicate"}
            
    parsed_roulette = parse_roulette_result(req.roulette_result or "")
    
    if req.contribution is not None:
        roulette_val = req.contribution
        roulette_sign = '-' if roulette_val < 0 else '+'
    else:
        roulette_val = parsed_roulette['value']
        roulette_sign = parsed_roulette['sign']

    if not is_roulette_qualifying:
        roulette_val = 0

    # Auto-matching streamer from chat if streamer_name is empty or '선택'
    assigned_streamer = req.streamer_name
    if not assigned_streamer or assigned_streamer == "선택":
        cursor.execute("SELECT * FROM streamers")
        streamers = [dict(s) for s in cursor.fetchall()]
        assigned_streamer = match_streamer_by_chat(req.chat_message or "", streamers)

    cursor.execute("""
    INSERT INTO alerts (
        external_id, platform, created_at, broadcast_elapsed, user_id, nickname,
        balloons, chat_message, roulette_raw, roulette_percent, roulette_sign,
        roulette_value, streamer_name, multiplier, contribution, memo, status, round_number, is_example
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        req.external_id,
        "SOOP",
        seoul_time,
        elapsed,
        req.user_id or "",
        req.nickname or "",
        req.balloons or 0,
        req.chat_message or "",
        parsed_roulette['raw'],
        parsed_roulette['percent'],
        roulette_sign,
        roulette_val,
        assigned_streamer,
        req.multiplier or "기본배수",
        roulette_val,
        req.memo or "",
        "active",
        cur_round,
        req.is_example or 0
    ))
    new_id = cursor.lastrowid
    conn.commit()
    
    cursor.execute("SELECT * FROM alerts WHERE id = ?", (new_id,))
    new_row = dict(cursor.fetchone())
    conn.close()
    
    await manager.broadcast({
        "type": "NEW_ALERT",
        "data": new_row
    })
    return {"status": "ok", "alert": new_row}

@app.put("/api/alerts/{alert_id}")
async def update_alert(alert_id: int, req: AlertUpdateRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Alert not found")
        
    updates = []
    params = []
    if req.user_id is not None:
        updates.append("user_id = ?")
        params.append(req.user_id)
    if req.nickname is not None:
        updates.append("nickname = ?")
        params.append(req.nickname)
    if req.balloons is not None:
        updates.append("balloons = ?")
        params.append(req.balloons)
    if req.chat_message is not None:
        updates.append("chat_message = ?")
        params.append(req.chat_message)
    if req.streamer_name is not None:
        updates.append("streamer_name = ?")
        params.append(req.streamer_name)
    if req.roulette_sign is not None:
        updates.append("roulette_sign = ?")
        params.append(req.roulette_sign)
    if req.roulette_value is not None:
        updates.append("roulette_value = ?")
        params.append(req.roulette_value)
        updates.append("contribution = ?")
        params.append(req.roulette_value)
    if req.multiplier is not None:
        updates.append("multiplier = ?")
        params.append(req.multiplier)
    if req.memo is not None:
        updates.append("memo = ?")
        params.append(req.memo)
    if req.status is not None:
        updates.append("status = ?")
        params.append(req.status)
    if req.is_example is not None:
        updates.append("is_example = ?")
        params.append(req.is_example)
        
    if updates:
        params.append(alert_id)
        cursor.execute(f"UPDATE alerts SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        
    cursor.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,))
    updated_row = dict(cursor.fetchone())
    conn.close()
    
    await manager.broadcast({
        "type": "UPDATE_ALERT",
        "data": updated_row
    })
    return updated_row

@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
    conn.commit()
    conn.close()
    await manager.broadcast({"type": "DELETE_ALERT", "id": alert_id})
    return {"ok": True}

@app.post("/api/alerts/clear-examples")
async def clear_example_alerts():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM alerts WHERE is_example = 1")
    conn.commit()
    conn.close()
    await manager.broadcast({"type": "CLEAR_EXAMPLES"})
    return {"ok": True}

@app.post("/api/alerts/clear")
async def clear_alerts():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM alerts")
    conn.commit()
    conn.close()
    await manager.broadcast({"type": "CLEAR_ALERTS"})
    return {"ok": True}

@app.post("/api/settings")
async def save_settings(payload: dict = Body(...)):
    conn = get_db()
    cursor = conn.cursor()
    for k, v in payload.items():
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, str(v)))
    conn.commit()
    conn.close()
    await manager.broadcast({"type": "SETTINGS_CHANGED", "data": payload})
    return {"ok": True}

@app.get("/api/summary")
def get_summary():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM streamers ORDER BY order_index ASC")
    streamers = [dict(s) for s in cursor.fetchall()]
    
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('current_round', 'round_name', 'roulette_balloons', 'allow_all_balloons')")
    settings_dict = {r['key']: r['value'] for r in cursor.fetchall()}
    
    cur_round = int(settings_dict.get('current_round', '1'))
    rname = settings_dict.get('round_name', f"{cur_round}라운드")
    allow_all = (settings_dict.get('allow_all_balloons', 'false') == 'true')
    raw_balloons = settings_dict.get('roulette_balloons', '500, 501, 1000, 1001, 3000, 3001, 5000, 5001')

    import re
    recognized_balloons = set()
    for token in re.split(r'[, \s]+', raw_balloons):
        digits = re.sub(r'[^0-9]', '', token)
        if digits:
            recognized_balloons.add(int(digits))
    if not recognized_balloons:
        recognized_balloons = {500, 501, 1000, 1001, 3000, 3001, 5000, 5001}

    # CRITICAL: Exclude example rows (is_example = 1) from all calculations!
    cursor.execute("SELECT * FROM alerts WHERE status = 'active' AND (is_example IS NULL OR is_example = 0)")
    alerts = [dict(a) for a in cursor.fetchall()]
    conn.close()
    
    streamer_stats = {}
    for s in streamers:
        streamer_stats[s['name']] = {
            "name": s['name'],
            "color": s['color'],
            "count": 0,
            "balloons": 0,
            "current_score": 0,
            "total_score": 0
        }
    
    total_balloons = 0
    total_current_score = 0
    total_all_score = 0
    total_count = 0
    
    for a in alerts:
        balloons = a['balloons'] or 0
        ext_id = str(a.get('external_id') or '')
        val = a['roulette_value'] or 0
        is_roulette = allow_all or (balloons in recognized_balloons) or (balloons == 0 and ext_id.startswith('manual_') and val != 0)
        if not is_roulette:
            continue

        s_name = a['streamer_name']
        val = a['roulette_value']
        balloons = a['balloons']
        alert_round = a.get('round_number') or 1
        
        total_balloons += balloons
        total_all_score += val
        total_count += 1
        if alert_round == cur_round:
            total_current_score += val
        
        if s_name in streamer_stats:
            streamer_stats[s_name]['count'] += 1
            streamer_stats[s_name]['balloons'] += balloons
            streamer_stats[s_name]['total_score'] += val
            if alert_round == cur_round:
                streamer_stats[s_name]['current_score'] += val

    return {
        "current_round": cur_round,
        "round_name": rname,
        "streamers": list(streamer_stats.values()),
        "total": {
            "count": total_count,
            "balloons": total_balloons,
            "current_score": total_current_score,
            "total_score": total_all_score
        }
    }

@app.get("/api/export/excel")
def export_excel():
    conn = get_db()
    cursor = conn.cursor()
    # Exclude examples from Excel export
    cursor.execute("SELECT * FROM alerts WHERE status = 'active' AND (is_example IS NULL OR is_example = 0) ORDER BY id ASC")
    alerts = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM streamers ORDER BY order_index ASC")
    streamers = [dict(s) for s in cursor.fetchall()]
    conn.close()

    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {'in_memory': True})
    
    header_fmt = workbook.add_format({
        'bold': True, 'bg_color': '#E2E8F0', 'border': 1, 'align': 'center', 'valign': 'vcenter'
    })
    title_fmt = workbook.add_format({
        'bold': True, 'font_size': 12, 'bg_color': '#DBEAFE', 'border': 1, 'align': 'left'
    })
    cell_center = workbook.add_format({'border': 1, 'align': 'center', 'valign': 'vcenter'})
    cell_left = workbook.add_format({'border': 1, 'align': 'left', 'valign': 'vcenter'})
    cell_num = workbook.add_format({'border': 1, 'align': 'right', 'valign': 'vcenter', 'num_format': '#,##0'})
    total_fmt = workbook.add_format({
        'bold': True, 'bg_color': '#FEF3C7', 'border': 1, 'align': 'right', 'num_format': '#,##0'
    })
    total_lbl_fmt = workbook.add_format({
        'bold': True, 'bg_color': '#FEF3C7', 'border': 1, 'align': 'center'
    })

    headers_donation = ['ID', '시간', '방송시간', '닉네임', '아이디', '후원스트리머', '풍선종류', '개수', '기여도', '원플원', '채팅']

    # 1. 후원목록 시트
    ws_all = workbook.add_worksheet('후원목록')
    for col_idx, h in enumerate(headers_donation):
        ws_all.write(0, col_idx, h, header_fmt)

    for row_idx, a in enumerate(alerts, 1):
        ws_all.write(row_idx, 0, a['id'], cell_center)
        ws_all.write(row_idx, 1, a['created_at'], cell_center)
        ws_all.write(row_idx, 2, a['broadcast_elapsed'], cell_center)
        ws_all.write(row_idx, 3, a['nickname'], cell_left)
        ws_all.write(row_idx, 4, a['user_id'], cell_left)
        ws_all.write(row_idx, 5, a['streamer_name'], cell_center)
        ws_all.write(row_idx, 6, '별풍선', cell_center)
        ws_all.write(row_idx, 7, a['balloons'], cell_num)
        ws_all.write(row_idx, 8, a['roulette_value'], cell_num)
        ws_all.write(row_idx, 9, a['multiplier'], cell_center)
        ws_all.write(row_idx, 10, a['chat_message'], cell_left)
    ws_all.set_column('A:A', 6)
    ws_all.set_column('B:C', 18)
    ws_all.set_column('D:E', 15)
    ws_all.set_column('F:G', 12)
    ws_all.set_column('H:I', 10)
    ws_all.set_column('J:J', 10)
    ws_all.set_column('K:K', 35)

    # 2. 각 스트리머별 시트
    for s in streamers:
        s_name = s['name']
        safe_sheet_name = s_name.replace(':', '_').replace('\\', '_').replace('/', '_').replace('?', '_').replace('*', '_')[:28]
        s_alerts = [a for a in alerts if a['streamer_name'] == s_name]
        
        ws_s = workbook.add_worksheet(safe_sheet_name)
        for col_idx, h in enumerate(headers_donation):
            ws_s.write(0, col_idx, h, header_fmt)

        tot_balloons = 0
        tot_score = 0
        for row_idx, a in enumerate(s_alerts, 1):
            ws_s.write(row_idx, 0, a['id'], cell_center)
            ws_s.write(row_idx, 1, a['created_at'], cell_center)
            ws_s.write(row_idx, 2, a['broadcast_elapsed'], cell_center)
            ws_s.write(row_idx, 3, a['nickname'], cell_left)
            ws_s.write(row_idx, 4, a['user_id'], cell_left)
            ws_s.write(row_idx, 5, a['streamer_name'], cell_center)
            ws_s.write(row_idx, 6, '별풍선', cell_center)
            ws_s.write(row_idx, 7, a['balloons'], cell_num)
            ws_s.write(row_idx, 8, a['roulette_value'], cell_num)
            ws_s.write(row_idx, 9, a['multiplier'], cell_center)
            ws_s.write(row_idx, 10, a['chat_message'], cell_left)
            tot_balloons += a['balloons']
            tot_score += a['roulette_value']

        last_row = len(s_alerts) + 1
        ws_s.write(last_row, 0, '합계', total_lbl_fmt)
        for c in range(1, 7):
            ws_s.write(last_row, c, '', total_lbl_fmt)
        ws_s.write(last_row, 7, tot_balloons, total_fmt)
        ws_s.write(last_row, 8, tot_score, total_fmt)
        ws_s.write(last_row, 9, '', total_lbl_fmt)
        ws_s.write(last_row, 10, '', total_lbl_fmt)

        ws_s.set_column('A:A', 6)
        ws_s.set_column('B:C', 18)
        ws_s.set_column('D:E', 15)
        ws_s.set_column('F:G', 12)
        ws_s.set_column('H:I', 10)
        ws_s.set_column('J:J', 10)
        ws_s.set_column('K:K', 35)

    # 3. 전체 후원자 순위 시트
    user_totals = {}
    for a in alerts:
        uid = a['user_id'] or a['nickname']
        if uid not in user_totals:
            user_totals[uid] = {
                'nickname': a['nickname'] or uid,
                'user_id': a['user_id'],
                'balloons': 0,
                'score': 0,
                'count': 0
            }
        user_totals[uid]['balloons'] += a['balloons']
        user_totals[uid]['score'] += a['roulette_value']
        user_totals[uid]['count'] += 1

    sorted_users = sorted(user_totals.values(), key=lambda x: x['balloons'], reverse=True)

    ws_rank = workbook.add_worksheet('전체 후원자 순위')
    ws_rank.merge_range('A1:F1', '후원목록  |  후원자별 총 후원 개수', title_fmt)
    rank_headers = ['순위', '닉네임', '아이디', '총 후원 개수', '총 기여도', '후원 건수']
    for col_idx, h in enumerate(rank_headers):
        ws_rank.write(1, col_idx, h, header_fmt)

    tot_rank_balloons = 0
    tot_rank_score = 0
    tot_rank_count = 0
    for idx, u in enumerate(sorted_users, 1):
        r_row = idx + 1
        ws_rank.write(r_row, 0, idx, cell_center)
        ws_rank.write(r_row, 1, u['nickname'], cell_left)
        ws_rank.write(r_row, 2, u['user_id'], cell_left)
        ws_rank.write(r_row, 3, u['balloons'], cell_num)
        ws_rank.write(r_row, 4, u['score'], cell_num)
        ws_rank.write(r_row, 5, u['count'], cell_center)
        tot_rank_balloons += u['balloons']
        tot_rank_score += u['score']
        tot_rank_count += u['count']

    sum_row = len(sorted_users) + 2
    ws_rank.write(sum_row, 0, '합계', total_lbl_fmt)
    ws_rank.write(sum_row, 1, f'{len(sorted_users)}명', total_lbl_fmt)
    ws_rank.write(sum_row, 2, '', total_lbl_fmt)
    ws_rank.write(sum_row, 3, tot_rank_balloons, total_fmt)
    ws_rank.write(sum_row, 4, tot_rank_score, total_fmt)
    ws_rank.write(sum_row, 5, tot_rank_count, total_fmt)

    ws_rank.set_column('A:A', 8)
    ws_rank.set_column('B:C', 18)
    ws_rank.set_column('D:E', 15)
    ws_rank.set_column('F:F', 12)

    # 4. 각 스트리머별 후원자 순위 시트
    for s in streamers:
        s_name = s['name']
        s_user_totals = {}
        s_alerts = [a for a in alerts if a['streamer_name'] == s_name]
        for a in s_alerts:
            uid = a['user_id'] or a['nickname']
            if uid not in s_user_totals:
                s_user_totals[uid] = {
                    'nickname': a['nickname'] or uid,
                    'user_id': a['user_id'],
                    'balloons': 0,
                    'score': 0,
                    'count': 0
                }
            s_user_totals[uid]['balloons'] += a['balloons']
            s_user_totals[uid]['score'] += a['roulette_value']
            s_user_totals[uid]['count'] += 1

        s_sorted = sorted(s_user_totals.values(), key=lambda x: x['balloons'], reverse=True)
        sheet_rank_name = f"{s_name} 순위"[:28]
        ws_s_rank = workbook.add_worksheet(sheet_rank_name)
        ws_s_rank.merge_range('A1:F1', f'{s_name}  |  후원자별 총 후원 개수', title_fmt)
        for col_idx, h in enumerate(rank_headers):
            ws_s_rank.write(1, col_idx, h, header_fmt)

        tot_s_b = 0
        tot_s_sc = 0
        tot_s_cnt = 0
        for idx, u in enumerate(s_sorted, 1):
            r_row = idx + 1
            ws_s_rank.write(r_row, 0, idx, cell_center)
            ws_s_rank.write(r_row, 1, u['nickname'], cell_left)
            ws_s_rank.write(r_row, 2, u['user_id'], cell_left)
            ws_s_rank.write(r_row, 3, u['balloons'], cell_num)
            ws_s_rank.write(r_row, 4, u['score'], cell_num)
            ws_s_rank.write(r_row, 5, u['count'], cell_center)
            tot_s_b += u['balloons']
            tot_s_sc += u['score']
            tot_s_cnt += u['count']

        sum_row = len(s_sorted) + 2
        ws_s_rank.write(sum_row, 0, '합계', total_lbl_fmt)
        ws_s_rank.write(sum_row, 1, f'{len(s_sorted)}명', total_lbl_fmt)
        ws_s_rank.write(sum_row, 2, '', total_lbl_fmt)
        ws_s_rank.write(sum_row, 3, tot_s_b, total_fmt)
        ws_s_rank.write(sum_row, 4, tot_s_sc, total_fmt)
        ws_s_rank.write(sum_row, 5, tot_s_cnt, total_fmt)

        ws_s_rank.set_column('A:A', 8)
        ws_s_rank.set_column('B:C', 18)
        ws_s_rank.set_column('D:E', 15)
        ws_s_rank.set_column('F:F', 12)

    workbook.close()
    output.seek(0)
    filename = f"danbal_roulette_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(STATIC_DIR):
    try:
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    except Exception:
        pass
