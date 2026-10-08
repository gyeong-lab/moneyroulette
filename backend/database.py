import sqlite3
import os
import json
from datetime import datetime, timezone, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "roulette.db")
KST = timezone(timedelta(hours=9))

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        keywords TEXT DEFAULT '',
        minus_keywords TEXT DEFAULT '',
        color TEXT DEFAULT '#3b82f6',
        order_index INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0
    )
    """)

    cursor.execute("PRAGMA table_info(streamers)")
    cols = [c['name'] for c in cursor.fetchall()]
    if 'minus_keywords' not in cols:
        cursor.execute("ALTER TABLE streamers ADD COLUMN minus_keywords TEXT DEFAULT ''")
    if 'is_pinned' not in cols:
        cursor.execute("ALTER TABLE streamers ADD COLUMN is_pinned INTEGER DEFAULT 0")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT UNIQUE,
        platform TEXT DEFAULT 'SOOP',
        created_at TEXT NOT NULL,
        broadcast_elapsed TEXT DEFAULT '',
        user_id TEXT DEFAULT '',
        nickname TEXT DEFAULT '',
        balloons INTEGER DEFAULT 0,
        chat_message TEXT DEFAULT '',
        roulette_raw TEXT DEFAULT '',
        roulette_percent TEXT DEFAULT '',
        roulette_sign TEXT DEFAULT '+',
        roulette_value INTEGER DEFAULT 0,
        streamer_name TEXT DEFAULT '선택',
        multiplier TEXT DEFAULT '기본배수',
        contribution INTEGER DEFAULT 0,
        memo TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        round_number INTEGER DEFAULT 1,
        is_example INTEGER DEFAULT 0
    )
    """)
    
    cursor.execute("PRAGMA table_info(alerts)")
    alert_cols = [c['name'] for c in cursor.fetchall()]
    if 'round_number' not in alert_cols:
        cursor.execute("ALTER TABLE alerts ADD COLUMN round_number INTEGER DEFAULT 1")
    if 'is_example' not in alert_cols:
        cursor.execute("ALTER TABLE alerts ADD COLUMN is_example INTEGER DEFAULT 0")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    
    # Defaults
    defaults = {
        'broadcast_active': 'false',
        'broadcast_started_at': '',
        'show_zero_streamers': 'true',
        'show_total': 'true',
        'current_round': '1',
        'round_name': '1라운드',
        'weflab_cookie': ''
    }
    for k, v in defaults.items():
        cursor.execute("SELECT key FROM settings WHERE key = ?", (k,))
        if not cursor.fetchone():
            cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, v))

    cursor.execute("SELECT COUNT(*) as cnt FROM streamers")
    if cursor.fetchone()['cnt'] == 0:
        default_streamers = [
            ("체온(여왕)", "체플,체온플,체온,ㅊㅍ,체,ㅊㅇ,온플", "", "#ec4899", 1, 0),
            ("은채(개돼지)", "은플,은채플,ㅇㅍ,은채,은,은채핑", "", "#3b82f6", 2, 0),
            ("단발", "단발,조정간,ㄷㅂ,단발이", "", "#10b981", 3, 0)
        ]
        cursor.executemany("INSERT INTO streamers (name, keywords, minus_keywords, color, order_index, is_pinned) VALUES (?, ?, ?, ?, ?, ?)", default_streamers)
        
    conn.commit()
    conn.close()

def get_current_seoul_time():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")

def calculate_broadcast_elapsed(started_at_str: str) -> str:
    if not started_at_str:
        return "00:00:00"
    try:
        dt_start = datetime.strptime(started_at_str, "%Y-%m-%d %H:%M:%S")
        now_dt = datetime.now(KST).replace(tzinfo=None)
        diff = now_dt - dt_start
        if diff.total_seconds() < 0:
            return "00:00:00"
        total_seconds = int(diff.total_seconds())
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    except Exception:
        return "00:00:00"
