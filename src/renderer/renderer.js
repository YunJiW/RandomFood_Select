function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 렌더러 전역 상태
let menus     = [];
let history   = [];
let weights   = {};   // { menuId: number }
let marbleCount = {}; // { menuId: number }
let editingId = null;
let favOnly   = false;
const selectedCats = new Set(['한식','중식','일식','양식','분식','기타']);
// 카카오 지도 관련 상태
let kakaoMapConfig = null;
let kakaoMapScriptPromise = null;
let kakaoMapInstance = null;
let kakaoMapMarker = null;
let kakaoPlaceMarkers = [];
let kakaoPlaceInfoWindow = null;
// 위치 사용 동의 상태는 localStorage에 저장해 재사용한다.
const MAP_LOCATION_CONSENT_KEY = 'map-location-consent';
let mapConsentResolver = null;
let activeSidePanel = null;
let activeMainTab = 'pick';
let latestPickedMenuName = '';
let latestWheelPickedMenuName = '';
let mapPanelRequestToken = 0;

// 탭 전환
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (activeSidePanel === 'weights' && tab.dataset.tab !== 'wheel') {
      activeSidePanel = null;
    }
    activeMainTab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
    window.api.resizeForTab(tab.dataset.tab);
    syncRightPanel();
    if (tab.dataset.tab === 'wheel') setTimeout(() => { renderWeightList(); drawWheel(wheelAngle); }, 40);
    if (tab.dataset.tab === 'marble') setTimeout(() => initMarble(), 40);
  });
});

document.getElementById('new-name').addEventListener('keydown', e => { if (e.key === 'Enter') addMenu(); });
document.getElementById('wheel-new-name').addEventListener('keydown', e => { if (e.key === 'Enter') addMenuFromWheel(); });
document.getElementById('map-search-keyword').addEventListener('keydown', e => { if (e.key === 'Enter') searchPlacesOnMap(); });

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName?.toUpperCase();
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON';
}

function triggerActiveTabAction() {
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  if (activeTab === 'pick') {
    pickRandom();
    return;
  }
  if (activeTab === 'wheel') {
    if (wheelSpinning) skipWheel();
    else spinWheel();
    return;
  }
  if (activeTab === 'marble') {
    startMarble();
  }
}

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === 'Escape') {
    const mapPanel = document.getElementById('map-test-panel');
    if (mapPanel?.classList.contains('show')) {
      e.preventDefault();
      hideMapPanel();
    }
    return;
  }
  if (e.key !== 'Enter' && e.code !== 'Space') return;
  if (isTypingTarget(e.target)) return;

  e.preventDefault();
  triggerActiveTabAction();
});

// 카테고리 필터
document.querySelectorAll('.cat-btn').forEach(btn => {
  if (btn.dataset.cat === '전체') return;
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    if (btn.classList.contains('active')) selectedCats.add(btn.dataset.cat);
    else selectedCats.delete(btn.dataset.cat);
    // 전체 버튼 동기화
    const allActive = selectedCats.size === 6;
    document.querySelector('.cat-btn[data-cat="전체"]').classList.toggle('active', allActive);
    updatePickInfo(); renderWeightList(); drawWheel(wheelAngle);
  });
});
document.querySelector('.cat-btn[data-cat="전체"]').addEventListener('click', btn => {
  const allOn = selectedCats.size === 6;
  if (allOn) {
    selectedCats.clear();
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  } else {
    ['한식','중식','일식','양식','분식','기타'].forEach(c => selectedCats.add(c));
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.add('active'));
  }
  updatePickInfo(); renderWeightList(); drawWheel(wheelAngle);
});

function toggleFavOnly() {
  favOnly = !favOnly;
  document.getElementById('fav-toggle').classList.toggle('active', favOnly);
  updatePickInfo(); renderWeightList(); drawWheel(wheelAngle);
}

// 패널 전환
function showPanel(name) {
  if (activeMainTab === 'marble') return;
  if (name === 'weights' && activeMainTab !== 'wheel') return;
  const nextPanel = activeSidePanel === name ? null : name;
  activeSidePanel = nextPanel;
  syncRightPanel();
}

function syncRightPanel() {
  const app = document.getElementById('app');
  const rightPanel = document.getElementById('right');
  const isMarbleTab = activeMainTab === 'marble';
  const isWheelTab = activeMainTab === 'wheel';
  const shouldOpen = isMarbleTab || Boolean(activeSidePanel);

  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));

  app?.classList.toggle('right-open', shouldOpen);
  app?.classList.toggle('marble-right-open', isMarbleTab && shouldOpen);
  rightPanel?.classList.toggle('collapsed', !shouldOpen);
  rightPanel?.classList.toggle('marble-mode', isMarbleTab);
  rightPanel?.classList.toggle('wheel-mode', isWheelTab);
  window.api.setSidePanelOpen?.(shouldOpen, activeMainTab);

  if (!shouldOpen) {
    document.querySelector('.btn-clear')?.classList.add('hidden');
    return;
  }

  if (isMarbleTab) {
    document.getElementById('marble-side-panel')?.classList.add('active');
    document.querySelector('.btn-clear')?.classList.add('hidden');
    return;
  }

  if (!activeSidePanel) {
    document.querySelector('.btn-clear')?.classList.add('hidden');
    return;
  }

  document.querySelector(`.ptab[data-panel="${activeSidePanel}"]`)?.classList.add('active');
  const panelViewMap = {
    history: 'history-list',
    stats: 'stats-content',
    weights: 'wheel-side-panel',
  };
  const activePanelId = panelViewMap[activeSidePanel];
  document.getElementById(activePanelId)?.classList.add('active');
  document.querySelector('.btn-clear')?.classList.toggle('hidden', activeSidePanel !== 'history');
}

window.addEventListener('resize', () => {
  syncRightPanel();
  handleMarbleResize();
});

// 데이터 로드
async function loadAll() { await loadMenus(); await loadHistory(); }

// 메인 프로세스에서 내려준 카카오 지도 설정값을 읽는다.
async function loadKakaoMapConfig() {
  if (!window.api.getKakaoMapConfig) return;
  kakaoMapConfig = await window.api.getKakaoMapConfig();
}

// 메뉴 목록을 다시 읽고 연결된 화면을 모두 갱신한다.
async function loadMenus() {
  menus = await window.api.getMenus();
  menus.forEach(m => { if (weights[m.id] === undefined) weights[m.id] = 1; });
  const activeIds = new Set(menus.map(m => String(m.id)));
  Object.keys(marbleCount).forEach(id => {
    if (!activeIds.has(String(id))) delete marbleCount[id];
  });
  menus.forEach(m => { if (marbleCount[m.id] === undefined) marbleCount[m.id] = 1; });
  renderMenus();
  updatePickInfo();
  renderWeightList();
  drawWheel(wheelAngle);
  initMarble();
}

// 필터 적용된 메뉴 목록
function getCooldownDays() { return parseInt(document.getElementById('cooldown-select').value) || 0; }

// 최근 n일 내에 뽑힌 메뉴 이름 집합을 만든다.
function getRecentlyPickedNames() {
  const days = getCooldownDays();
  if (!days) return new Set();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  return new Set(history.filter(h => new Date(h.picked_at) >= cutoff).map(h => h.menu_name));
}

// 제외, 즐겨찾기, 카테고리, 쿨다운 조건을 한 번에 적용한다.
function getFilteredMenus() {
  let list = menus.filter(m => !m.excluded);
  if (favOnly) list = list.filter(m => m.favorite);
  if (selectedCats.size < 6) list = list.filter(m => selectedCats.has(m.category));
  const recent = getRecentlyPickedNames();
  if (recent.size) list = list.filter(m => !recent.has(m.name));
  return list;
}

// Pick 탭의 메뉴 목록을 렌더링한다.
function renderMenus() {
  const list = document.getElementById('pick-menu-list');
  if (!menus.length) { list.innerHTML = '<div class="empty-state">등록된 메뉴가 없습니다.<br>아래에서 메뉴를 추가해 주세요.</div>'; return; }
  list.innerHTML = menus.map(m => `
    <div class="menu-item ${m.excluded ? 'excluded' : ''}">
      <span class="cat-badge">${escapeHtml(m.category)}</span>
      <span class="menu-name">${escapeHtml(m.name)}</span>
      ${m.excluded ? '<span class="excluded-tag">제외됨</span>' : ''}
      <button class="icon-btn fav-btn ${m.favorite ? 'active' : ''}" onclick="toggleFavorite(${m.id})" title="즐겨찾기">${m.favorite ? '★' : '☆'}</button>
      <button class="icon-btn exclude-btn" onclick="toggleExclude(${m.id})" title="${m.excluded ? '포함' : '제외'}">${m.excluded ? '↺' : '⊘'}</button>
      <button class="icon-btn" onclick="openEdit(${m.id})">수정</button>
      <button class="icon-btn danger" onclick="deleteMenu(${m.id})">삭제</button>
    </div>`).join('');
}

// 현재 필터 조건을 요약해 상태 문구로 표시한다.
function updatePickInfo() {
  const filtered = getFilteredMenus();
  const total    = menus.filter(m => !m.excluded).length;
  const parts = [];
  if (favOnly) parts.push('즐겨찾기');
  if (selectedCats.size < 6) parts.push([...selectedCats].join('/'));
  const cooldown = getCooldownDays();
  if (cooldown) parts.push(`쿨다운 ${cooldown}일`);
  const filterStr = parts.length ? ` (${parts.join(', ')})` : '';
  document.getElementById('pick-info').textContent =
    `선택 가능 ${filtered.length}개 / 전체 ${total}개${filterStr}`;
}

// 가중치 계산 (룰렛용, 제외 여부만 반영)
function getActiveItems() {
  return menus
    .filter(m => !m.excluded)
    .map(m => ({ ...m, weight: Math.max(1, weights[m.id] || 1) }));
}
function totalWeight(items) { return items.reduce((s, m) => s + m.weight, 0); }

