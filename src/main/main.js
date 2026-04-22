const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

const RENDERER_DIR = path.join(__dirname, '../renderer');
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = 'localhost';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const KAKAO_CATEGORY_ALIASES = {
  FD6: ['음식점', '식당', '맛집', '밥집', '레스토랑'],
  CE7: ['카페', '커피', '커피숍', '디저트'],
  CS2: ['편의점'],
  AD5: ['숙소', '호텔', '모텔', '펜션', '게스트하우스'],
  MT1: ['마트', '슈퍼', '슈퍼마켓'],
  PM9: ['약국'],
  HP8: ['병원'],
  OL7: ['주유소'],
  PK6: ['주차장'],
  SW8: ['지하철역', '지하철'],
  BK9: ['은행'],
};

let localServer;
let db;
let SQL;
let mainWin;
let serverUrl;
let locationConsentGranted = false;
let sidePanelExpanded = false;

const COLLAPSED_SIDE_WIDTH = 76;
const EXPANDED_SIDE_WIDTH = 300;
const SIDE_PANEL_DELTA = EXPANDED_SIDE_WIDTH - COLLAPSED_SIDE_WIDTH;

const dbPath = path.join(app.getPath('userData'), 'lunch.db.json');

// .env 파일의 값을 읽어 프로세스 환경 변수에 반영한다.
function loadEnvFile() {
  const envPath = path.join(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;

  const envText = fs.readFileSync(envPath, 'utf8');
  envText.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) return;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadEnvFile();

const kakaoRestApiKey = process.env.KAKAO_REST_API_KEY || '';
const kakaoMapJsKey = process.env.KAKAO_MAP_JS_KEY || process.env.KAKAO_JAVASCRIPT_KEY || '';
const serverHost = (process.env.HOST || DEFAULT_HOST).trim() || DEFAULT_HOST;
const parsedPort = Number.parseInt(process.env.PORT || '', 10);
const serverPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
  ? parsedPort
  : DEFAULT_PORT;

// 렌더러 정적 파일을 제공하는 로컬 서버를 시작한다.
function startLocalServer() {
  return new Promise((resolve, reject) => {
    const createServer = () => http.createServer((req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = path.join(RENDERER_DIR, urlPath);

      const resolvedBase = path.resolve(RENDERER_DIR);
      const resolvedFile = path.resolve(filePath);
      if (!resolvedFile.startsWith(resolvedBase + path.sep) && resolvedFile !== resolvedBase) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    localServer = createServer();
    localServer.once('error', reject);
    localServer.listen(serverPort, serverHost, () => {
      resolve(`http://${serverHost}:${serverPort}`);
    });
  });
}

// 저장된 데이터로 메모리 DB를 복원하거나 초기 데이터를 생성한다.
async function initDB() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({
    // sql.js wasm 파일 경로를 패키지 구조에 맞춰 직접 지정한다.
    locateFile: file => path.join(__dirname, '../../node_modules/sql.js/dist/', file),
  });

  if (fs.existsSync(dbPath)) {
    // 저장 파일이 있으면 메모리 DB를 만들고 JSON 데이터를 다시 주입한다.
    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

    db = new SQL.Database();
    createTables();

    const insertMenu = db.prepare(
      'INSERT OR IGNORE INTO menus (id, name, category, excluded, favorite, created_at) VALUES (?,?,?,?,?,?)'
    );
    (saved.menus || []).forEach(menu => {
      insertMenu.run([menu.id, menu.name, menu.category, menu.excluded, menu.favorite || 0, menu.created_at]);
    });
    insertMenu.free();

    const insertHistory = db.prepare(
      'INSERT OR IGNORE INTO history (id, menu_name, picked_at) VALUES (?,?,?)'
    );
    (saved.history || []).forEach(history => {
      insertHistory.run([history.id, history.menu_name, history.picked_at]);
    });
    insertHistory.free();
  } else {
    // 저장 파일이 없으면 빈 DB를 만들고 샘플 데이터를 채운다.
    db = new SQL.Database();
    createTables();
    insertSamples();
  }
}

// 메뉴와 히스토리 테이블을 생성한다.
function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT '기타',
      excluded INTEGER DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_name TEXT NOT NULL,
      picked_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

// 최초 실행 시 기본 메뉴 샘플을 추가한다.
function insertSamples() {
  const samples = [
    ['김치찌개', '한식'],
    ['된장찌개', '한식'],
    ['비빔밥', '한식'],
    ['삼겹살', '한식'],
    ['냉면', '한식'],
    ['짜장면', '중식'],
    ['짬뽕', '중식'],
    ['탕수육', '중식'],
    ['파스타', '양식'],
    ['피자', '양식'],
    ['초밥', '일식'],
    ['라멘', '일식'],
    ['돈까스', '일식'],
  ];

  const stmt = db.prepare('INSERT OR IGNORE INTO menus (name, category) VALUES (?,?)');
  samples.forEach(([name, category]) => stmt.run([name, category]));
  stmt.free();
}

// 현재 DB 상태를 JSON 파일로 저장한다.
function saveDB() {
  const menus = query('SELECT * FROM menus');
  const history = query('SELECT * FROM history');
  fs.writeFileSync(dbPath, JSON.stringify({ menus, history }), 'utf8');
}

// 조회 쿼리를 실행하고 결과 행을 반환한다.
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// 변경 쿼리를 실행하고 저장 파일에 반영한다.
function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

// 카카오 장소 응답을 앱에서 쓰는 형태로 변환한다.
function mapPlaces(documents = []) {
  return documents.map(place => ({
    id: place.id,
    name: place.place_name,
    category: place.category_name,
    address: place.road_address_name || place.address_name,
    phone: place.phone,
    distance: place.distance ? Number(place.distance) : null,
    x: Number(place.x),
    y: Number(place.y),
    url: place.place_url,
  }));
}

// 장소 ID 기준으로 중복 결과를 제거한다.
function dedupePlaces(places = []) {
  const seen = new Set();
  return places.filter(place => {
    if (!place?.id || seen.has(place.id)) return false;
    seen.add(place.id);
    return true;
  });
}

// 한글 검색어를 카카오 카테고리 코드로 변환한다.
function resolveCategoryGroupCode(query) {
  const normalized = String(query || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return null;

  for (const [code, aliases] of Object.entries(KAKAO_CATEGORY_ALIASES)) {
    if (aliases.some(alias => alias.toLowerCase().replace(/\s+/g, '') === normalized)) {
      return code;
    }
  }

  return null;
}

// 카카오 로컬 API를 공통 방식으로 호출한다.
async function requestKakaoLocal(pathname, params) {
  const response = await fetch(`https://dapi.kakao.com/v2/local/${pathname}.json?${params.toString()}`, {
    headers: {
      Authorization: `KakaoAK ${kakaoRestApiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`카카오 장소 검색 실패 (${response.status})`);
  }

  return response.json();
}

// 카테고리 기반 장소 검색 결과를 여러 페이지에서 수집한다.
async function searchKakaoByCategory({ categoryCode, x, y, radius, size }) {
  const pageSize = Math.min(Math.max(Number(size) || 15, 1), 15);
  const maxRadius = Math.min(Math.max(Number(radius) || 3000, 1), 20000);
  // 기본 검색량을 늘리되 과한 요청은 피하기 위해 페이지 수를 제한한다.
  const maxPages = 3;
  const allPlaces = [];
  let page = 1;
  let isEnd = false;

  while (!isEnd && page <= maxPages) {
    const params = new URLSearchParams({
      category_group_code: categoryCode,
      x: String(x),
      y: String(y),
      radius: String(maxRadius),
      size: String(pageSize),
      sort: 'distance',
      page: String(page),
    });

    const data = await requestKakaoLocal('search/category', params);
    allPlaces.push(...mapPlaces(data.documents || []));
    isEnd = Boolean(data.meta?.is_end);
    page += 1;
  }

  return dedupePlaces(allPlaces);
}

// 키워드 기반 장소 검색을 수행한다.
async function searchKakaoByKeyword({ query, x, y, radius, size }) {
  const params = new URLSearchParams({
    query,
    sort: 'distance',
    size: String(Math.min(Math.max(Number(size) || 5, 1), 15)),
  });

  if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    params.set('x', String(x));
    params.set('y', String(y));
    params.set('radius', String(Math.min(Math.max(Number(radius) || 2000, 1), 20000)));
  }

  const data = await requestKakaoLocal('search/keyword', params);
  return mapPlaces(data.documents || []);
}

// Windows 위치 서비스를 이용해 현재 PC 위치를 조회한다.
function getWindowsNativePosition() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Windows 네이티브 위치 조회를 지원하지 않는 플랫폼입니다.'));
      return;
    }

    const psScript = [
      'Add-Type -AssemblyName System.Device',
      '$watcher = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::Default)',
      '$watcher.Start()',
      // 위치 서비스가 바로 응답하지 않을 수 있어 짧게 여러 번 확인한다.
      'for ($i = 0; $i -lt 8; $i++) {',
      '  Start-Sleep -Milliseconds 500',
      '  if ($watcher.Position.Location.IsUnknown -eq $false) { break }',
      '}',
      '$coord = $watcher.Position.Location',
      'if ($coord.IsUnknown) {',
      '  throw "Windows 위치 서비스에서 좌표를 받지 못했습니다."',
      '}',
      '$accuracy = 0',
      'if ($coord.HorizontalAccuracy -gt 0) {',
      '  $accuracy = $coord.HorizontalAccuracy',
      '}',
      '$payload = @{',
      '  latitude = $coord.Latitude',
      '  longitude = $coord.Longitude',
      '  accuracy = $accuracy',
      '}',
      '$payload | ConvertTo-Json -Compress',
    ].join('\n');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true, timeout: 7000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message || 'Windows 위치 조회 실행에 실패했습니다.'));
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) {
            reject(new Error('Windows 위치 조회 결과가 올바르지 않습니다.'));
            return;
          }

          resolve({
            coords: {
              latitude: Number(parsed.latitude),
              longitude: Number(parsed.longitude),
              accuracy: Number(parsed.accuracy) || 0,
            },
            source: 'native',
          });
        } catch (parseError) {
          reject(new Error(stdout.trim() || 'Windows 위치 조회 결과를 해석하지 못했습니다.'));
        }
      }
    );
  });
}

// 메인 브라우저 창을 생성하고 초기 화면을 연다.
function getWindowsNativePosition() {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Windows 네이티브 위치 조회를 지원하지 않는 플랫폼입니다.'));
      return;
    }

    const psScript = [
      '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      'try {',
      '  Add-Type -AssemblyName System.Device',
      '  $watcher = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::Default)',
      '  $watcher.Start()',
      '  for ($i = 0; $i -lt 8; $i++) {',
      '    Start-Sleep -Milliseconds 500',
      '    if ($watcher.Position.Location.IsUnknown -eq $false) { break }',
      '  }',
      '  $coord = $watcher.Position.Location',
      '  if ($coord.IsUnknown) {',
      '    throw "Windows 위치 서비스에서 좌표를 받지 못했습니다."',
      '  }',
      '  $accuracy = 0',
      '  if ($coord.HorizontalAccuracy -gt 0) {',
      '    $accuracy = $coord.HorizontalAccuracy',
      '  }',
      '  @{',
      '    ok = $true',
      '    latitude = $coord.Latitude',
      '    longitude = $coord.Longitude',
      '    accuracy = $accuracy',
      '  } | ConvertTo-Json -Compress',
      '} catch {',
      '  @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress',
      '  exit 1',
      '}',
    ].join('\n');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true, timeout: 7000 },
      (error, stdout, stderr) => {
        try {
          const parsed = JSON.parse((stdout || '').trim());
          if (parsed?.ok === false) {
            reject(new Error(parsed.message || 'Windows 위치 조회에 실패했습니다.'));
            return;
          }
          if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) {
            reject(new Error('Windows 위치 조회 결과가 올바르지 않습니다.'));
            return;
          }

          resolve({
            coords: {
              latitude: Number(parsed.latitude),
              longitude: Number(parsed.longitude),
              accuracy: Number(parsed.accuracy) || 0,
            },
            source: 'native',
          });
        } catch (parseError) {
          if (error) {
            reject(new Error(stderr?.trim() || stdout.trim() || error.message || 'Windows 위치 조회 실행에 실패했습니다.'));
            return;
          }
          reject(new Error(stdout.trim() || 'Windows 위치 조회 결과를 해석하지 못했습니다.'));
        }
      }
    );
  });
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 600,
    webPreferences: {
      // 렌더러에는 preload로만 안전한 API를 노출한다.
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    backgroundColor: '#0f0f0f',
  });

  mainWin.loadURL(serverUrl);
  if (!app.isPackaged) mainWin.webContents.openDevTools({ mode: 'right' });
}

function getWindowBaseMinSize(tab) {
  return tab === 'marble' ? { width: 780, height: 700 } : { width: 700, height: 600 };
}

function applyWindowLayout(tab = 'pick', expanded = sidePanelExpanded) {
  if (!mainWin || mainWin.isMaximized()) return;

  const base = getWindowBaseMinSize(tab);
  const minWidth = base.width + (expanded ? SIDE_PANEL_DELTA : 0);
  mainWin.setMinimumSize(minWidth, base.height);

  const [currentWidth, currentHeight] = mainWin.getSize();
  const targetHeight = tab === 'marble' ? Math.max(currentHeight, 900) : 700;
  const nextWidth = Math.max(currentWidth, minWidth);
  mainWin.setSize(nextWidth, targetHeight, true);
}

// Electron 세션에 위치 권한 처리 핸들러를 등록한다.
function setupPermissionHandlers() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  // 위치 권한만 허용하고 나머지는 기본적으로 허용하지 않는다.
  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'geolocation' ? locationConsentGranted : false);
  });

  defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'geolocation' ? locationConsentGranted : false;
  });
}

// 앱 준비가 끝나면 서버, DB, 메인 창을 순서대로 초기화한다.
app.whenReady().then(async () => {
  setupPermissionHandlers();
  serverUrl = await startLocalServer();
  await initDB();
  createWindow();
});

// 종료 직전에 로컬 서버를 정리한다.
app.on('before-quit', () => {
  localServer?.close();
});

// macOS를 제외한 플랫폼에서는 창이 모두 닫히면 앱도 종료한다.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS에서 Dock 재실행 시 창이 없으면 새로 만든다.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 메뉴 목록을 카테고리/이름 순으로 반환한다.
ipcMain.handle('get-menus', () => query('SELECT * FROM menus ORDER BY category, name'));

// 새 메뉴를 추가한다.
ipcMain.handle('add-menu', (_, { name, category }) => {
  try {
    run('INSERT INTO menus (name, category) VALUES (?,?)', [name.trim(), category || '기타']);
    return { success: true };
  } catch {
    return { success: false, error: '이미 존재하는 메뉴입니다.' };
  }
});

// 기존 메뉴 이름과 카테고리를 수정한다.
ipcMain.handle('update-menu', (_, { id, name, category }) => {
  try {
    run('UPDATE menus SET name=?, category=? WHERE id=?', [name.trim(), category, id]);
    return { success: true };
  } catch {
    return { success: false, error: '수정 실패: 중복된 메뉴 이름입니다.' };
  }
});

// 메뉴를 삭제한다.
ipcMain.handle('delete-menu', (_, id) => {
  run('DELETE FROM menus WHERE id=?', [id]);
  return { success: true };
});

// 메뉴 제외 상태를 토글한다.
ipcMain.handle('toggle-exclude', (_, id) => {
  run('UPDATE menus SET excluded = CASE WHEN excluded=0 THEN 1 ELSE 0 END WHERE id=?', [id]);
  return { success: true };
});

// 제외되지 않은 메뉴 중 하나를 랜덤으로 뽑고 히스토리에 기록한다.
ipcMain.handle('pick-random', () => {
  const available = query('SELECT * FROM menus WHERE excluded=0');
  if (!available.length) return { success: false, error: '선택 가능한 메뉴가 없습니다.' };

  const picked = available[Math.floor(Math.random() * available.length)];
  run('INSERT INTO history (menu_name, picked_at) VALUES (?, datetime(\'now\',\'localtime\'))', [picked.name]);
  return { success: true, menu: picked };
});

// 최근 히스토리 목록을 반환한다.
ipcMain.handle('get-history', () => query('SELECT * FROM history ORDER BY picked_at DESC LIMIT 30'));

// 히스토리를 모두 비운다.
ipcMain.handle('clear-history', () => {
  run('DELETE FROM history');
  return { success: true };
});

// 즐겨찾기 상태를 토글한다.
ipcMain.handle('toggle-favorite', (_, id) => {
  run('UPDATE menus SET favorite = CASE WHEN favorite=0 THEN 1 ELSE 0 END WHERE id=?', [id]);
  return { success: true };
});

// 렌더러에서 확정된 선택 결과를 히스토리에 기록한다.
ipcMain.handle('record-pick', (_, menuName) => {
  run('INSERT INTO history (menu_name, picked_at) VALUES (?, datetime(\'now\',\'localtime\'))', [menuName]);
  return { success: true };
});

// 카카오 지도 SDK 초기화에 필요한 설정값을 전달한다.
ipcMain.handle('get-kakao-map-config', () => ({
  jsKey: kakaoMapJsKey,
}));

// 렌더러에서 요청한 현재 PC 위치를 Windows 위치 서비스로 조회한다.
ipcMain.handle('get-native-position', async () => {
  return getWindowsNativePosition();
});

ipcMain.handle('set-location-consent', async (_, allowed) => {
  locationConsentGranted = allowed === true;
  return { success: true, allowed: locationConsentGranted };
});

// 한글 카테고리 또는 키워드로 카카오 장소 검색을 수행한다.
ipcMain.handle('search-kakao-places', async (_, { query, x, y, radius = 2000, size = 5 } = {}) => {
  if (!kakaoRestApiKey) {
    return { success: false, error: 'KAKAO_REST_API_KEY가 설정되지 않았습니다.' };
  }

  const keyword = String(query || '').trim();
  if (!keyword) {
    return { success: false, error: '검색어가 비어 있습니다.' };
  }

  try {
    const categoryCode = resolveCategoryGroupCode(keyword);
    const hasCenter = Number.isFinite(Number(x)) && Number.isFinite(Number(y));
    const places = categoryCode && hasCenter
      ? await searchKakaoByCategory({ categoryCode, x: Number(x), y: Number(y), radius, size: 15 })
      : await searchKakaoByKeyword({ query: keyword, x, y, radius, size });

    return {
      success: true,
      searchMode: categoryCode && hasCenter ? 'category' : 'keyword',
      categoryCode: categoryCode || null,
      places,
    };
  } catch (error) {
    return { success: false, error: error.message || '카카오 장소 검색 중 오류가 발생했습니다.' };
  }
});

// 앱 종료를 요청한다.
ipcMain.handle('close-app', () => {
  app.quit();
});

// 메인 창을 최소화한다.
ipcMain.on('minimize-app', () => {
  mainWin?.minimize();
});

// 메인 창 최대화 상태를 토글한다.
ipcMain.on('maximize-app', () => {
  if (!mainWin) return;
  mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize();
});

// 현재 탭에 맞춰 창 최소 크기와 높이를 조정한다.
ipcMain.on('resize-for-tab', (_, tab) => {
  applyWindowLayout(tab, sidePanelExpanded);
});

ipcMain.on('set-side-panel-open', (_, { open, tab } = {}) => {
  if (!mainWin || mainWin.isMaximized()) return;

  const nextExpanded = open === true;
  const nextTab = typeof tab === 'string' ? tab : 'pick';
  const wasExpanded = sidePanelExpanded;
  sidePanelExpanded = nextExpanded;

  const base = getWindowBaseMinSize(nextTab);
  const minWidth = base.width + (nextExpanded ? SIDE_PANEL_DELTA : 0);
  const [currentWidth, currentHeight] = mainWin.getSize();
  let nextWidth = currentWidth;

  if (nextExpanded && !wasExpanded) nextWidth += SIDE_PANEL_DELTA;
  if (!nextExpanded && wasExpanded) nextWidth -= SIDE_PANEL_DELTA;

  nextWidth = Math.max(nextWidth, minWidth);
  const targetHeight = nextTab === 'marble' ? Math.max(currentHeight, 900) : 700;

  mainWin.setMinimumSize(minWidth, base.height);
  mainWin.setSize(nextWidth, targetHeight, true);
});
