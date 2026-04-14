const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let db;
let SQL;
let mainWin;  // ← 모듈 레벨로 선언
const dbPath = path.join(app.getPath('userData'), 'lunch.db.json');

// sql.js는 메모리 DB → 앱 종료 시 JSON으로 직렬화해서 저장
// 시작 시 JSON → 메모리 DB 복원
async function initDB() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    // 저장된 데이터로 복원
    db = new SQL.Database();
    createTables();
    // 메뉴 복원
    const insertMenu = db.prepare('INSERT OR IGNORE INTO menus (id, name, category, excluded, created_at) VALUES (?,?,?,?,?)');
    (saved.menus || []).forEach(m => insertMenu.run([m.id, m.name, m.category, m.excluded, m.created_at]));
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

function createWindow() {
  mainWin = new BrowserWindow({
    width: 900, height: 700, minWidth: 700, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    backgroundColor: '#0f0f0f',
  });
  mainWin.loadFile('index.html');
}

app.whenReady().then(async () => {
  await initDB();
  createWindow();
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