// 룰렛용 가중치 편집 목록을 그린다.
function renderWeightList() {
  const list   = document.getElementById('weight-list');
  const active = getActiveItems();
  const total  = totalWeight(active);

  if (!menus.length) { list.innerHTML = '<div class="empty-state">메뉴가 없습니다.</div>'; return; }

  list.innerHTML = menus.map(m => {
    const w   = weights[m.id] || 1;
    const exc = !!m.excluded;
    const pct = exc ? 0 : (total > 0 ? Math.round((w / total) * 100) : 0);
    return `
      <div class="weight-item ${exc ? 'excluded' : ''}">
        <span class="weight-pct">${pct}%</span>
        <span class="weight-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
        <div class="weight-controls">
          <button class="wc-btn" onclick="adjustWeight(${m.id},-1)" ${exc || w <= 1 ? 'disabled' : ''}>−</button>
          <input class="wc-input" type="number" min="1" max="99" value="${w}"
            onchange="setWeight(${m.id}, this.value)"
            oninput="setWeight(${m.id}, this.value)"
            ${exc ? 'disabled' : ''} />
          <button class="wc-btn" onclick="adjustWeight(${m.id},1)" ${exc || w >= 99 ? 'disabled' : ''}>＋</button>
          <button class="wc-btn wc-del" onclick="deleteMenu(${m.id})">✕</button>
        </div>
      </div>`;
  }).join('');
}

// 가중치를 1~99 범위에서 증감한다.
function adjustWeight(id, delta) {
  weights[id] = Math.min(99, Math.max(1, (weights[id] || 1) + delta));
  renderWeightList();
  drawWheel(wheelAngle);
}

// 직접 입력한 가중치를 1~99 범위로 반영한다.
function setWeight(id, val) {
  const n = parseInt(val);
  if (isNaN(n) || n < 1) return;
  weights[id] = Math.min(99, n);
  renderWeightList();
  drawWheel(wheelAngle);
}

// 모든 메뉴 가중치를 기본값으로 되돌린다.
function resetWeights() {
  menus.forEach(m => { weights[m.id] = 1; });
  renderWeightList();
  drawWheel(wheelAngle);
  showToast('가중치 초기화 완료');
}

function getMarbleCount(id) {
  return Math.min(5, Math.max(1, parseInt(marbleCount[id], 10) || 1));
}

function buildMarbleItems() {
  const items = [];
  menus.filter(m => !m.excluded).forEach(menu => {
    const count = getMarbleCount(menu.id);
    for (let i = 0; i < count; i++) {
      items.push({
        menu,
        countIndex: i + 1,
        label: count > 1 ? `${menu.name} #${i + 1}` : menu.name,
      });
    }
  });
  return items;
}

