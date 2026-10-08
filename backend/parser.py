import re

def parse_roulette_result(text: str):
    """
    Parses roulette text like:
    - '(0.6%) 1812' -> percent: '0.6%', is_minus: False, value: 1812
    - '(5.0%) -500' -> percent: '5.0%', is_minus: True, value: -500
    - '-500' -> percent: None, is_minus: True, value: -500
    - '1812' -> percent: None, is_minus: False, value: 1812
    - '꽝' -> percent: None, is_minus: False, value: 0, is_kkwang: True
    """
    if not text:
        return {
            "has_roulette": False,
            "raw": "",
            "percent": "",
            "sign": "+",
            "value": 0,
            "is_kkwang": False
        }

    text = text.strip()
    
    # Check for percentage e.g. (0.6%)
    percent_match = re.search(r'\(\s*([\d\.]+%?)\s*\)', text)
    percent_str = percent_match.group(1) if percent_match else ""
    if percent_str and not percent_str.endswith('%'):
        percent_str += '%'

    rem = re.sub(r'\(\s*[\d\.]+[%]?\s*\)', '', text).strip()
    is_kkwang = "꽝" in rem
    
    minus_match = re.search(r'-\s*([\d,]+)', rem)
    plus_match = re.search(r'\+?\s*([\d,]+)', rem)
    
    if is_kkwang:
        return {
            "has_roulette": True,
            "raw": text,
            "percent": percent_str,
            "sign": "꽝",
            "value": 0,
            "is_kkwang": True
        }
    elif minus_match:
        val = int(minus_match.group(1).replace(',', ''))
        return {
            "has_roulette": True,
            "raw": text,
            "percent": percent_str,
            "sign": "-",
            "value": -val,
            "is_kkwang": False
        }
    elif plus_match and plus_match.group(1):
        val = int(plus_match.group(1).replace(',', ''))
        return {
            "has_roulette": True,
            "raw": text,
            "percent": percent_str,
            "sign": "+",
            "value": val,
            "is_kkwang": False
        }
    else:
        return {
            "has_roulette": bool(percent_str),
            "raw": text,
            "percent": percent_str,
            "sign": "+",
            "value": 0,
            "is_kkwang": False
        }

def match_streamer_by_chat(chat: str, streamers: list) -> str:
    """
    example.3 rules:
    - Matches streamer based on +keywords and base names.
    - If multiple keywords appear, recognizes the last keyword in the chat.
    - 1-character keywords only match if exact/standalone token.
    """
    if not chat:
        return "선택"

    chat = chat.strip()
    last_match = None
    last_idx = -1

    for s in streamers:
        raw_kw = s.get('keywords', '') or ''
        kw_list = [k.strip() for k in raw_kw.split(',') if k.strip()]
        # also add name without parenthesis
        base_name = s['name'].split('(')[0].strip()
        if base_name and base_name not in kw_list:
            kw_list.append(base_name)

        for kw in kw_list:
            if not kw:
                continue
            if len(kw) == 1:
                # 1-character keyword rule:
                # Must be whole word or exact match to prevent accidental substring match
                if chat == kw or f" {kw} " in f" {chat} " or chat.startswith(f"{kw} ") or chat.endswith(f" {kw}"):
                    idx = chat.rfind(kw)
                    if idx >= last_idx:
                        last_idx = idx
                        last_match = s['name']
            else:
                idx = chat.rfind(kw)
                if idx != -1 and idx >= last_idx:
                    last_idx = idx
                    last_match = s['name']

    return last_match or "선택"
