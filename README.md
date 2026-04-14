# 🍱 점심 뭐 먹지?

점심 메뉴를 랜덤으로 뽑아주는 Electron 데스크탑 앱입니다.

## 기술 스택

- **Electron** (클라이언트)
- **Node.js** (내부 로직)
- **sql.js** (SQLite, 영구 저장)

## 기능

- 🎲 **랜덤 뽑기** — 룰렛 애니메이션 후 메뉴 선택
- 🎡 **돌림판** — Canvas 돌림판, 자동 회전 후 서서히 멈춤
- 🍽 **메뉴 관리** — 추가 / 수정 / 삭제
- ⊘ **메뉴 제외** — 특정 메뉴를 랜덤 대상에서 제외
- 🕐 **최근 기록** — 최근 30개 뽑기 기록 저장
- 📦 **카테고리** — 한식 / 중식 / 일식 / 양식 / 분식 / 기타

## 설치 및 실행

```bash
# 1. 의존성 설치
npm install

# 2. 앱 실행
npm start
```

## 프로젝트 구조

```
lunch-picker/
├── main.js        # Electron 메인 프로세스 + sql.js IPC 핸들러
├── preload.js     # Context Bridge (보안)
├── index.html     # UI + 렌더러 로직 (돌림판 포함)
├── package.json
├── .gitignore
└── README.md
```

## 데이터 저장 위치

데이터는 OS 사용자 데이터 폴더에 JSON 형태로 자동 저장됩니다.

- **Windows**: `%APPDATA%\lunch-picker\lunch.db.json`
- **macOS**: `~/Library/Application Support/lunch-picker/lunch.db.json`
- **Linux**: `~/.config/lunch-picker/lunch.db.json`