function renderMarbleCountList() {
  const list = document.getElementById('marble-count-list');
  if (!list) return;

  const activeMenus = menus.filter(m => !m.excluded);
  const totalBalls = activeMenus.reduce((sum, menu) => sum + getMarbleCount(menu.id), 0);

  if (!menus.length) {
    list.innerHTML = '<div class="empty-state">메뉴가 없습니다.</div>';
    return;
  }

  list.innerHTML = menus.map(menu => {
    const count = getMarbleCount(menu.id);
    const excluded = !!menu.excluded;
    const pct = excluded || totalBalls === 0 ? 0 : Math.round((count / totalBalls) * 100);
    return `
      <div class="weight-item ${excluded ? 'excluded' : ''}">
        <span class="weight-pct">${count}개</span>
        <span class="weight-name" title="${escapeHtml(menu.name)}">${escapeHtml(menu.name)}</span>
        <div class="weight-controls">
          <span class="weight-pct">${pct}%</span>
          <button class="wc-btn" onclick="adjustMarbleCount(${menu.id}, -1)" ${excluded || count <= 1 ? 'disabled' : ''}>−</button>
          <input class="wc-input" type="number" min="1" max="5" value="${count}"
            onchange="setMarbleCount(${menu.id}, this.value)"
            oninput="setMarbleCount(${menu.id}, this.value)"
            ${excluded ? 'disabled' : ''} />
          <button class="wc-btn" onclick="adjustMarbleCount(${menu.id}, 1)" ${excluded || count >= 5 ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
  }).join('');
}

function adjustMarbleCount(id, delta) {
  marbleCount[id] = Math.min(5, Math.max(1, getMarbleCount(id) + delta));
  initMarble();
}

function setMarbleCount(id, value) {
  const next = parseInt(value, 10);
  if (Number.isNaN(next)) return;
  marbleCount[id] = Math.min(5, Math.max(1, next));
  initMarble();
}

function resetMarbleCounts() {
  menus.forEach(menu => { marbleCount[menu.id] = 1; });
  initMarble();
  showToast('마블 구슬 수량 초기화 완료');
}

// 메뉴 CRUD
async function addMenu() {
  const nameEl = document.getElementById('new-name');
  const catEl  = document.getElementById('new-category');
  const name   = nameEl.value.trim();
  if (!name) return;
  const res = await window.api.addMenu({ name, category: catEl.value });
  if (res.success) { nameEl.value = ''; await loadMenus(); showToast(`"${name}" 추가됨`); }
  else showToast(res.error, true);
}

async function addMenuFromWheel() {
  const nameEl = document.getElementById('wheel-new-name');
  const catEl  = document.getElementById('wheel-new-category');
  const name   = nameEl.value.trim();
  if (!name) return;
  const res = await window.api.addMenu({ name, category: catEl.value });
  if (res.success) { nameEl.value = ''; await loadMenus(); showToast(`"${name}" 추가됨`); }
  else showToast(res.error, true);
}

async function deleteMenu(id) {
  const menu = menus.find(m => m.id === id);
  delete weights[id];
  delete marbleCount[id];
  await window.api.deleteMenu(id);
  await loadMenus();
  showToast(`"${menu.name}" 삭제됨`);
}

async function toggleExclude(id) { await window.api.toggleExclude(id); await loadMenus(); }

async function toggleFavorite(id) { await window.api.toggleFavorite(id); await loadMenus(); }

// 수정 모달을 열고 현재 메뉴 값을 채운다.
function openEdit(id) {
  editingId = id;
  const menu = menus.find(m => m.id === id);
  document.getElementById('edit-name').value     = menu.name;
  document.getElementById('edit-category').value = menu.category;
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('edit-name').focus(), 100);
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('show'); editingId = null; }

// 수정 모달에서 입력한 값을 저장한다.
async function saveEdit() {
  const name     = document.getElementById('edit-name').value.trim();
  const category = document.getElementById('edit-category').value;
  if (!name) return;
  const res = await window.api.updateMenu({ id: editingId, name, category });
  if (res.success) { closeModal(); await loadMenus(); showToast('수정 완료'); }
  else showToast(res.error, true);
}

document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

// 랜덤 뽑기
async function pickRandom() {
  const filtered = getFilteredMenus();
  if (!filtered.length) { showToast('선택 가능한 메뉴가 없어요.', true); return; }
  const card  = document.getElementById('result-card');
  const nameEl = document.getElementById('result-name');
  const catEl  = document.getElementById('result-category');
  let spin = setInterval(() => {
    const r = filtered[Math.floor(Math.random() * filtered.length)];
    nameEl.textContent = r.name; catEl.textContent = r.category;
  }, 80);
  setTimeout(async () => {
    clearInterval(spin);
    const picked = filtered[Math.floor(Math.random() * filtered.length)];
    nameEl.textContent = picked.name; catEl.textContent = picked.category;
    nameEl.classList.remove('pop'); void nameEl.offsetWidth; nameEl.classList.add('pop');
    card.classList.add('glow'); setTimeout(() => card.classList.remove('glow'), 2000);
    await window.api.recordPick(picked.name);
    await loadHistory();
    latestPickedMenuName = picked.name;
    syncPickedMenuMapButton();
  }, 1000);
}

// 히스토리
async function loadHistory() {
  history = await window.api.getHistory();
  const list = document.getElementById('history-list');
  if (!history.length) { list.innerHTML = '<div class="empty-state">아직 기록이 없습니다.</div>'; }
  else {
    list.innerHTML = history.map(h => {
      const d = new Date(h.picked_at);
      const t = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      return `<div class="history-item"><span class="history-name">${escapeHtml(h.menu_name)}</span><span class="history-time">${t}</span></div>`;
    }).join('');
  }
  renderStats();
  updatePickInfo();
}

async function clearHistory() { await window.api.clearHistory(); await loadHistory(); showToast('기록 삭제 완료'); }

// 통계
function renderStats() {
  const el = document.getElementById('stats-content');
  if (!history.length) { el.innerHTML = '<div class="stat-empty">아직 기록이 없습니다.</div>'; return; }

  // 메뉴별 선택 횟수
  const counts = {};
  history.forEach(h => { counts[h.menu_name] = (counts[h.menu_name] || 0) + 1; });
  const top5   = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCnt = top5[0][1];

  // 카테고리별 선택 횟수
  const catMap = {};
  history.forEach(h => {
    const m = menus.find(x => x.name === h.menu_name);
    const cat = m ? m.category : '기타';
    catMap[cat] = (catMap[cat] || 0) + 1;
  });
  const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];

  el.innerHTML = `
    <div class="stats-section-title">자주 먹은 메뉴 TOP 5</div>
    ${top5.map(([name, cnt], i) => `
      <div class="stat-item">
        <span class="stat-rank">${i + 1}</span>
        <span class="stat-name">${escapeHtml(name)}</span>
        <div class="stat-bar-wrap"><div class="stat-bar" style="width:${Math.round(cnt/maxCnt*100)}%"></div></div>
        <span class="stat-count">${cnt}회</span>
      </div>`).join('')}
    <div class="stats-section-title" style="margin-top:6px">선호 카테고리</div>
    <div class="stat-item">
      <span class="stat-rank">1</span>
      <span class="stat-name">${escapeHtml(topCat[0])}</span>
      <div class="stat-bar-wrap"><div class="stat-bar" style="width:100%"></div></div>
      <span class="stat-count">${topCat[1]}회</span>
    </div>
  `;
}

// Toast
let toastTimer;
// 하단 토스트 메시지를 잠시 표시한다.
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// 지도 패널의 상태 문구를 갱신한다.
function setMapStatus(message, isError = false) {
  const status = document.getElementById('map-status');
  status.textContent = message;
  status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

// 지도 패널을 연다.
function mountMapPanelIntoLeftBody() {
  const leftBody = document.getElementById('left-body');
  const panel = document.getElementById('map-test-panel');
  if (!leftBody || !panel || panel.parentElement === leftBody) return;
  leftBody.appendChild(panel);
}

function showMapPanel() {
  mountMapPanelIntoLeftBody();
  document.getElementById('map-test-panel').classList.add('show');
  mapPanelRequestToken += 1;
  return mapPanelRequestToken;
}

// 지도 패널을 닫는다.
function hideMapPanel() {
  document.getElementById('map-test-panel').classList.remove('show');
  mapPanelRequestToken += 1;
}

function isMapPanelRequestActive(token) {
  const panel = document.getElementById('map-test-panel');
  return token === mapPanelRequestToken && panel?.classList.contains('show');
}

function syncPickedMenuMapButton() {
  const btn = document.getElementById('pick-map-btn');
  if (!btn) return;
  btn.disabled = !latestPickedMenuName;
}

function syncWheelPickedMenuMapButton() {
  const btn = document.getElementById('wheel-map-btn');
  if (!btn) return;
  btn.disabled = !latestWheelPickedMenuName;
}

async function showPickedMenuMap(menuName, sourceLabel = '메뉴 추천') {
  const keyword = String(menuName || '').trim();
  if (!keyword) return;

  const keywordInput = document.getElementById('map-search-keyword');
  if (keywordInput) keywordInput.value = keyword;

  try {
    await testCurrentLocationMap({ skipAutoSearch: true });
    if (!kakaoMapInstance) return;

    await searchPlacesOnMap({
      keyword,
      silentOnMapInit: true,
      baseStatusMessage: `${sourceLabel} 결과 "${keyword}" 기준으로 주변 지도를 불러왔습니다.`,
    });
  } catch (error) {
    console.error('[map] picked menu map open failed:', error);
  }
}

// 사용자가 체크박스로 현재 위치 사용을 허용했는지 확인한다.
async function openPickedMenuMap() {
  if (!latestPickedMenuName) {
    showToast('먼저 메뉴를 뽑아주세요.', true);
    return;
  }
  await showPickedMenuMap(latestPickedMenuName, '랜덤 뽑기');
}

async function openWheelPickedMenuMap() {
  if (!latestWheelPickedMenuName) {
    showToast('먼저 돌림판 결과를 확인해주세요.', true);
    return;
  }
  await showPickedMenuMap(latestWheelPickedMenuName, '돌림판');
}

function hasLocationConsent() {
  return document.getElementById('map-location-consent')?.checked === true;
}

// 위치 사용 허용/거부가 한 번이라도 저장되었는지 확인한다.
function hasStoredLocationConsentDecision() {
  return window.localStorage.getItem(MAP_LOCATION_CONSENT_KEY) !== null;
}

// 첫 사용 시 표시할 위치 동의 모달을 연다.
function showMapConsentModal() {
  document.getElementById('map-consent-modal')?.classList.add('show');
}

// 위치 동의 모달을 닫는다.
function hideMapConsentModal() {
  document.getElementById('map-consent-modal')?.classList.remove('show');
}

// 모달에서 선택한 위치 사용 여부를 저장하고 대기 중인 흐름을 재개한다.
function resolveMapConsent(allowed) {
  const checkbox = document.getElementById('map-location-consent');
  if (checkbox) checkbox.checked = allowed;
  window.localStorage.setItem(MAP_LOCATION_CONSENT_KEY, String(allowed));
  window.api.setLocationConsent?.(allowed);
  hideMapConsentModal();
  mapConsentResolver?.(allowed);
  mapConsentResolver = null;
  setMapStatus(
    allowed
      ? '현재 위치 사용이 허용되었습니다. 지도 불러오기를 누르면 실제 위치를 우선 시도합니다.'
      : '현재 위치 사용이 거부되었습니다. 지도는 IP 기반 대략 위치로 불러옵니다.'
  );
}

window.resolveMapConsent = resolveMapConsent;

async function ensureLocationConsentResolved() {
  if (hasStoredLocationConsentDecision()) return hasLocationConsent();

  return new Promise(resolve => {
    mapConsentResolver = resolve;
    showMapConsentModal();
  });
}

// 저장된 위치 동의 상태를 체크박스 UI와 동기화한다.
function syncLocationConsentUI() {
  const checkbox = document.getElementById('map-location-consent');
  if (!checkbox) return;

  const savedValue = window.localStorage.getItem(MAP_LOCATION_CONSENT_KEY);
  checkbox.checked = savedValue === 'true';
  window.api.setLocationConsent?.(checkbox.checked);
  checkbox.addEventListener('change', () => {
    window.localStorage.setItem(MAP_LOCATION_CONSENT_KEY, String(checkbox.checked));
    window.api.setLocationConsent?.(checkbox.checked);
    setMapStatus(
      checkbox.checked
        ? '현재 위치 사용이 허용되었습니다. 지도 불러오기를 누르면 실제 위치를 우선 시도합니다.'
        : '현재 위치 사용이 꺼져 있습니다. 지도는 IP 기반 대략 위치로 불러옵니다.'
    );
  });
}

// 지도 패널 하단에 장소 검색 결과 목록을 그린다.
function renderMapSearchResults(places = []) {
  const container = document.getElementById('map-search-results');
  if (!places.length) {
    container.innerHTML = '<div class="map-search-empty">검색 결과가 없습니다.</div>';
    return;
  }

  container.innerHTML = places.map((place, index) => `
    <div class="map-place-item" onclick="focusPlaceMarker(${index})">
      <div class="map-place-title">${escapeHtml(place.name)}</div>
      <div class="map-place-meta">${escapeHtml(place.category || '카테고리 없음')}${place.distance ? ` · ${place.distance}m` : ''}</div>
      <div class="map-place-address">${escapeHtml(place.address || '주소 정보 없음')}</div>
    </div>
  `).join('');
}

// 기존 장소 마커와 인포윈도우를 모두 정리한다.
function clearPlaceMarkers() {
  kakaoPlaceMarkers.forEach(entry => entry.marker.setMap(null));
  kakaoPlaceMarkers = [];
  kakaoPlaceInfoWindow?.close();
}

// 인포윈도우가 잘리지 않도록 마커를 화면 하단 쪽으로 오게 이동한다.
function moveMapForInfoWindow(position, callback) {
  if (!window.kakao?.maps || !kakaoMapInstance) {
    callback?.();
    return;
  }

  const mapContainer = document.getElementById('kakao-map');
  const projection = kakaoMapInstance.getProjection();
  if (!mapContainer || !projection) {
    kakaoMapInstance.panTo(position);
    callback?.();
    return;
  }

  const markerPoint = projection.containerPointFromCoords(position);
  const centerPoint = projection.containerPointFromCoords(kakaoMapInstance.getCenter());
  const desiredPoint = new window.kakao.maps.Point(
    mapContainer.clientWidth / 2,
    Math.min(mapContainer.clientHeight * 0.76, mapContainer.clientHeight - 70)
  );

  const dx = markerPoint.x - desiredPoint.x;
  const dy = markerPoint.y - desiredPoint.y;
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
    callback?.();
    return;
  }

  const nextCenterPoint = new window.kakao.maps.Point(centerPoint.x + dx, centerPoint.y + dy);
  const nextCenter = projection.coordsFromContainerPoint(nextCenterPoint);
  const idleHandler = () => {
    window.kakao.maps.event.removeListener(kakaoMapInstance, 'idle', idleHandler);
    callback?.();
  };

  window.kakao.maps.event.addListener(kakaoMapInstance, 'idle', idleHandler);
  kakaoMapInstance.panTo(nextCenter);
}

// 선택한 장소의 상세 정보를 인포윈도우로 연다.
function openPlaceInfo(place, marker, options = {}) {
  if (!window.kakao?.maps || !kakaoMapInstance) return;
  if (!kakaoPlaceInfoWindow) {
    kakaoPlaceInfoWindow = new window.kakao.maps.InfoWindow({
      removable: true,
      disableAutoPan: false,
    });
  }

  const safeUrl = (place.url && /^https:\/\//.test(place.url)) ? place.url : null;
  const content = `
    <div style="padding:10px 12px; min-width:240px; max-width:300px; color:#111; line-height:1.5; white-space:normal;">
      <div style="font-weight:700; margin-bottom:4px; padding-right:18px; line-height:1.45; word-break:break-word; overflow-wrap:anywhere;">${escapeHtml(place.name)}</div>
      <div style="font-size:12px; color:#555;">${escapeHtml(place.category || '')}</div>
      <div style="font-size:12px; color:#333; margin-top:6px; word-break:keep-all; overflow-wrap:anywhere;">${escapeHtml(place.address || '')}</div>
      ${place.distance ? `<div style="font-size:12px; color:#ff6b35; margin-top:6px;">현재 중심에서 ${place.distance}m</div>` : ''}
      ${safeUrl ? `<div style="margin-top:8px;"><a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer" style="font-size:12px; color:#0068c3; text-decoration:none;">카카오맵에서 보기</a></div>` : ''}
    </div>
  `;

  // 기존 창을 재사용하되 위치 보정 후 다시 열어 잘림을 줄인다.
  const showInfoWindow = () => {
    kakaoPlaceInfoWindow.close();
    kakaoPlaceInfoWindow.setContent(content);
    kakaoPlaceInfoWindow.open(kakaoMapInstance, marker);
  };

  if (options.skipReposition) {
    showInfoWindow();
    return;
  }

  kakaoPlaceInfoWindow.close();
  moveMapForInfoWindow(marker.getPosition(), () => {
    window.setTimeout(showInfoWindow, 80);
  });
}

// 검색 목록에서 선택한 장소 마커에 포커싱한다.
function focusPlaceMarker(index) {
  const entry = kakaoPlaceMarkers[index];
  if (!entry || !kakaoMapInstance) return;

  openPlaceInfo(entry.place, entry.marker);
}

// 지도 메타 영역에 위치 출처나 검색 요약을 표시한다.
function updateMapMeta(label = '', extra = '') {
  const parts = [label, extra].filter(Boolean);
  document.getElementById('current-location-meta').textContent = parts.join(' · ');
}

// 브라우저 geolocation API로 위치를 조회한다.
function getBrowserGeolocationPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 환경에서는 브라우저 위치 정보를 사용할 수 없습니다.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve({
          coords: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          },
          source: 'geolocation',
        });
      },
      (error) => {
        const messageMap = {
          1: '위치 권한이 거부되었습니다.',
          2: '기기 위치를 확인할 수 없습니다.',
          3: '위치 정보를 가져오는 시간이 초과되었습니다.',
        };
        reject(new Error(messageMap[error.code] || error.message || '위치 정보를 가져오지 못했습니다.'));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
}

// 현재 공인 IP를 기준으로 대략적인 위치를 조회한다.
function getIpBasedPosition() {
  return fetch('https://ipapi.co/json/')
    .then(r => r.json())
    .then(data => {
      if (!data.latitude) throw new Error('IP 위치 조회 실패');
      return {
        coords: {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: 5000,
        },
        source: 'ip',
      };
    });
}

// Electron 환경에서는 브라우저 위치보다 네이티브 위치를 우선 사용한다.
function shouldPreferNativePosition() {
  return Boolean(window.api?.getNativePosition);
}

// 동의 상태와 실행 환경에 따라 가장 적절한 위치 소스를 선택한다.
async function legacyGetBestAvailablePosition() {
  if (!hasLocationConsent()) {
    const ipPosition = await getIpBasedPosition();
    return {
      ...ipPosition,
      fallbackReason: '현재 위치 사용이 허용되지 않았습니다.',
    };
  }

  if (shouldPreferNativePosition()) {
    try {
      return await window.api.getNativePosition();
    } catch (nativeError) {
      console.warn('[Map] 네이티브 위치 정보를 가져오지 못해 IP 위치로 대체합니다:', nativeError);
      const ipPosition = await getIpBasedPosition();
      return {
        ...ipPosition,
        fallbackReason: nativeError.message,
      };
    }
  }

  try {
    return await getBrowserGeolocationPosition();
  } catch (geoError) {
    console.warn('[Map] 브라우저 위치 정보를 가져오지 못해 IP 위치로 대체합니다:', geoError);
    const ipPosition = await getIpBasedPosition();
    return {
      ...ipPosition,
      fallbackReason: geoError.message,
    };
  }
}

// 카카오 지도 SDK 스크립트를 한 번만 로드한다.
async function getBestAvailablePosition() {
  if (!hasLocationConsent()) {
    const ipPosition = await getIpBasedPosition();
    return {
      ...ipPosition,
      fallbackReason: '현재 위치 사용이 허용되지 않았습니다.',
    };
  }

  let nativeError = null;
  if (shouldPreferNativePosition()) {
    try {
      return await window.api.getNativePosition();
    } catch (error) {
      nativeError = error;
      console.warn('[Map] 네이티브 위치 정보를 가져오지 못해 브라우저 위치를 다시 시도합니다:', error);
    }
  }

  try {
    const browserPosition = await getBrowserGeolocationPosition();
    return nativeError
      ? { ...browserPosition, fallbackReason: nativeError.message }
      : browserPosition;
  } catch (geoError) {
    console.warn('[Map] 브라우저 위치 정보를 가져오지 못해 IP 위치로 대체합니다:', geoError);
    const ipPosition = await getIpBasedPosition();
    const fallbackReason = [nativeError?.message, geoError?.message]
      .filter(Boolean)
      .join(' / ');
    return {
      ...ipPosition,
      fallbackReason,
    };
  }
}

function loadKakaoMapSdk(appKey) {
  if (window.kakao?.maps) return Promise.resolve(window.kakao.maps);
  if (kakaoMapScriptPromise) return kakaoMapScriptPromise;

  kakaoMapScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const cleanup = (err) => {
      kakaoMapScriptPromise = null;
      if (script.parentNode) document.head.removeChild(script);
      reject(err);
    };

    const timer = setTimeout(() => {
      cleanup(new Error(`Kakao 지도 SDK 로드 시간이 초과되었습니다. 카카오 콘솔에 ${window.location.origin} 이 등록되어 있는지 확인해 주세요.`));
    }, 10000);

    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.onload = () => {
      window.kakao.maps.load(() => { clearTimeout(timer); resolve(window.kakao.maps); });
    };
    script.onerror = (e) => {
      clearTimeout(timer);
      console.error('[Kakao SDK] 스크립트 로드 실패:', e);
      cleanup(new Error(`Kakao 지도 SDK를 불러오지 못했습니다. 카카오 콘솔의 도메인 등록 상태를 확인해 주세요. 현재 주소: ${window.location.origin}`));
    };
    document.head.appendChild(script);
  });

  return kakaoMapScriptPromise;
}

async function testCurrentLocationMap(options = {}) {
  const requestToken = options.preservePanelToken ?? showMapPanel();
  const appKey = (kakaoMapConfig?.jsKey || '').trim();

  if (!appKey) {
    setMapStatus('Kakao JavaScript 키가 설정되지 않았습니다.', true);
    showToast('Kakao JavaScript 키가 필요합니다.', true);
    return;
  }

  await ensureLocationConsentResolved();
  if (!isMapPanelRequestActive(requestToken)) return;

  try {
    setMapStatus(
      hasLocationConsent()
        ? '현재 위치 기반으로 Kakao 지도를 불러오는 중입니다...'
        : '현재 위치 사용이 꺼져 있어 IP 기반 대략 위치로 Kakao 지도를 불러오는 중입니다...'
    );
    const [maps, position] = await Promise.all([
      loadKakaoMapSdk(appKey),
      getBestAvailablePosition(),
    ]);
    if (!isMapPanelRequestActive(requestToken)) return;

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const center = new window.kakao.maps.LatLng(lat, lng);
    const mapContainer = document.getElementById('kakao-map');
    const locationMeta = document.getElementById('current-location-meta');

    if (!kakaoMapInstance) {
      kakaoMapInstance = new maps.Map(mapContainer, {
        center,
        level: 3,
      });
      const zoomControl = new maps.ZoomControl();
      kakaoMapInstance.addControl(zoomControl, window.kakao.maps.ControlPosition.RIGHT);
    } else {
      kakaoMapInstance.setLevel(3);
      kakaoMapInstance.setCenter(center);
    }

    if (!kakaoMapMarker) {
      kakaoMapMarker = new maps.Marker({ position: center });
      kakaoMapMarker.setMap(kakaoMapInstance);
    } else {
      kakaoMapMarker.setPosition(center);
    }

    kakaoMapInstance.relayout();
    kakaoMapInstance.setCenter(center);
    // 사용자에게는 좌표 대신 어떤 기준으로 잡혔는지만 보여준다.
    const sourceLabel =
      position.source === 'ip'
        ? 'IP 기반 대략 위치'
        : position.source === 'native'
          ? 'Windows 위치 서비스'
          : '실제 기기 위치';
    locationMeta.textContent = sourceLabel;
    clearPlaceMarkers();
    renderMapSearchResults([]);
    const loadedMessage = position.source === 'ip'
      ? '정확한 현재 위치를 가져오지 못해 IP 기반 대략 위치로 지도를 불러왔습니다.'
      : position.source === 'native'
        ? '브라우저 위치 조회는 실패했지만 Windows 위치 서비스로 지도를 불러왔습니다.'
        : '실제 기기 위치 기반 지도를 불러왔습니다.';
    if (position.fallbackReason) {
      console.info('[map] location fallback reason:', position.fallbackReason, {
        source: position.source,
        coords: position.coords,
      });
    }
    setMapStatus(loadedMessage);
    showToast(position.source === 'ip'
      ? 'IP 기반 대략 위치로 지도를 불러왔습니다.'
      : position.source === 'native'
        ? 'Windows 위치 서비스로 지도를 불러왔습니다.'
      : '실제 기기 위치로 지도를 불러왔습니다.');

    const keywordInput = document.getElementById('map-search-keyword');
    if (keywordInput && !keywordInput.value.trim()) {
      keywordInput.value = '음식점';
    }

    if (!options.skipAutoSearch) {
      await searchPlacesOnMap({
        keyword: keywordInput?.value.trim() || '음식점',
        silentOnMapInit: true,
        baseStatusMessage: loadedMessage,
        preservePanelToken: requestToken,
      });
    }
  } catch (error) {
    if (!isMapPanelRequestActive(requestToken)) return;
    setMapStatus(error.message || '현재 위치 지도를 불러오지 못했습니다.', true);
    showToast(error.message || '현재 위치 지도를 불러오지 못했습니다.', true);
  }
}

// 현재 지도 중심을 기준으로 장소 검색을 수행한다.
async function searchPlacesOnMap(options = {}) {
  const requestToken = options.preservePanelToken ?? showMapPanel();
  const keywordInput = document.getElementById('map-search-keyword');
  const keyword = (options.keyword ?? keywordInput?.value ?? '').trim();

  if (!keyword) {
    setMapStatus('검색어를 먼저 입력해 주세요.', true);
    showToast('검색어를 입력해 주세요.', true);
    return;
  }

  try {
    if (!kakaoMapInstance) {
      await testCurrentLocationMap({ skipAutoSearch: true, preservePanelToken: requestToken });
      if (!kakaoMapInstance) return;
    }
    if (!isMapPanelRequestActive(requestToken)) return;

    const center = kakaoMapInstance.getCenter();
    setMapStatus(`"${keyword}" 검색 중입니다...`);

    // 메인 프로세스에서 키워드/카테고리 검색을 자동 분기한다.
    const result = await window.api.searchPlaces({
      query: keyword,
      x: center.getLng(),
      y: center.getLat(),
      radius: 3000,
      size: 10,
    });
    if (!isMapPanelRequestActive(requestToken)) return;

    if (!result?.success) {
      throw new Error(result?.error || '장소 검색에 실패했습니다.');
    }

    clearPlaceMarkers();
    renderMapSearchResults(result.places || []);

    if (!result.places?.length) {
      updateMapMeta(
        document.getElementById('current-location-meta')?.textContent || '',
        `"${keyword}" 결과 없음`
      );
      setMapStatus(`"${keyword}" 검색 결과가 없습니다.`, true);
      return;
    }

    // 검색된 모든 마커가 보이도록 bounds를 다시 계산한다.
    const bounds = new window.kakao.maps.LatLngBounds();
    result.places.forEach(place => {
      const position = new window.kakao.maps.LatLng(place.y, place.x);
      const marker = new window.kakao.maps.Marker({ position });
      marker.setMap(kakaoMapInstance);
      window.kakao.maps.event.addListener(marker, 'click', () => openPlaceInfo(place, marker));
      kakaoPlaceMarkers.push({ marker, place, position });
      bounds.extend(position);
    });

    kakaoMapInstance.setBounds(bounds);
    updateMapMeta(
      document.getElementById('current-location-meta')?.textContent || '',
      `"${keyword}" ${result.places.length}건`
    );
    const searchModeLabel = result.searchMode === 'category' ? '카테고리 검색' : '키워드 검색';
    const resultMessage = `"${keyword}" ${searchModeLabel} 결과 ${result.places.length}건을 표시했습니다.`;
    setMapStatus(options.silentOnMapInit && options.baseStatusMessage
      ? `${options.baseStatusMessage} · ${resultMessage}`
      : resultMessage);
    if (!options.silentOnMapInit) {
      showToast(`"${keyword}" 검색 결과를 표시했습니다.`);
    }
  } catch (error) {
    if (!isMapPanelRequestActive(requestToken)) return;
    setMapStatus(error.message || '장소 검색에 실패했습니다.', true);
    showToast(error.message || '장소 검색에 실패했습니다.', true);
  }
}

const WHEEL_COLORS = [
  '#ff6b35','#4cc9f0','#06d6a0','#ffd166','#9b5de5',
  '#f15bb5','#118ab2','#ffb347','#e63946','#52c97b',
  '#00bbf9','#ef476f','#26c485','#ff9f1c','#4361ee',
];

let wheelSpinning = false;
let wheelAngle    = 0;
let wheelAnimId   = null;
let wheelPendingResult = null;

// 현재 가중치 상태를 기반으로 룰렛 캔버스를 그린다.
function drawWheel(angle) {
  const canvas = document.getElementById('wheelCanvas');
  if (!canvas) return;
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width, H = canvas.height;
  const cx   = W / 2, cy = H / 2, r = W / 2 - 4;
  const items = getActiveItems();
  ctx.clearRect(0, 0, W, H);

  if (!items.length) {
    ctx.fillStyle = '#17171a';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#777'; ctx.font = '13px Pretendard, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('선택 가능한 메뉴가 없습니다', cx, cy);
    return;
  }

  const total = totalWeight(items);
  let cur = angle;

  items.forEach((menu, i) => {
    const sa = (menu.weight / total) * Math.PI * 2;
    const s  = cur, e = cur + sa;

    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, s, e); ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length]; ctx.fill();
    ctx.strokeStyle = '#0d0d0f'; ctx.lineWidth = 1.5; ctx.stroke();

    if (sa > 0.15) {
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(s + sa / 2);
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
      const fs = items.length > 12 ? 10 : 12;
      ctx.font = `600 ${fs}px Pretendard, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
      let label = menu.name;
      if (label.length > 5) label = label.slice(0, 5) + '..';
      ctx.fillText(label, r - 10, 4);
      ctx.restore();
    }
    cur = e;
  });

  // 중앙 버튼
  ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#0d0d0f'; ctx.fill();
  ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 2; ctx.stroke();
}

