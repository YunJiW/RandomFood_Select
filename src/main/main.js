const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

const RENDERER_DIR = path.join(__dirname, '../renderer');
const PORT = 3000;
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

const dbPath = path.join(app.getPath('userData'), 'lunch.db.json');

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

function startLocalServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer((req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = path.join(RENDERER_DIR, urlPath);

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

    localServer.listen(PORT, '127.0.0.1', () => resolve(`http://localhost:${PORT}`));
    localServer.on('error', reject);
  });
}

async function initDB() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '../../node_modules/sql.js/dist/', file),
  });

  if (fs.existsSync(dbPath)) {
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
    db = new SQL.Database();
    createTables();
    insertSamples();
  }
}

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

function saveDB() {
  const menus = query('SELECT * FROM menus');
  const history = query('SELECT * FROM history');
  fs.writeFileSync(dbPath, JSON.stringify({ menus, history }), 'utf8');
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

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

function dedupePlaces(places = []) {
  const seen = new Set();
  return places.filter(place => {
    if (!place?.id || seen.has(place.id)) return false;
    seen.add(place.id);
    return true;
  });
}

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

async function searchKakaoByCategory({ categoryCode, x, y, radius, size }) {
  const pageSize = Math.min(Math.max(Number(size) || 15, 1), 15);
  const maxRadius = Math.min(Math.max(Number(radius) || 3000, 1), 20000);
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

function createWindow() {
  mainWin = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 600,
    webPreferences: {
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

function setupPermissionHandlers() {
  const defaultSession = session.defaultSession;
  if (!defaultSession) return;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'geolocation');
  });

  defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'geolocation';
  });
}

app.whenReady().then(async () => {
  setupPermissionHandlers();
  serverUrl = await startLocalServer();
  await initDB();
  createWindow();
});

app.on('before-quit', () => {
  localServer?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-menus', () => query('SELECT * FROM menus ORDER BY category, name'));

ipcMain.handle('add-menu', (_, { name, category }) => {
  try {
    run('INSERT INTO menus (name, category) VALUES (?,?)', [name.trim(), category || '기타']);
    return { success: true };
  } catch {
    return { success: false, error: '이미 존재하는 메뉴입니다.' };
  }
});

ipcMain.handle('update-menu', (_, { id, name, category }) => {
  try {
    run('UPDATE menus SET name=?, category=? WHERE id=?', [name.trim(), category, id]);
    return { success: true };
  } catch {
    return { success: false, error: '수정 실패: 중복된 메뉴 이름입니다.' };
  }
});

ipcMain.handle('delete-menu', (_, id) => {
  run('DELETE FROM menus WHERE id=?', [id]);
  return { success: true };
});

ipcMain.handle('toggle-exclude', (_, id) => {
  run('UPDATE menus SET excluded = CASE WHEN excluded=0 THEN 1 ELSE 0 END WHERE id=?', [id]);
  return { success: true };
});

ipcMain.handle('pick-random', () => {
  const available = query('SELECT * FROM menus WHERE excluded=0');
  if (!available.length) return { success: false, error: '선택 가능한 메뉴가 없습니다.' };

  const picked = available[Math.floor(Math.random() * available.length)];
  run('INSERT INTO history (menu_name, picked_at) VALUES (?, datetime(\'now\',\'localtime\'))', [picked.name]);
  return { success: true, menu: picked };
});

ipcMain.handle('get-history', () => query('SELECT * FROM history ORDER BY picked_at DESC LIMIT 30'));

ipcMain.handle('clear-history', () => {
  run('DELETE FROM history');
  return { success: true };
});

ipcMain.handle('toggle-favorite', (_, id) => {
  run('UPDATE menus SET favorite = CASE WHEN favorite=0 THEN 1 ELSE 0 END WHERE id=?', [id]);
  return { success: true };
});

ipcMain.handle('record-pick', (_, menuName) => {
  run('INSERT INTO history (menu_name, picked_at) VALUES (?, datetime(\'now\',\'localtime\'))', [menuName]);
  return { success: true };
});

ipcMain.handle('get-kakao-map-config', () => ({
  jsKey: kakaoMapJsKey,
}));

ipcMain.handle('get-native-position', async () => {
  return getWindowsNativePosition();
});

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

ipcMain.handle('close-app', () => {
  app.quit();
});

ipcMain.on('minimize-app', () => {
  mainWin?.minimize();
});

ipcMain.on('maximize-app', () => {
  if (!mainWin) return;
  mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize();
});

ipcMain.on('resize-for-tab', (_, tab) => {
  if (!mainWin || mainWin.isMaximized()) return;

  const [width] = mainWin.getSize();
  if (tab === 'marble') {
    mainWin.setMinimumSize(700, 700);
    mainWin.setSize(width, Math.max(mainWin.getSize()[1], 900), true);
  } else {
    mainWin.setMinimumSize(700, 600);
    mainWin.setSize(width, 700, true);
  }
});
