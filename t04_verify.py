"""T04 official fixture replay through actual Flask app live_payload + store_daily.
No network, no modification of live data, no official grader assertions.
"""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import requests

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('t04_under_test', HERE/'app.py')
appmod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(appmod)

FILES={
 'D1-A':'normal-d1-a.json','D1-B':'normal-d1-b.json','D2':'normal-d2.json',
 'TIMEOUT':'timeout.json','AUTH-401':'auth-401.json','RATE-429':'rate-429.json',
 'OFFLINE':'offline.json','SCHEMA-BREAK':'schema-break.json','RECOVER-D2':'recover-d2.json'
}
ALIAS={None:'none','TIMEOUT':'timeout','OFFLINE':'offline','ACCESS_DENIED':'auth',
       'RATE_LIMIT':'rate_limit','SCHEMA_CHANGED':'schema_error'}

def fixture(name):
    return json.loads((HERE/'fixtures'/FILES[name]).read_text(encoding='utf-8'))

def fake_fetch(d):
    tr=d['transport']
    mode=tr['mode']
    if mode=='timeout':
        raise requests.exceptions.Timeout('fixture timeout')
    if mode=='offline':
        raise requests.exceptions.ConnectionError('fixture offline')
    if tr.get('status') in (401,403,429):
        r=requests.Response();r.status_code=tr['status'];r.url='https://fixtures.aleph.invalid/t04'
        raise requests.exceptions.HTTPError('fixture HTTP '+str(r.status_code),response=r)
    payload=d['payload']
    if not isinstance(payload,dict) or type(payload.get('normalized_value')) not in (int,float):
        raise ValueError('SCHEMA_CHANGED: invalid normalized_value')
    return {'date':payload['record_date'], 'signal_id':payload['signal_id'],
            'magnitude':payload['normalized_value'], 'unit':payload['unit'],
            'location':payload['source_name'],'source':payload['source_name'],
            'source_url':payload['source_url'],'issued_time':payload.get('source_time'),
            'event_time':payload.get('source_time'),'fetched_at':payload['fetched_at']}

def run_sequence(seq):
    with tempfile.TemporaryDirectory(prefix='t04-verified-') as temp:
        with patch.object(appmod, 'RECORDS_PATH', Path(temp)/'daily_records.json'):
            out=[]
            id_first=None
            for name in seq:
                d=fixture(name)
                with patch.object(appmod, 'fetch_current', side_effect=lambda d=d:fake_fetch(d)):
                    got=appmod.live_payload()
                rows=appmod.saved_records()
                expected=d['expected']
                actual={
                    'freshness':got['status'].lower(),
                    'error_code':ALIAS.get(got['error_code'],str(got['error_code'])),
                    'row_count':len(rows),
                    'stored_value':got['latest']['magnitude'] if got['latest'] else None,
                    'delta':got['comparison']['difference'] if got['comparison'] else None,
                }
                checks=[f'{key}: {actual.get(key)!r} != {value!r}' for key,value in expected.items()
                        if key in actual and actual.get(key)!=value]
                if name=='D1-A':
                    id_first=rows[0].get('record_id') if rows else None
                    if not id_first:checks.append('record_id missing')
                if name=='D1-B' and (not rows or rows[0].get('record_id')!=id_first):
                    checks.append('D1 stable record_id not preserved')
                if expected.get('record_date') and (not rows or rows[-1].get('date')!=expected['record_date']):
                    checks.append('record_date mismatch')
                print(f"{'PASS' if not checks else 'FAIL'}  {d['fixture_id']:21} stored={actual['stored_value']} rows={actual['row_count']} status={actual['freshness']}/{actual['error_code']} delta={actual['delta']}")
                for fail in checks: print('     ->',fail)
                out.extend(checks)
            return not out

def main():
    print('T04 replay against actual app.py live_payload() and store_daily()')
    print('All fixture storage is inside temporary directories; no real API calls.\n')
    okay=run_sequence(['D1-A','D1-B','D2'])
    for bad in ['TIMEOUT','AUTH-401','RATE-429','OFFLINE','SCHEMA-BREAK']:
        okay=run_sequence(['D1-A','D1-B',bad]) and okay
    okay=run_sequence(['D1-A','D1-B','TIMEOUT','RECOVER-D2']) and okay
    print('\n' + ('PASS: all fixture replay assertions' if okay else 'FAIL: inspect checks above'))
    print('Independent local replay only — official grader, day receipts, public deployment NOT verified.')
    return 0 if okay else 1

if __name__=='__main__':sys.exit(main())