function finalizeWheelResult() {
  if (!wheelPendingResult) return;

  const { finalAngle, pickedName } = wheelPendingResult;
  const btn = document.getElementById('wheel-btn');
  const skipBtn = document.getElementById('wheel-skip-btn');
  const resultBox = document.getElementById('wheel-result');

  wheelAngle = finalAngle;
  drawWheel(wheelAngle);
  wheelSpinning = false;
  wheelAnimId = null;
  wheelPendingResult = null;

  if (btn) btn.disabled = false;
  if (skipBtn) skipBtn.disabled = true;
  if (resultBox) resultBox.textContent = `당첨 ${pickedName}!`;
  latestWheelPickedMenuName = pickedName;
  syncWheelPickedMenuMapButton();
  window.api.recordPick(pickedName).then(() => loadHistory());
}

// 가중치에 비례한 당첨 메뉴를 계산하고 회전 애니메이션을 실행한다.
function spinWheel() {
  const items = getActiveItems();
  if (!items.length) { showToast('선택 가능한 메뉴가 없어요.', true); return; }
  if (wheelSpinning) return;
  wheelSpinning = true;

  const btn = document.getElementById('wheel-btn');
  const skipBtn = document.getElementById('wheel-skip-btn');
  const resultBox = document.getElementById('wheel-result');
  btn.disabled = true;
  if (skipBtn) skipBtn.disabled = false;
  resultBox.textContent = '';

  // 가중치 기반 랜덤 선택
  const total = totalWeight(items);
  let rand = Math.random() * total, targetIdx = items.length - 1;
  for (let i = 0; i < items.length; i++) { rand -= items[i].weight; if (rand <= 0) { targetIdx = i; break; } }

  // 목표 조각 중앙 각도
  let sliceStart = 0;
  for (let i = 0; i < targetIdx; i++) sliceStart += (items[i].weight / total) * Math.PI * 2;
  const sliceAngle = (items[targetIdx].weight / total) * Math.PI * 2;
  const sliceMid   = sliceStart + sliceAngle / 2;

  const startAngle = wheelAngle;
  const fullTurn   = Math.PI * 2;
  const targetAngle = -Math.PI / 2 - sliceMid;
  const normalizedStart = ((startAngle % fullTurn) + fullTurn) % fullTurn;
  const normalizedTarget = ((targetAngle % fullTurn) + fullTurn) % fullTurn;
  const alignDelta = -((normalizedStart - normalizedTarget + fullTurn) % fullTurn);
  const extraSpins = fullTurn * 7;
  const finalAngle = startAngle + alignDelta - extraSpins;

  const duration   = 4800;
  const startTime  = performance.now();
  wheelPendingResult = {
    finalAngle,
    pickedName: items[targetIdx].name,
  };

  function easeOut(t) { return 1 - Math.pow(1 - t, 3.5); }

  function animate(now) {
    const t = Math.min((now - startTime) / duration, 1);
    wheelAngle = startAngle + (finalAngle - startAngle) * easeOut(t);
    drawWheel(wheelAngle);
    if (t < 1) {
      wheelAnimId = requestAnimationFrame(animate);
    } else {
      finalizeWheelResult();
    }
  }
  wheelAnimId = requestAnimationFrame(animate);
}

