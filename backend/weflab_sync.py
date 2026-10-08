import requests
import re
import hashlib
import time
import threading
from datetime import datetime
from bs4 import BeautifulSoup if False else None # we can use regex or lxml
from lxml import html as lxml_html
from backend.database import get_db, get_current_seoul_time, calculate_broadcast_elapsed
from backend.parser import parse_roulette_result

class WeflabPoller:
    def __init__(self, check_interval=5):
        self.check_interval = check_interval
        self.running = False
        self.thread = None
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        })

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False

    def _run_loop(self):
        while self.running:
            try:
                self.poll_once()
            except Exception as e:
                print(f"[WeflabPoller] Polling error: {e}")
            time.sleep(self.check_interval)

    def poll_once(self):
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = 'weflab_cookie'")
        row = cursor.fetchone()
        cookie = row['value'] if row else ""
        
        cursor.execute("SELECT value FROM settings WHERE key = 'broadcast_active'")
        b_active_row = cursor.fetchone()
        is_active = (b_active_row['value'] == 'true') if b_active_row else False
        
        cursor.execute("SELECT value FROM settings WHERE key = 'broadcast_started_at'")
        b_start_row = cursor.fetchone()
        b_start = b_start_row['value'] if b_start_row else ""
        conn.close()

        if not cookie:
            return

        headers = {
            "Cookie": cookie
        }
        resp = self.session.get("https://weflab.com/alertlist", headers=headers, timeout=10)
        if resp.status_code != 200 or "login" in resp.url.lower():
            return

        self.parse_and_insert_html(resp.text, is_active, b_start)

    def parse_and_insert_html(self, html_content: str, broadcast_active: bool, broadcast_start: str):
        try:
            tree = lxml_html.fromstring(html_content)
        except Exception as e:
            print(f"[WeflabPoller] Parse error: {e}")
            return

        # Look for table rows in alert list
        # Typical weflab structure has tr or div rows
        rows = tree.xpath("//tr[contains(@class, 'alert')] | //div[contains(@class, 'alert_item')] | //tbody/tr")
        if not rows:
            return

        conn = get_db()
        cursor = conn.cursor()

        # Load streamers for auto-matching
        cursor.execute("SELECT id, name, keywords FROM streamers")
        streamers = cursor.fetchall()

        for r in rows:
            text_cells = [c.text_content().strip() for c in r.xpath(".//td | .//div")]
            if len(text_cells) < 3:
                continue

            full_text = " ".join(text_cells)
            ext_id = hashlib.md5(full_text.encode('utf-8')).hexdigest()

            # Check if already inserted
            cursor.execute("SELECT id FROM alerts WHERE external_id = ?", (ext_id,))
            if cursor.fetchone():
                continue

            # Process alert row
            # Extract time, nickname, id, balloons, chat, roulette
            # Let's handle row fields
            # ...
        conn.close()

weflab_poller = WeflabPoller()
