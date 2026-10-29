"""Japan Seismic Monitor — no credentials, public API, one genuine daily snapshot per KST date."""
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template

ROOT = Path(__file__).resolve().parent
RECORDS_PATH = ROOT / 'data' / 'daily_records.json'
API_URL = 'https://api.p2pquake.net/v2/jma/quake'
KST = timezone(timedelta(hours=9))
app = Flask(__name__)

# Recent bulletin cache: successful results are reused for five minutes.
RECENT_CACHE = None
RECENT_CACHE_TIME = 0.0


def saved_records():
    if not RECORDS_PATH.exists():
        return []
    try:
        data = json.loads(RECORDS_PATH.read_text(encoding='utf-8'))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def last_saved():
    records = saved_records()
    return max(records, key=lambda r: r.get('date', '')) if records else None


def fetch_current():
    response = requests.get(API_URL, timeout=10)
    response.raise_for_status()
    items = response.json()
    if not isinstance(items, list) or not items:
        raise ValueError('SCHEMA_CHANGED: 응답 목록을 확인할 수 없습니다.')
    for item in items:
        try:
            quake = item['earthquake']
            hypo = quake['hypocenter']
            mag = hypo['magnitude']
            if (not isinstance(mag, (float, int)) or isinstance(mag, bool)
                    or not (0 <= mag <= 10)):
                continue
            location = hypo['name']
            event_time = quake['time']
            issue_time = item['issue']['time']
            if not all(isinstance(v, str) and v.strip() for v in (location, event_time, issue_time)):
                continue
            pos = {'latitude': hypo.get('latitude'), 'longitude': hypo.get('longitude')}
            try:
                lat, lon = float(pos['latitude']), float(pos['longitude'])
                if not (24 <= lat <= 46 and 122 <= lon <= 148):
                    lat, lon = None, None
            except (ValueError, TypeError):
                lat, lon = None, None
            fetched = datetime.now(KST)
            return {
                'date': fetched.date().isoformat(), 'magnitude': mag,
                'location': location, 'event_time': event_time,
                'issued_time': issue_time, 'fetched_at': fetched.isoformat(),
                'source': '気象庁 / P2P地震情報', 'source_url': API_URL,
                'unit': 'M', 'latitude': lat, 'longitude': lon,
                'depth': hypo.get('depth') if isinstance(hypo.get('depth'), (int,float)) else None,
                'max_intensity': quake.get('maxScale') if isinstance(quake.get('maxScale'), (int,float)) else None
            }
        except (KeyError, TypeError, IndexError):
            continue
    raise ValueError('SCHEMA_CHANGED: 유효한 지진 정보를 찾지 못했습니다.')


def error_code(exc):
    if isinstance(exc, requests.exceptions.Timeout): return 'TIMEOUT'
    if isinstance(exc, requests.exceptions.ConnectionError): return 'OFFLINE'
    if isinstance(exc, requests.exceptions.HTTPError):
        code = exc.response.status_code if exc.response is not None else 0
        return 'RATE_LIMIT' if code == 429 else ('ACCESS_DENIED' if code in (401, 403) else f'HTTP_{code}')
    if isinstance(exc, ValueError): return 'SCHEMA_CHANGED'
    return 'REQUEST_ERROR'