function skipWheel() {
  if (!wheelSpinning || !wheelPendingResult) return;
  cancelAnimationFrame(wheelAnimId);
  finalizeWheelResult();
}

// 마블 룰렛 (Dynamic Plinko, 5구역)
const MARBLE_COLORS = [
  '#ff6b35','#4cc9f0','#06d6a0','#ffd166','#9b5de5',
  '#f15bb5','#118ab2','#ffb347','#e63946','#52c97b',
  '#00bbf9','#ef476f','#26c485','#ff9f1c','#4361ee',
];

const MB_GRAVITY     = 0.22;
const MB_DAMPING     = 0.992;
const MB_RESTITUTION = 0.62;
const MB_MARBLE_R    = 7;
const MB_PEG_R       = 5;
const MB_BUMPER_R    = 5;
const MB_TRACK_H     = 3400;
const MINIMAP_W      = 68;
const MINIMAP_BORDER = 8;

// 4개 구역 정의
const MB_ZONES = [
  { y1:   70, y2:  720, label: 'ENTRY',  bg: 'rgba(255,107,53,0.04)'  },
  { y1:  720, y2: 1430, label: 'SLALOM', bg: 'rgba(155,93,229,0.05)'  },
  { y1: 1430, y2: 2370, label: 'MID',    bg: 'rgba(6,214,160,0.03)'   },
  { y1: 2370, y2: 3010, label: 'EXIT',   bg: 'rgba(255,209,102,0.04)' },
];

let marbleItems     = [];
let marbleBalls     = [];
let marblePegs      = [];
let marbleBumpers   = [];
let marbleRotators  = [];
let marbleRunning   = false;
let marbleFinished  = false;
let marbleAnimId    = null;
let marbleExitOrder = [];
let mbTrackW        = 360;
let marbleResizeTimer = null;
const MB_LAST_STRETCH_Y = 3040;
const MB_LAST_ONE_WIN_Y = 3000;

// RGB 값을 증감해 구슬 음영 색을 만든다.
function shadeColor(hex, pct) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + pct));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + pct));
  const b = Math.min(255, Math.max(0, (num & 0xff) + pct));
  return `rgb(${r},${g},${b})`;
}

// 선분 위의 가장 가까운 점
function pointSegClosest(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.001) return { dist: Math.hypot(px - x1, py - y1), cx: x1, cy: y1 };
  const t  = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), cx, cy };
}

