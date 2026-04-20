const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const RENDERER_DIR = path.join(__dirname, '../renderer');
const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

let localServer;

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

function startLocalServer() {
  return new Promise((resolve, reject) => {
    localServer = http.createServer((req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = path.join(RENDERER_DIR, urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    localServer.listen(PORT, '127.0.0.1', () => resolve(`http://localhost:${PORT}`));
    localServer.on('error', reject);
  });
}

let db;
let SQL;
let mainWin;  // ← 모듈 레벨로 선언
const dbPath = path.join(app.getPath('userData'), 'lunch.db.json');
loadEnvFile();
const kakaoRestApiKey = process.env.KAKAO_REST_API_KEY || '';
const kakaoMapJsKey = process.env.KAKAO_MAP_JS_KEY || process.env.KAKAO_JAVASCRIPT_KEY || '';

// sql.js는 메모리 DB → 앱 종료 시 JSON으로 직렬화해서 저장
// 시작 시 JSON → 메모리 DB 복원
async function initDB() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '../../node_modules/sql.js/dist/', file),
  });

  if (fs.existsSync(dbPath)) {
    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    // 저장된 데이터로 복원
    db = new SQL.Database();
    createTables();
    // 메뉴 복원
    const insertMenu = db.prepare('INSERT OR IGNORE INTO menus (id, name, category, excluded, favorite, created_at) VALUES (?,?,?,?,?,?)');
    (saved.menus || []).forEach(m => insertMenu.run([m.id, m.name, m.category, m.excluded, m.favorite || 0, m.created_at]));
    insertMenu.free();
    // 히스토리 복원
    const insertHist = db.prepare('INSERT OR IGNORE INTO history (id, menu_name, picked_at) VALUES (?,?,?)');
    (saved.history || []).forEach(h => insertHist.run([h.id, h.menu_name, h.picked_at]));
    insertHist.free();
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
    ['김치찌개','한식'],['된장찌개','한식'],['비빔밥','한식'],
    ['삼겹살','한식'],['냉면','한식'],['짜장면','중식'],
    ['짬뽕','중식'],['탕수육','중식'],['스파게티','양식'],
    ['피자','양식'],['초밥','일식'],['라멘','일식'],['돈까스','일식'],
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO menus (name, category) VALUES (?,?)');
  samples.forEach(([n, c]) => stmt.run([n, c]));
  stmt.free();
}

function saveDB() {
  const menus   = query('SELECT * FROM menus');
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

function createWindow(url) {
  mainWin = new BrowserWindow({
    width: 900, height: 700, minWidth: 700, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    backgroundColor: '#0f0f0f',
  });
  mainWin.loadURL(url);
  mainWin.webContents.openDevTools({ mode: 'right' });
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'geolocation');
  });

  const url = await startLocalServer();
  await initDB();
  createWindow(url);
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

// ── IPC 핸들러 ──────────────────────────────────────────

ipcMain.handle('get-menus', () =>
  query('SELECT * FROM menus ORDER BY category, name')
);

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
    return { success: false, error: '수정 실패: 중복된 이름이 있습니다.' };
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
  if (available.length === 0) return { success: false, error: '선택 가능한 메뉴가 없습니다.' };
  const picked = available[Math.floor(Math.random() * available.length)];
  run(`INSERT INTO history (menu_name, picked_at) VALUES (?, datetime('now','localtime'))`, [picked.name]);
  return { success: true, menu: picked };
});

ipcMain.handle('get-history', () =>
  query('SELECT * FROM history ORDER BY picked_at DESC LIMIT 30')
);

ipcMain.handle('clear-history', () => {
  run('DELETE FROM history');
  return { success: true };
});

ipcMain.handle('toggle-favorite', (_, id) => {
  run('UPDATE menus SET favorite = CASE WHEN favorite=0 THEN 1 ELSE 0 END WHERE id=?', [id]);
  return { success: true };
});

ipcMain.handle('record-pick', (_, menuName) => {
  run(`INSERT INTO history (menu_name, picked_at) VALUES (?, datetime('now','localtime'))`, [menuName]);
  return { success: true };
});

ipcMain.handle('get-kakao-map-config', () => ({
  jsKey: kakaoMapJsKey,
}));

ipcMain.handle('search-kakao-places', async (_, { query, x, y, radius = 2000, size = 5 } = {}) => {
  if (!kakaoRestApiKey) {
    return { success: false, error: 'KAKAO_REST_API_KEY가 설정되지 않았습니다.' };
  }

  const keyword = String(query || '').trim();
  if (!keyword) {
    return { success: false, error: '검색어가 비어 있습니다.' };
  }

  const params = new URLSearchParams({
    query: keyword,
    sort: 'distance',
    size: String(Math.min(Math.max(Number(size) || 5, 1), 15)),
  });

  if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    params.set('x', String(x));
    params.set('y', String(y));
    params.set('radius', String(Math.min(Math.max(Number(radius) || 2000, 1), 20000)));
  }

  try {
    const response = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${params.toString()}`, {
      headers: {
        Authorization: `KakaoAK ${kakaoRestApiKey}`,
      },
    });

    if (!response.ok) {
      return { success: false, error: `카카오 장소 검색 실패 (${response.status})` };
    }

    const data = await response.json();
    return {
      success: true,
      places: (data.documents || []).map(place => ({
        id: place.id,
        name: place.place_name,
        category: place.category_name,
        address: place.road_address_name || place.address_name,
        phone: place.phone,
        distance: place.distance ? Number(place.distance) : null,
        x: Number(place.x),
        y: Number(place.y),
        url: place.place_url,
      })),
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
  const [w] = mainWin.getSize();
  if (tab === 'marble') {
    mainWin.setMinimumSize(700, 700);
    mainWin.setSize(w, Math.max(mainWin.getSize()[1], 900), true);
  } else {
    mainWin.setMinimumSize(700, 600);
    mainWin.setSize(w, 700, true);
  }
});
