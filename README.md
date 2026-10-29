# SKT ALEPH T04 — 일본 지진 정보 모니터 / 日本地震情報モニタ

공개 P2P地震情報의 일본 기상청 지진 발표를 Flask에서 가져와 최신 규모(M), 진앙, 발표·발생·조회 시각과 JST/KST를 표시하는 학습 프로젝트입니다.

## 로컬 실행

```bash
python -m venv .venv
# Windows Git Bash: source .venv/Scripts/activate
pip install -r requirements.txt
python app.py
```

브라우저에서 `http://127.0.0.1:5000`을 엽니다. 외부 API와 지도 타일을 불러오려면 인터넷이 필요합니다.

## 실제 데이터

- 출처: https://api.p2pquake.net/v2/jma/quake (일본 기상청 발표를 전달하는 P2P地震情報)
- `GET /api/live`: 최신 발표, FRESH/STALE 상태, KST 날짜별 저장 기록 및 전후 비교
- `GET /api/recent`: 최근 발표 표본을 5분 동안 서버 메모리에 캐시 (완전한 일별 발생 건수 통계가 아님)
- `data/daily_records.json`: 실제 수집한 날짜별 데이터. **실제 데이터와 합성 fixture를 섞지 않습니다.**
- 본 저장 구현은 같은 날짜·signal_id의 데이터를 한 행으로 갱신합니다. 배포 환경에서는 영속 디스크/데이터베이스가 필요합니다.
- UI의 긴급 화면은 디자인 시연이며 실제 경보가 아닙니다.

## 합성 시험 (로컬)

```bash
python t04_verify.py
```

`fixtures/`의 9개 합성 데이터로 D1-A(100) → D1-B(105, 같은 날짜) → D2(120, 다음 날짜), 오류 5종, 복구를 테스트합니다. `t04_verify.py`는 임시 저장 경로를 사용하므로 실제 `data/daily_records.json`을 변경하지 않습니다. **이 결과는 로컬 검증이며 공식 심판 통과나 공개 페이지의 시험 재현을 보장하지 않습니다.**

웹페이지의 `/api/simulate/<scenario>`는 별도의 UI 시연이며 위의 fixture 실행과 동일하지 않습니다.

## 배포 및 제한사항

- 개발용 `app.py`를 그대로 Vercel에 올려 **영속적 파일 저장이 보장되지는 않습니다**. 호스팅을 결정한 후 영구 저장소와 공개 접속을 별도로 검증해야 합니다.
- `app.py`에서 Flask 디버그 모드는 꺼져 있습니다.
- `.venv`, `.env`, Git 내부 파일, 임시 수정 스크립트 및 예전 버전 문서는 이 제출용 패키지에서 제외했습니다.
- 실제 원천 기록의 10월 27일 파일에는 URL·단위 필드가 저장되어 있지 않습니다. 이 자료만으로 T04-C23 전체 충족을 주장하지 않습니다.
- 플랫폼 과정 기록 영수증과 공개 URL, commit SHA, 네트워크·Git 히스토리 보안 검증은 별도로 필요합니다.

## 주요 파일

```text
app.py                   Flask 서버
requirements.txt         Python 의존성
templates/index.html     화면
static/app.js            지도 및 데이터 갱신
static/style.css         스타일
static/fuji-header.svg   헤더 이미지
data/                    실제 수집된 지진 기록 및 원본
fixtures/                공식 합성 시험 JSON 9종
t04_verify.py            실제 Flask 처리 함수를 이용한 로컬 fixture 검증
```