// 마블 코스의 핀 배치를 생성한다.
function generatePegs(W) {
  marblePegs = [];
  const m  = MB_MARBLE_R * 3 + MB_PEG_R;
  const uW = W - m * 2;

  // Zone 1 ENTRY 핀 배치 7줄
  for (let row = 0; row < 7; row++) {
    const y    = 100 + row * 84;
    const even = row % 2 === 0;
    const cols = even ? 7 : 6;
    const step = uW / cols;
    const ox   = even ? m : m + step * 0.5;
    for (let col = 0; col < cols; col++) {
      marblePegs.push({ x: ox + col * step, y, r: MB_PEG_R });
    }
  }

  // Zone 3 MID 지그재그 (좌우 교차 통로)
  const MID_Y0   = 1500;
  const MID_ROWS = 7;
  const MID_DY   = 130;
  const PASS_W   = W * 0.25; // 통과 구멍 폭

  for (let row = 0; row < MID_ROWS; row++) {
    const y = MID_Y0 + row * MID_DY;
    // 짝수 줄은 오른쪽에 구멍 / 홀수 줄은 왼쪽에 구멍
    const passOnRight = row % 2 === 0;
    const passX0 = passOnRight ? W - m - PASS_W : m;
    const passX1 = passOnRight ? W - m           : m + PASS_W;

    const step = MB_PEG_R * 2 + 14;
    for (let x = m; x <= W - m; x += step) {
      if (x + MB_PEG_R > passX0 && x - MB_PEG_R < passX1) continue;
      marblePegs.push({ x, y, r: MB_PEG_R });
    }
  }

  // Zone 5 EXIT 핀 배치 7줄
  for (let row = 0; row < 7; row++) {
    const y    = 2440 + row * 78;
    const even = row % 2 === 0;
    const cols = even ? 7 : 6;
    const step = uW / cols;
    const ox   = even ? m : m + step * 0.5;
    for (let col = 0; col < cols; col++) {
      marblePegs.push({ x: ox + col * step, y, r: MB_PEG_R });
    }
  }

}

// 마블 코스의 범퍼 배치를 생성한다.
function generateBumpers(W) {
  marbleBumpers = [];

  // Zone 2 SLALOM 좌우 교차 대각선 범퍼 4개
  marbleBumpers.push(
    { x1: 1,     y1:  762, x2: W * 0.46, y2:  882, color: '#9b5de5' },
    { x1: W - 1, y1:  942, x2: W * 0.54, y2: 1062, color: '#9b5de5' },
    { x1: 1,     y1: 1122, x2: W * 0.46, y2: 1242, color: '#9b5de5' },
    { x1: W - 1, y1: 1302, x2: W * 0.54, y2: 1422, color: '#9b5de5' },
  );

  // Zone 6 NARROW 최하단 좁은 통로
  const nY1 = 3010, nY2 = 3138;
  const nHalf = 55;
  marbleBumpers.push(
    { x1: 1,     y1: nY1, x2: W / 2 - nHalf, y2: nY2, color: '#ff6b35' },
    { x1: W - 1, y1: nY1, x2: W / 2 + nHalf, y2: nY2, color: '#ff6b35' },
  );
}

// 현재 메뉴 목록을 바탕으로 마블 시뮬레이션 상태를 초기화한다.
function rebuildMarbleCourseGeometry(trackWidth) {
  generatePegs(trackWidth);
  generateBumpers(trackWidth);

  const prevRotator = marbleRotators[0];
  marbleRotators = [
    {
      cx: trackWidth / 2 - 55,
      cy: 3138,
      armLen: 88,
      angle: prevRotator?.angle ?? 0,
      speed: -0.022,
      armR: 6,
      arms: 2,
    },
  ];

  const narrowY1 = 3010;
  const narrowY2 = 3138;
  const narrowHalf = 55;
  [
    [1, narrowY1, trackWidth / 2 - narrowHalf, narrowY2],
    [trackWidth - 1, narrowY1, trackWidth / 2 + narrowHalf, narrowY2],
  ].forEach(([x1, y1, x2, y2]) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const step = (MB_MARBLE_R + MB_BUMPER_R) * 1.4;
    for (let d = step * 0.5; d < len; d += step) {
      const t = d / len;
      marblePegs.push({ x: x1 + t * dx, y: y1 + t * dy, r: MB_BUMPER_R + 1, hidden: true });
    }
  });

  marblePegs.push({ x: trackWidth / 2 - narrowHalf, y: narrowY2, r: MB_BUMPER_R + 3 });
  marblePegs.push({ x: trackWidth / 2 + narrowHalf, y: narrowY2, r: MB_BUMPER_R + 3 });
}

function syncMarbleViewport({ preserveState = false } = {}) {
  const canvas  = document.getElementById('marbleCanvas');
  const minimap = document.getElementById('marbleMinimap');
  const wrap    = document.getElementById('marble-track-wrap');
  const layout  = document.getElementById('marble-layout');
  if (!canvas || !wrap || !minimap) return null;

  const prevTrackW = mbTrackW;
  const prevScrollTop = wrap.scrollTop;
  const nextTrackW = Math.max(wrap.clientWidth - 2, 280);
  const nextMinimapH = layout ? Math.max(layout.clientHeight - 2, 200) : 400;

  mbTrackW = nextTrackW;
  canvas.width = nextTrackW;
  canvas.height = MB_TRACK_H;
  minimap.width = MINIMAP_W;
  minimap.height = nextMinimapH;

  if (preserveState && prevTrackW > 0 && prevTrackW !== nextTrackW) {
    const scaleX = nextTrackW / prevTrackW;
    marbleBalls.forEach(ball => {
      ball.x *= scaleX;
      ball.vx *= scaleX;
    });
  }

  rebuildMarbleCourseGeometry(nextTrackW);

  if (preserveState) {
    wrap.scrollTop = Math.min(prevScrollTop, Math.max(0, wrap.scrollHeight - wrap.clientHeight));
    drawMarbleTrack(canvas);
    drawMinimap(minimap, wrap);
    renderMarbleRanking(marbleFinished ? marbleExitOrder[marbleExitOrder.length - 1] : null);
  } else {
    wrap.scrollTop = 0;
  }

  return { canvas, minimap, wrap };
}

function handleMarbleResize() {
  if (activeMainTab !== 'marble') return;
  if (marbleResizeTimer) clearTimeout(marbleResizeTimer);
  marbleResizeTimer = setTimeout(() => {
    marbleResizeTimer = null;
    if (activeMainTab !== 'marble') return;
    if (marbleRunning || marbleFinished || marbleBalls.length) {
      syncMarbleViewport({ preserveState: true });
      return;
    }
    initMarble();
  }, 80);
}

function initMarble() {
  marbleItems     = buildMarbleItems();
  marbleExitOrder = [];
  marbleRunning   = false;
  marbleFinished  = false;
  marbleBalls     = [];
  marblePegs      = [];
  marbleBumpers   = [];
  marbleRotators  = [];
  if (marbleAnimId) { cancelAnimationFrame(marbleAnimId); marbleAnimId = null; }

  const viewport = syncMarbleViewport();
  if (!viewport) return;
  const { canvas, minimap, wrap } = viewport;


  // 회전 구조물은 NARROW 범퍼 끝점 쪽에 고정
  // NARROW 범퍼 선분을 따라 보이지 않는 peg를 추가해 관통을 방지
  // NARROW 범퍼 하단 끝점 + 보강용 peg
  document.getElementById('marble-result').textContent    = '';
  document.getElementById('marble-start-btn').disabled    = false;
  document.getElementById('marble-start-btn').textContent = '출발!';
  document.getElementById('marble-skip-btn').disabled     = true;
  renderMarbleCountList();
  renderMarbleRanking();

  if (!marbleItems.length) {
    drawMarbleTrack(canvas);
    drawMinimap(minimap, wrap);
    return;
  }

  const padding = MB_MARBLE_R * 4;
  marbleItems.forEach((item, i) => {
    const t = marbleItems.length > 1 ? i / (marbleItems.length - 1) : 0.5;
    const x = padding + t * (mbTrackW - padding * 2) + (Math.random() - 0.5) * 6;
    const y = 30 + Math.random() * 20;
    marbleBalls.push({
      menu      : item.menu,
      label     : item.label,
      countIndex: item.countIndex,
      color     : MARBLE_COLORS[i % MARBLE_COLORS.length],
      x, y,
      vx        : (Math.random() - 0.5) * 1.2,
      vy        : Math.random() * 0.5,
      r         : MB_MARBLE_R,
      exited    : false,
      _stuckTick: 0,
      _prevY    : y,
    });
  });

  drawMarbleTrack(canvas);
  drawMinimap(minimap, wrap);
  renderMarbleRanking();
}

