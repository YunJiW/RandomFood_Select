# 점심 뭐 먹지?

점심 메뉴를 랜덤으로 뽑아주는 Electron 데스크탑 앱입니다.

## 기술 스택

- **Electron 34** — 데스크탑 앱 프레임워크
- **Node.js** — 메인 프로세스 로직 (로컬 HTTP 서버, IPC, 외부 API 호출)
- **sql.js** — WebAssembly 기반 SQLite (JSON 직렬화 영구 저장)
- **Kakao Maps SDK** — 지도 표시 (JavaScript Key)
- **Kakao Local API** — 주변 장소 검색 (REST API Key)

## 기능

### 랜덤 뽑기
- 슬롯 애니메이션(80ms 간격) 후 메뉴 확정, 스프링 바운스 + 글로우 연출
- 카테고리 필터 (한식 / 중식 / 일식 / 양식 / 분식 / 기타)
- 즐겨찾기 전용 필터
- 쿨다운 설정 (최근 N일 이내 뽑힌 메뉴 자동 제외)
- 뽑기 결과 후 `근처 가게 찾기` 버튼으로 카카오 지도 연동
- `Enter` / `Space` 단축키로 현재 탭 즉시 뽑기

### 돌림판
- Canvas 직접 렌더링, 가중치 비례 부채꼴 분할
- 메뉴별 가중치 1~99 설정 → 실시간 확률(%) 표시
- easeOut 감속 곡선으로 자연스러운 회전 정지
- `바로 결과보기` 버튼으로 회전 중 즉시 결과 확인

### 마블 룰렛
- 전체 메뉴 수만큼 구슬 생성, 물리 시뮬레이션 낙하
- 4개 구역: ENTRY → SLALOM → MID → EXIT → NARROW → FINISH
  - **ENTRY**: 사이드 가이드 레일 + 핀볼 스프링 범퍼 3개(충돌 시 속도 부스트·발광) + 플링코 핀
  - **SLALOM**: 교차 대각선 범퍼 4개 + 사이 핀 3줄 + 중앙 교차 범퍼로 경로 복잡화
  - **MID**: 좁아진 지그재그 통로 + 대형 핀 4개 + 3-팔 회전 장애물 2개
  - **EXIT**: 플링코 핀 + V자 경로 분기 범퍼 2세트
  - **NARROW**: 깔때기 → 2-팔 회전 장애물 → FINISH 라인
- 회전 장애물 총 3개 (NARROW 1 + MID 좌우 2)
- 마지막 통과 구슬이 당첨
- 출발 전 `섞기` 버튼으로 구슬 위치 재배치 (Fisher-Yates 셔플)
- 미니맵 + 뷰포트 자동 스크롤, 스킵 버튼 지원
- 창 크기 변경 시 진행 중 구슬 상태 유지 (트랙/미니맵만 재계산)

### 메뉴 관리
- 메뉴 추가 / 수정(모달) / 삭제
- 카테고리 지정 (한식 · 중식 · 일식 · 양식 · 분식 · 기타)
- 즐겨찾기(★) 토글
- 뽑기 제외(⊘) 토글

### 히스토리 & 통계
- 최근 30개 뽑기 기록 시간순 표시
- TOP 5 메뉴 바 차트
- 선호 카테고리 1위 표시
- 기록 전체 삭제

### 카카오 지도 & 주변 장소 검색
- 현재 위치 기반 카카오 지도 표시
- 위치 획득 우선순위: Windows 위치 서비스 → 브라우저 Geolocation → IP 기반 폴백
- 최초 실행 시 위치 사용 동의 모달 (이후 재방문 시 자동 적용)
- 한글 키워드 또는 카테고리로 주변 장소 검색
- 검색 결과 리스트 + 지도 마커 연동, 마커 클릭 시 상세 정보 표시
- `Esc` 키로 지도 패널 닫기

## 설치 및 실행

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 설정 (.env 파일 생성)
cp .env.example .env
# .env 파일에 카카오 API 키 입력

# 3. 앱 실행
npm start
```

## 환경 변수 설정

프로젝트 루트에 `.env` 파일을 생성하고 아래 값을 입력합니다.

```env
KAKAO_REST_API_KEY=발급받은_REST_API_키
KAKAO_MAP_JS_KEY=발급받은_JavaScript_키

# 선택 사항 (기본값: localhost:3000)
HOST=localhost
PORT=3000
```

카카오 API 키는 [카카오 개발자 콘솔](https://developers.kakao.com)에서 앱을 생성한 후 발급받을 수 있습니다.
지도 기능을 사용하지 않는 경우 `.env` 파일 없이도 앱이 정상 실행됩니다.

## 프로젝트 구조

```
RandomFood_Select/
├── src/
│   ├── main/
│   │   └── main.js         # Electron 메인 프로세스, 로컬 HTTP 서버, IPC 핸들러, DB, 카카오 REST API
│   ├── preload/
│   │   └── preload.js      # Context Bridge (보안 IPC 브리지)
│   └── renderer/
│       ├── index.html      # UI 마크업
│       ├── renderer.js     # 렌더러 로직 (뽑기, 돌림판, 마블, 지도)
│       └── style.css       # 다크 테마 스타일
├── .env                    # 카카오 API 키 (git 제외)
├── .env.example            # 환경 변수 템플릿
├── package.json
└── README.md
```

## 데이터 저장 위치

데이터는 OS 사용자 데이터 폴더에 JSON 형태로 자동 저장됩니다.

- **Windows**: `%APPDATA%\random-food-select\lunch.db.json`
- **macOS**: `~/Library/Application Support/random-food-select/lunch.db.json`
- **Linux**: `~/.config/random-food-select/lunch.db.json`

## 보안

- 렌더러는 Node.js에 직접 접근 불가 (`contextIsolation: true`, `nodeIntegration: false`)
- Kakao REST API Key는 메인 프로세스에서만 사용, 렌더러에 미노출
- 로컬 HTTP 서버에 Path Traversal 방어 (`RENDERER_DIR` 외부 경로 403 반환)
- 사용자 입력은 `escapeHtml()` 처리 후 DOM에 삽입 (XSS 방지)
- 외부 URL은 `https://` 프로토콜 검증 후 링크 표시
