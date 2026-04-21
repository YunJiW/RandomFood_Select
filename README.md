# 점심 뭐 먹지?

점심 메뉴를 랜덤으로 뽑아주는 Electron 데스크탑 앱입니다.

## 기술 스택

- **Electron 34** — 데스크탑 앱 프레임워크
- **Node.js** — 메인 프로세스 로직
- **sql.js** — WebAssembly 기반 SQLite (영구 저장)
- **Kakao Maps SDK** — 지도 표시 (JavaScript Key)
- **Kakao Local API** — 주변 장소 검색 (REST API Key)

## 기능

### 랜덤 뽑기
- 슬롯 애니메이션(80ms 간격) 후 메뉴 확정, 스프링 바운스 + 글로우 연출
- 카테고리 필터 (한식 / 중식 / 일식 / 양식 / 분식 / 기타)
- 즐겨찾기 전용 필터
- 쿨다운 설정 (최근 N일 이내 뽑힌 메뉴 자동 제외)

### 돌림판
- Canvas 직접 렌더링, 가중치 비례 부채꼴 분할
- 메뉴별 가중치 1~99 설정 → 실시간 확률(%) 표시
- easeOut 감속 곡선으로 자연스러운 회전 정지

### 마블 룰렛
- 전체 메뉴 수만큼 구슬 생성, 물리 시뮬레이션 낙하
- 4개 구역: ENTRY(플링코) → SLALOM(교번 범퍼) → MID(지그재그) → EXIT(플링코)
- 최하단 NARROW 깔때기 → 회전 장애물 → FINISH 라인
- 마지막 통과 구슬이 당첨
- 미니맵 + 뷰포트 자동 스크롤, 스킵 버튼 지원

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
- 한글 키워드 또는 카테고리로 주변 장소 검색
- 검색 결과 리스트 + 지도 마커 연동, 마커 클릭 시 상세 정보 표시

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

프로젝트 루트에 `.env` 파일을 생성하고 카카오 API 키를 입력합니다.

```env
KAKAO_REST_API_KEY=발급받은_REST_API_키
KAKAO_MAP_JS_KEY=발급받은_JavaScript_키
```

카카오 API 키는 [카카오 개발자 콘솔](https://developers.kakao.com)에서 앱을 생성한 후 발급받을 수 있습니다.
지도 기능을 사용하지 않는 경우 `.env` 파일 없이도 앱이 정상 실행됩니다.

## 프로젝트 구조

```
RandomFood_Select/
├── src/
│   ├── main/
│   │   └── main.js         # Electron 메인 프로세스, IPC 핸들러, DB, 카카오 REST API 호출
│   ├── preload/
│   │   └── preload.js      # Context Bridge (보안 IPC 브리지)
│   └── renderer/
│       ├── index.html      # UI 마크업
│       ├── renderer.js     # 렌더러 로직 (뽑기, 돌림판, 마블, 지도)
│       └── style.css       # 다크 테마 스타일
├── .env                    # 카카오 API 키 (git 제외)
├── package.json
└── README.md
```

## 데이터 저장 위치

데이터는 OS 사용자 데이터 폴더에 JSON 형태로 자동 저장됩니다.

- **Windows**: `%APPDATA%\random-food-select\lunch.db.json`
- **macOS**: `~/Library/Application Support/random-food-select/lunch.db.json`
- **Linux**: `~/.config/random-food-select/lunch.db.json`