// 메인 마블 코스 캔버스를 그린다.
function drawMarbleTrack(canvas) {
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;

  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, W, H);

  // 구역 배경
  MB_ZONES.forEach(z => {
    ctx.fillStyle = z.bg;
    ctx.fillRect(0, z.y1, W, z.y2 - z.y1);
  });

  // 구역 구분선 + 라벨
  ctx.font = '9px monospace';
  MB_ZONES.forEach((z, i) => {
    ctx.fillStyle  = 'rgba(255,255,255,0.14)';
    ctx.textAlign  = 'left';
    ctx.fillText(z.label, 6, z.y1 + 12);
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 7]);
      ctx.beginPath(); ctx.moveTo(0, z.y1); ctx.lineTo(W, z.y1); ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // 좌우 벽
  ctx.strokeStyle = '#2a2a32';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 1, 0); ctx.lineTo(W - 1, H); ctx.stroke();

  // FINISH 라인
  const exitY = H - 60;
  ctx.strokeStyle = '#ff6b35';
  ctx.lineWidth   = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(0, exitY); ctx.lineTo(W, exitY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle  = '#ff6b35';
  ctx.font       = '11px Pretendard, sans-serif';
  ctx.textAlign  = 'center';
  ctx.fillText('FINISH', W / 2, exitY - 6);

  // 범퍼
  ctx.lineCap = 'round';
  marbleBumpers.forEach(seg => {
    ctx.lineWidth   = 12;
    ctx.strokeStyle = seg.color;
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth   = 7;
    ctx.strokeStyle = seg.color;
    ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke();
    ctx.lineWidth   = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke();
  });
  ctx.lineCap = 'butt';

  // 회전 구조물
  marbleRotators.forEach(rot => {
    for (let i = 0; i < (rot.arms || 2); i++) {
      const a  = rot.angle + i * Math.PI;
      const x2 = rot.cx + Math.cos(a) * rot.armLen;
      const y2 = rot.cy + Math.sin(a) * rot.armLen;
      ctx.lineCap    = 'round';
      ctx.lineWidth  = rot.armR * 2 + 6;
      ctx.strokeStyle = 'rgba(255,179,71,0.2)';
      ctx.beginPath(); ctx.moveTo(rot.cx, rot.cy); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineWidth   = rot.armR * 2;
      ctx.strokeStyle = '#ffb347';
      ctx.beginPath(); ctx.moveTo(rot.cx, rot.cy); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.beginPath();
    ctx.arc(rot.cx, rot.cy, 7, 0, Math.PI * 2);
    ctx.fillStyle   = '#ffb347';
    ctx.fill();
    ctx.strokeStyle = '#0d0d0f';
    ctx.lineWidth   = 2;
    ctx.stroke();
  });

  // 핀
  marblePegs.forEach(p => {
    if (p.hidden) return;
    const g = ctx.createRadialGradient(p.x - 1.5, p.y - 1.5, 0.5, p.x, p.y, p.r);
    g.addColorStop(0, '#6a6a80');
    g.addColorStop(1, '#2a2a35');
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  });

  if (!marbleItems.length) {
    ctx.fillStyle = '#555';
    ctx.font      = '13px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('선택 가능한 메뉴가 없습니다', W / 2, 80);
    return;
  }

  // 이탈 순서 (상단)
  if (marbleExitOrder.length > 0) {
    ctx.fillStyle = '#555';
    ctx.font      = '10px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    const names = marbleExitOrder.map((b, idx) =>
      idx === marbleExitOrder.length - 1 && marbleFinished
        ? '[우승] ' + b.label : b.label
    ).join(' > ');
    ctx.fillText(names, 8, 14);
  }

  // 구슬
  marbleBalls.forEach(b => {
    if (b.exited) return;
    ctx.beginPath();
    ctx.arc(b.x, b.y + 2, b.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    const grad = ctx.createRadialGradient(
      b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.08, b.x, b.y, b.r
    );
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.3, b.color);
    grad.addColorStop(1, shadeColor(b.color, -60));
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 이름 라벨
    const rawName = b.label;
    const labelText = rawName.length > 5 ? rawName.slice(0, 4) + '..' : rawName;
    ctx.font = 'bold 8px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(labelText).width;
    const lx = b.x;
    const ly = b.y - b.r - 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(lx - tw / 2 - 2, ly - 9, tw + 4, 9);
    ctx.fillStyle = '#fff';
    ctx.fillText(labelText, lx, ly);
    ctx.textBaseline = 'alphabetic';
  });
}

// 전체 코스를 축소해 보여주는 미니맵을 그린다.
function drawMinimap(minimap, wrap) {
  if (!minimap) return;
  const mCtx  = minimap.getContext('2d');
  const mW    = minimap.width;
  const mH    = minimap.height;
  const scaleX = (mW - MINIMAP_BORDER * 2) / mbTrackW;
  const scaleY = (mH - MINIMAP_BORDER * 2) / MB_TRACK_H;
  const offX   = MINIMAP_BORDER;
  const offY   = MINIMAP_BORDER;

  mCtx.fillStyle = '#0d0d0f';
  mCtx.fillRect(0, 0, mW, mH);
  mCtx.fillStyle = '#141416';
  mCtx.fillRect(offX, offY, mW - MINIMAP_BORDER * 2, mH - MINIMAP_BORDER * 2);

  // 범퍼 (미니맵)
  mCtx.lineCap = 'round';
  marbleBumpers.forEach(seg => {
    mCtx.strokeStyle = seg.color;
    mCtx.lineWidth   = 2;
    mCtx.globalAlpha = 0.6;
    mCtx.beginPath();
    mCtx.moveTo(offX + seg.x1 * scaleX, offY + seg.y1 * scaleY);
    mCtx.lineTo(offX + seg.x2 * scaleX, offY + seg.y2 * scaleY);
    mCtx.stroke();
    mCtx.globalAlpha = 1;
  });
  mCtx.lineCap = 'butt';

  // 핀
  mCtx.fillStyle = '#3a3a4a';
  marblePegs.forEach(p => {
    mCtx.beginPath();
    mCtx.arc(offX + p.x * scaleX, offY + p.y * scaleY, 1, 0, Math.PI * 2);
    mCtx.fill();
  });

  // FINISH 라인
  const exitMY = offY + (MB_TRACK_H - 60) * scaleY;
  mCtx.strokeStyle = 'rgba(255,107,53,0.5)';
  mCtx.lineWidth   = 1;
  mCtx.beginPath();
  mCtx.moveTo(offX, exitMY); mCtx.lineTo(mW - MINIMAP_BORDER, exitMY);
  mCtx.stroke();

  // 구슬
  marbleBalls.forEach(b => {
    if (b.exited) return;
    mCtx.beginPath();
    mCtx.arc(offX + b.x * scaleX, offY + b.y * scaleY, Math.max(2, MB_MARBLE_R * scaleX), 0, Math.PI * 2);
    mCtx.fillStyle = b.color;
    mCtx.fill();
  });

  // 뷰포트 표시
  if (wrap) {
    const vpTop = offY + wrap.scrollTop * scaleY;
    const vpH   = wrap.clientHeight * scaleY;
    mCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    mCtx.lineWidth   = 1;
    mCtx.strokeRect(offX, vpTop, mW - MINIMAP_BORDER * 2, vpH);
  }
}