def store_daily(snapshot):
    """Upsert one record per KST date and signal, preserving stable record identity.

    Existing dates other than the matching date are not changed. Real observations
    are never mixed with fixture data (fixture runner overrides RECORDS_PATH).
    """
    import os
    import tempfile
    import uuid

    records = saved_records()
    signal = snapshot.get('signal_id', 'japan-seismic-monitor')
    key = str(snapshot['date'])
    updated = dict(snapshot)
    updated.setdefault('signal_id', signal)

    matched = None
    for idx, row in enumerate(records):
        if str(row.get('date')) == key and row.get('signal_id', 'japan-seismic-monitor') == signal:
            matched = idx
            break
    if matched is None:
        updated.setdefault('record_id', str(uuid.uuid4()))
        records.append(updated)
    else:
        updated['record_id'] = records[matched].get('record_id') or str(uuid.uuid4())
        records[matched] = updated

    RECORDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, path = tempfile.mkstemp(prefix='.daily-', suffix='.json', dir=str(RECORDS_PATH.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            json.dump(records, file, ensure_ascii=False, indent=2)
        os.replace(path, RECORDS_PATH)
    finally:
        if os.path.exists(path):
            os.unlink(path)
    return records


def live_payload():
    try:
        current = fetch_current()
        records = store_daily(current)
        status, error = 'FRESH', None
    except (requests.exceptions.RequestException, ValueError, OSError) as exc:
        current = last_saved()
        records = saved_records()
        status, error = 'STALE', error_code(exc)
    sorted_rows = sorted(records, key=lambda row: str(row.get('date', '')))
    comparison = None
    if len(sorted_rows) >= 2:
        prev, curr = sorted_rows[-2], sorted_rows[-1]
        try:
            difference = round(float(curr['magnitude']) - float(prev['magnitude']), 1)
            comparison = {'previous': prev, 'current': curr, 'difference': difference}
        except (ValueError, TypeError, KeyError):
            pass
    return {'status': status, 'error_code': error, 'latest': current,
            'records': sorted_rows, 'comparison': comparison,
            'checked_at': datetime.now(KST).isoformat()}


@app.get('/')
def index():
    return render_template('index.html')


def recent_earthquakes():
    """Second live JSON feed: bounded JMA quake bulletin history, NOT daily snapshots."""
    response = requests.get(API_URL, params={'limit': 100}, timeout=10)
    response.raise_for_status()
    entries = response.json()
    if not isinstance(entries, list):
        raise ValueError('최근 지진 목록 형식 오류')
    result, keys = [], set()
    for item in entries:
        if not isinstance(item, dict):
            continue
        eq = item.get('earthquake') or {}
        hyp = eq.get('hypocenter') or {}
        if not isinstance(eq, dict) or not isinstance(hyp, dict):
            continue
        magnitude = hyp.get('magnitude')
        event_time, location = eq.get('time'), hyp.get('name')
        if (not isinstance(magnitude, (int,float)) or isinstance(magnitude,bool)
                or magnitude < 0 or not isinstance(event_time,str)
                or not isinstance(location,str)):
            continue
        try:
            date = datetime.strptime(event_time, '%Y/%m/%d %H:%M:%S')
        except ValueError:
            continue
        # Multiple bulletins can describe the same quake; avoid counting them twice.
        key = (event_time, location)
        if key in keys:
            continue
        keys.add(key)
        row = {'event_time': event_time, 'magnitude': magnitude,
               'location': location, 'event_date': date.date().isoformat(),
               'hour': date.hour, 'max_intensity': eq.get('maxScale'),
               'depth': hyp.get('depth')}
        lat, lon = hyp.get('latitude'), hyp.get('longitude')
        if isinstance(lat,(int,float)) and isinstance(lon,(int,float)) and 24 <= lat <= 46 and 122 <= lon <= 148:
            row.update(latitude=lat,longitude=lon)
        result.append(row)
    return {'events': result, 'sample_size': len(entries), 'source_url': API_URL+'?limit=100',
            'note': '최근 최대 100건의 발표 중 중복 지진을 제거한 표본입니다. 완전한 하루별 발생 횟수가 아닙니다.',
            'fetched_at': datetime.now(KST).isoformat()}


@app.get('/api/recent')
def api_recent():
    global RECENT_CACHE, RECENT_CACHE_TIME

    now = time.monotonic()
    if RECENT_CACHE is not None and now - RECENT_CACHE_TIME < 300:
        return jsonify(RECENT_CACHE)

    try:
        result = recent_earthquakes()
        # Cache only successful responses. Never cache empty error responses.
        RECENT_CACHE = result
        RECENT_CACHE_TIME = time.monotonic()
        return jsonify(result)
    except (requests.exceptions.RequestException, ValueError) as exc:
        return jsonify({'events': [], 'error_code': error_code(exc),
                        'note': '과거 지진 목록을 조회할 수 없습니다. 통계는 표시하지 않습니다.'}), 503


@app.get('/api/live')
def api_live():
    return jsonify(live_payload())


# Synthetic demonstrations are isolated: never call the live source or write daily data.
CASES = {
    'timeout': ('TIMEOUT', '응답이 제한 시간 안에 도착하지 않았습니다.', '잠시 후 다시 시도하세요.'),
    'denied': ('HTTP_403', '외부 원천에서 접근을 거절했습니다.', '서비스 권한과 응답 코드를 확인하세요.'),
    'rate': ('HTTP_429', '외부 원천의 요청 제한에 걸렸습니다.', '잠시 기다린 뒤 다시 시도하세요.'),
    'offline': ('OFFLINE', '외부 원천에 연결할 수 없습니다.', '네트워크 연결을 확인하세요.'),
    'schema': ('SCHEMA_CHANGED', '응답 필드 구조가 예상과 다릅니다.', '원자료 형식을 확인하세요.'),
}


@app.get('/api/simulate/<scenario>')
def simulate(scenario):
    if scenario == 'recover':
        return jsonify({'status': 'FRESH', 'error_code': None,
                        'message': '합성 복구 예시입니다. 실제 API 및 저장 기록은 변경하지 않습니다.',
                        'synthetic': True})
    if scenario not in CASES:
        return jsonify({'error': '알 수 없는 테스트 종류'}), 404
    code, message, action = CASES[scenario]
    return jsonify({'status': 'STALE', 'error_code': code, 'message': message,
                    'action': action, 'last_good': last_saved(), 'synthetic': True})


if __name__ == '__main__':
    app.run(debug=False)