// 구슬의 중력, 충돌, 이탈 판정을 한 프레임 진행한다.
function physicsStep() {
  const W      = mbTrackW;
  const exitY  = MB_TRACK_H - 60;
  const active = marbleBalls.filter(b => !b.exited);
  const lastRemaining = active.length === 1;

  // 회전 구조물 각도 업데이트
  marbleRotators.forEach(rot => { rot.angle += rot.speed; });

  active.forEach(b => {
    b.vy += MB_GRAVITY;
    b.vx *= MB_DAMPING;
    b.vy *= MB_DAMPING;

    // 속도가 너무 작으면 하향 가속 (정체 방지)
    if (Math.hypot(b.vx, b.vy) < 0.8) b.vy += 0.8;

    // 최대 속도 제한 (터널링 방지 보조)
    const MAX_SPD = 14;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > MAX_SPD) {
      b.vx = (b.vx / speed) * MAX_SPD;
      b.vy = (b.vy / speed) * MAX_SPD;
    }

    // 하단 좁은 구간(y>2800)에서는 서브스텝으로 관통 방지
    const SUBSTEPS = b.y > 2800 ? 5 : 1;
    for (let _sub = 0; _sub < SUBSTEPS; _sub++) {
      b.x += b.vx / SUBSTEPS;
      b.y += b.vy / SUBSTEPS;

      // 충돌 해결: 벽 처리, 접촉 수집, 끼임 감지 순으로 적용

      // 1. 좌우 벽 충돌을 먼저 처리한다.
      if (b.x - b.r < 1) {
        b.x = 1 + b.r;
        b.vx = Math.abs(b.vx) * MB_RESTITUTION;
      } else if (b.x + b.r > W - 1) {
        b.x = W - 1 - b.r;
        b.vx = -Math.abs(b.vx) * MB_RESTITUTION;
      }

      // 2. 모든 장애물 접촉 수집
      const contacts = [];

      marbleBumpers.forEach(seg => {
        const { dist, cx, cy } = pointSegClosest(b.x, b.y, seg.x1, seg.y1, seg.x2, seg.y2);
        const minD = b.r + MB_BUMPER_R;
        if (dist < minD && dist > 0) {
          contacts.push({
            nx: (b.x - cx) / dist, ny: (b.y - cy) / dist,
            depth: minD - dist, cx, cy, minD, type: 'bumper'
          });
        }
      });

      marbleRotators.forEach(rot => {
        for (let i = 0; i < (rot.arms || 2); i++) {
          const a = rot.angle + i * (Math.PI * 2 / (rot.arms || 2));
          const x2 = rot.cx + Math.cos(a) * rot.armLen;
          const y2 = rot.cy + Math.sin(a) * rot.armLen;
          const { dist, cx, cy } = pointSegClosest(b.x, b.y, rot.cx, rot.cy, x2, y2);
          const minD = b.r + rot.armR;
          if (dist < minD && dist > 0) {
            const armDist = Math.hypot(cx - rot.cx, cy - rot.cy);
            contacts.push({
              nx: (b.x - cx) / dist, ny: (b.y - cy) / dist,
              depth: minD - dist, cx, cy, minD, type: 'rotator',
              rot, armDist
            });
          }
        }
      });

      marblePegs.forEach(p => {
        const dx = b.x - p.x, dy = b.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = b.r + p.r;
        if (dist < minD && dist > 0) {
          contacts.push({
            nx: dx / dist, ny: dy / dist,
            depth: minD - dist, cx: p.x, cy: p.y, minD, type: 'peg'
          });
        }
      });

      // 3. 끼임 감지: 서로 반대 방향으로 미는 접촉이 있는지 확인
      let wedged = false;
      outer: for (let i = 0; i < contacts.length; i++) {
        for (let j = i + 1; j < contacts.length; j++) {
          const dot = contacts[i].nx * contacts[j].nx + contacts[i].ny * contacts[j].ny;
          if (dot < -0.2) { wedged = true; break outer; }
        }
      }

      contacts.sort((a, c) => c.depth - a.depth);
      if (wedged) {
        // 끼였으면 각 접촉면 바깥으로 위치를 보정하고 튕겨낸다
        contacts.forEach(c => {
          b.x = c.cx + c.nx * (c.minD + 1);
          b.y = c.cy + c.ny * (c.minD + 1);
        });
        b.vy = -(Math.abs(b.vy) + 5);           // 현재 중력을 뒤집고 추가 상향 속도 부여
        b.vx += (Math.random() - 0.5) * 4;      // 좌우로 흩뜨려 무한 끼임 방지
        b._stuckTick = 0;
      } else {
        // 정상 충돌 해결
        contacts.forEach(c => {
          if (c.type === 'rotator') {
            const tanX = -c.ny * c.rot.speed * c.armDist * 12;
            const tanY =  c.nx * c.rot.speed * c.armDist * 12;
            const relDot = (b.vx - tanX) * c.nx + (b.vy - tanY) * c.ny;
            if (relDot < 0) {
              // 법선 성분만 반전하고 회전 접선 속도를 일부 전달
              b.vx -= (1 + MB_RESTITUTION) * relDot * c.nx;
              b.vy -= (1 + MB_RESTITUTION) * relDot * c.ny;
              b.vx += tanX * 0.3;
              b.vy += tanY * 0.3;
            }
          } else {
            const dot = b.vx * c.nx + b.vy * c.ny;
            if (dot < 0) {
              // 법선 성분만 반전해 자연스럽게 튕기게 한다
              b.vx -= (1 + MB_RESTITUTION) * dot * c.nx;
              b.vy -= (1 + MB_RESTITUTION) * dot * c.ny;
            }
          }
          b.x = c.cx + c.nx * (c.minD + 0.2);
          b.y = c.cy + c.ny * (c.minD + 0.2);
        });
      }

      // 4. 최종 벽 재보정
      if (b.x - b.r < 1)     b.x = 1 + b.r;
      if (b.x + b.r > W - 1) b.x = W - 1 - b.r;
    } // end SUBSTEPS

    // 움직임 감지 및 탈출 로직
    const _dy = b.y - b._prevY;
    b._prevY  = b.y;
    if (Math.abs(_dy) < 0.2) {
      b._stuckTick++;
    } else {
      b._stuckTick = Math.max(0, b._stuckTick - 1);
    }

    if (b._stuckTick > 20) {
      b.vx += (Math.random() - 0.5) * 4;
      b.vy += 2;
      if (b.y > MB_LAST_STRETCH_Y) b.vy += 2.5;
      if (b._stuckTick > 60) {
        b.y += b.y > MB_LAST_STRETCH_Y ? 12 : 5;
        b._stuckTick = 0;
      }
    }

    if (lastRemaining && b.y > MB_LAST_ONE_WIN_Y && b._stuckTick > 12) {
      b.exited = true;
      marbleExitOrder.push(b);
      return;
    }

    if (b.y > exitY) {
      b.exited = true;
      marbleExitOrder.push(b);
    }
  });

  // 5+6. 구슬 간 충돌과 장애물 보정을 3회 반복
  for (let iter = 0; iter < 3; iter++) {
    // 구슬 간 충돌
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = a.r + b.r;
        if (dist < minD && dist > 0) {
          const nx = dx / dist;
          const ny = dy / dist;
          const ov = (minD - dist) / 2;
          a.x -= nx * ov; a.y -= ny * ov;
          b.x += nx * ov; b.y += ny * ov;
          // 첫 번째 반복에서만 속도 교환, 이후에는 위치만 보정
          if (iter === 0) {
            const v1n = a.vx * nx + a.vy * ny;
            const v2n = b.vx * nx + b.vy * ny;
            if (v2n - v1n < 0) {
              const common = (v2n - v1n) * MB_RESTITUTION;
              a.vx += common * nx; a.vy += common * ny;
              b.vx -= common * nx; b.vy -= common * ny;
            }
          }
        }
      }
    }

    // 장애물 보정: 위치와 속도를 함께 보정
    active.forEach(b => {
      if (b.exited) return;

      marbleBumpers.forEach(seg => {
        const { dist, cx, cy } = pointSegClosest(b.x, b.y, seg.x1, seg.y1, seg.x2, seg.y2);
        const minD = b.r + MB_BUMPER_R;
        if (dist < minD && dist > 0) {
          const nx = (b.x - cx) / dist, ny = (b.y - cy) / dist;
          b.x = cx + nx * (minD + 0.2);
          b.y = cy + ny * (minD + 0.2);
          const vDot = b.vx * nx + b.vy * ny;
          if (vDot < 0) { b.vx -= vDot * nx; b.vy -= vDot * ny; }
        }
      });

      marbleRotators.forEach(rot => {
        for (let i = 0; i < (rot.arms || 2); i++) {
          const a = rot.angle + i * (Math.PI * 2 / (rot.arms || 2));
          const x2 = rot.cx + Math.cos(a) * rot.armLen;
          const y2 = rot.cy + Math.sin(a) * rot.armLen;
          const { dist, cx, cy } = pointSegClosest(b.x, b.y, rot.cx, rot.cy, x2, y2);
          const minD = b.r + rot.armR;
          if (dist < minD && dist > 0) {
            const nx = (b.x - cx) / dist, ny = (b.y - cy) / dist;
            b.x = cx + nx * (minD + 0.2);
            b.y = cy + ny * (minD + 0.2);
            const vDot = b.vx * nx + b.vy * ny;
            if (vDot < 0) { b.vx -= vDot * nx; b.vy -= vDot * ny; }
          }
        }
      });

      marblePegs.forEach(p => {
        const dx = b.x - p.x, dy = b.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = b.r + p.r;
        if (dist < minD && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          b.x = p.x + nx * (minD + 0.2);
          b.y = p.y + ny * (minD + 0.2);
          const vDot = b.vx * nx + b.vy * ny;
          if (vDot < 0) { b.vx -= vDot * nx; b.vy -= vDot * ny; }
        }
      });

      if (b.x - b.r < 1)     b.x = 1 + b.r;
      if (b.x + b.r > W - 1) b.x = W - 1 - b.r;
    });
  }
}

// 가장 아래까지 내려간 구슬을 기준으로 스크롤을 맞춘다.
function autoScrollToLast() {
  const wrap = document.getElementById('marble-track-wrap');
  if (!wrap) return;
  const active = marbleBalls.filter(b => !b.exited);
  if (!active.length) return;
  const last   = active.reduce((a, b) => b.y > a.y ? b : a);
  wrap.scrollTop = Math.max(0, last.y - wrap.clientHeight * 0.45);
}

function getMarbleRankingList(finalWinner = null) {
  const active = marbleBalls
    .filter(b => !b.exited)
    .slice()
    .sort((a, b) => b.y - a.y);

  const exited = marbleExitOrder
    .slice()
    .reverse()
    .filter(b => !finalWinner || b !== finalWinner);

  if (finalWinner) {
    return [finalWinner, ...exited];
  }

  return [...active, ...exited];
}

function renderMarbleRanking(finalWinner = null) {
  const rankingEl = document.getElementById('marble-ranking');
  if (!rankingEl) return;

  const ranking = getMarbleRankingList(finalWinner);
  if (!ranking.length) {
    rankingEl.innerHTML = '';
    return;
  }

  rankingEl.innerHTML = `
    <div class="marble-ranking-list">
      ${ranking.slice(0, 5).map((ball, index) => `
        <div class="marble-ranking-item">
          <span class="marble-ranking-name">${escapeHtml(ball.label || ball.menu.name)}</span>
          <span class="marble-ranking-state">${finalWinner ? (index === 0 ? '우승' : '종료') : (ball.exited ? '탈락' : '진행중')}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function finalizeMarbleWinner(winner) {
  if (!winner) return;

  marbleRunning  = false;
  marbleFinished = true;
  if (marbleAnimId) {
    cancelAnimationFrame(marbleAnimId);
    marbleAnimId = null;
  }

  document.getElementById('marble-result').textContent    = winner.menu.name + ' 우승!';
  document.getElementById('marble-start-btn').disabled    = false;
  document.getElementById('marble-start-btn').textContent = '다시 하기';
  document.getElementById('marble-skip-btn').disabled     = true;
  renderMarbleRanking(winner);
  window.api.recordPick(winner.menu.name).then(() => loadHistory());
}

// 마블 시뮬레이션 애니메이션을 시작한다.
function startMarble() {
  if (marbleFinished) { initMarble(); return; }
  if (marbleRunning) return;
  if (!marbleItems.length) { showToast('선택 가능한 메뉴가 없어요.', true); return; }

  marbleRunning = true;
  document.getElementById('marble-start-btn').disabled = true;
  document.getElementById('marble-skip-btn').disabled  = false;

  const canvas  = document.getElementById('marbleCanvas');
  const minimap = document.getElementById('marbleMinimap');
  const wrap    = document.getElementById('marble-track-wrap');

  function frame() {
    physicsStep();
    // autoScrollToLast();
    drawMarbleTrack(canvas);
    drawMinimap(minimap, wrap);
    renderMarbleRanking();

    const remaining = marbleBalls.filter(b => !b.exited);
    if (remaining.length === 1) {
      finalizeMarbleWinner(remaining[0]);
      return;
    }

    if (remaining.length === 0) {
      finalizeMarbleWinner(marbleExitOrder[marbleExitOrder.length - 1]);
      return;
    }
    marbleAnimId = requestAnimationFrame(frame);
  }
  marbleAnimId = requestAnimationFrame(frame);
}

// 남은 구슬을 임의 순서로 종료 처리해 결과만 빠르게 확정한다.
function skipMarble() {
  if (!marbleRunning) return;
  cancelAnimationFrame(marbleAnimId);

  marbleBalls.filter(b => !b.exited)
    .sort(() => Math.random() - 0.5)
    .forEach(b => { b.exited = true; marbleExitOrder.push(b); });

  marbleRunning  = false;
  marbleFinished = true;

  const canvas  = document.getElementById('marbleCanvas');
  const minimap = document.getElementById('marbleMinimap');
  const wrap    = document.getElementById('marble-track-wrap');
  drawMarbleTrack(canvas);
  drawMinimap(minimap, wrap);
  renderMarbleRanking();

  finalizeMarbleWinner(marbleExitOrder[marbleExitOrder.length - 1]);
}

// 초기화
syncLocationConsentUI();
loadKakaoMapConfig();
loadAll();

