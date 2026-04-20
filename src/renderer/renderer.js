let menus     = [];
let history   = [];
let weights   = {};   // { menuId: number }
let editingId = null;
let favOnly   = false;
const selectedCats = new Set(['한식','중식','일식','양식','분식','기타']);
let kakaoMapConfig = null;
let kakaoMapScriptPromise = null;
let kakaoMapInstance = null;
let kakaoMapMarker = null;
let kakaoPlaceMarkers = [];
let kakaoPlaceInfoWindow = null;

// ── 탭 전환 ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
    window.api.resizeForTab(tab.dataset.tab);
    if (tab.dataset.tab === 'wheel') setTimeout(() => { renderWeightList(); drawWheel(wheelAngle); }, 40);
    if (tab.dataset.tab === 'marble') setTimeout(() => initMarble(), 40);
  });
});

document.getElementById('new-name').addEventListener('keydown', e => { if (e.key === 'Enter') addMenu(); });
document.getElementById('wheel-new-name').addEventListener('keydown', e => { if (e.key === 'Enter') addMenuFromWheel(); });
document.getElementById('map-search-keyword').addEventListener('keydown', e => { if (e.key === 'Enter') searchPlacesOnMap(); });

// ── 카테고리 필터 ──
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

// ── 패널 탭 전환 ──
function showPanel(name) {
  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
  document.querySelector(`.ptab[onclick="showPanel('${name}')"]`).classList.add('active');
  document.getElementById(name === 'history' ? 'history-list' : 'stats-content').classList.add('active');
}

// ── 데이터 로드 ──
async function loadAll() { await loadMenus(); await loadHistory(); }

async function loadKakaoMapConfig() {
  if (!window.api.getKakaoMapConfig) return;
  kakaoMapConfig = await window.api.getKakaoMapConfig();
}

async function loadMenus() {
  menus = await window.api.getMenus();
  menus.forEach(m => { if (weights[m.id] === undefined) weights[m.id] = 1; });
  renderMenus();
  updatePickInfo();
  renderWeightList();
  drawWheel(wheelAngle);
  initMarble();
}

// ── 필터 적용된 메뉴 목록 ──
function getCooldownDays() { return parseInt(document.getElementById('cooldown-select').value) || 0; }

function getRecentlyPickedNames() {
  const days = getCooldownDays();
  if (!days) return new Set();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  return new Set(history.filter(h => new Date(h.picked_at) >= cutoff).map(h => h.menu_name));
}

function getFilteredMenus() {
  let list = menus.filter(m => !m.excluded);
  if (favOnly) list = list.filter(m => m.favorite);
  if (selectedCats.size < 6) list = list.filter(m => selectedCats.has(m.category));
  const recent = getRecentlyPickedNames();
  if (recent.size) list = list.filter(m => !recent.has(m.name));
  return list;
}

function renderMenus() {
  const list = document.getElementById('pick-menu-list');
  if (!menus.length) { list.innerHTML = '<div class="empty-state">등록된 메뉴가 없습니다.<br>아래에서 추가하세요!</div>'; return; }
  list.innerHTML = menus.map(m => `
    <div class="menu-item ${m.excluded ? 'excluded' : ''}">
      <span class="cat-badge">${m.category}</span>
      <span class="menu-name">${m.name}</span>
      ${m.excluded ? '<span class="excluded-tag">제외됨</span>' : ''}
      <button class="icon-btn fav-btn ${m.favorite ? 'active' : ''}" onclick="toggleFavorite(${m.id})" title="즐겨찾기">${m.favorite ? '★' : '☆'}</button>
      <button class="icon-btn exclude-btn" onclick="toggleExclude(${m.id})" title="${m.excluded ? '포함' : '제외'}">${m.excluded ? '✓' : '⊘'}</button>
      <button class="icon-btn" onclick="openEdit(${m.id})">✎</button>
      <button class="icon-btn danger" onclick="deleteMenu(${m.id})">✕</button>
    </div>`).join('');
}

function updatePickInfo() {
  const filtered = getFilteredMenus();
  const total    = menus.filter(m => !m.excluded).length;
  const parts = [];
  if (favOnly) parts.push('★즐겨찾기');
  if (selectedCats.size < 6) parts.push([...selectedCats].join('/'));
  const cooldown = getCooldownDays();
  if (cooldown) parts.push(`쿨다운${cooldown}일`);
  const filterStr = parts.length ? ` (${parts.join(', ')})` : '';
  document.getElementById('pick-info').textContent =
    `선택 가능: ${filtered.length}개 / 전체 ${total}개${filterStr}`;
}

// ── 가중치 (돌림판 전용 — 제외 여부만 반영) ──
function getActiveItems() {
  return menus
    .filter(m => !m.excluded)
    .map(m => ({ ...m, weight: Math.max(1, weights[m.id] || 1) }));
}
function totalWeight(items) { return items.reduce((s, m) => s + m.weight, 0); }

function renderWeightList() {
  const list   = document.getElementById('weight-list');
  const active = getActiveItems();
  const total  = totalWeight(active);

  if (!menus.length) { list.innerHTML = '<div class="empty-state">메뉴가 없습니다</div>'; return; }

  list.innerHTML = menus.map(m => {
    const w   = weights[m.id] || 1;
    const exc = !!m.excluded;
    const pct = exc ? 0 : (total > 0 ? Math.round((w / total) * 100) : 0);
    return `
      <div class="weight-item ${exc ? 'excluded' : ''}">
        <span class="weight-pct">${pct}%</span>
        <span class="weight-name" title="${m.name}">${m.name}</span>
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

function adjustWeight(id, delta) {
  weights[id] = Math.min(99, Math.max(1, (weights[id] || 1) + delta));
  renderWeightList();
  drawWheel(wheelAngle);
}

function setWeight(id, val) {
  const n = parseInt(val);
  if (isNaN(n) || n < 1) return;
  weights[id] = Math.min(99, n);
  renderWeightList();
  drawWheel(wheelAngle);
}

function resetWeights() {
  menus.forEach(m => { weights[m.id] = 1; });
  renderWeightList();
  drawWheel(wheelAngle);
  showToast('가중치 초기화 완료');
}

// ── 메뉴 CRUD ──
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
  await window.api.deleteMenu(id);
  await loadMenus();
  showToast(`"${menu.name}" 삭제됨`);
}

async function toggleExclude(id) { await window.api.toggleExclude(id); await loadMenus(); }

async function toggleFavorite(id) { await window.api.toggleFavorite(id); await loadMenus(); }

function openEdit(id) {
  editingId = id;
  const menu = menus.find(m => m.id === id);
  document.getElementById('edit-name').value     = menu.name;
  document.getElementById('edit-category').value = menu.category;
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('edit-name').focus(), 100);
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('show'); editingId = null; }

async function saveEdit() {
  const name     = document.getElementById('edit-name').value.trim();
  const category = document.getElementById('edit-category').value;
  if (!name) return;
  const res = await window.api.updateMenu({ id: editingId, name, category });
  if (res.success) { closeModal(); await loadMenus(); showToast('수정 완료'); }
  else showToast(res.error, true);
}

document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

// ── 랜덤 뽑기 ──
async function pickRandom() {
  const filtered = getFilteredMenus();
  if (!filtered.length) { showToast('선택 가능한 메뉴가 없어요!', true); return; }
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
  }, 1000);
}

// ── 히스토리 ──
async function loadHistory() {
  history = await window.api.getHistory();
  const list = document.getElementById('history-list');
  if (!history.length) { list.innerHTML = '<div class="empty-state">아직 기록이 없습니다</div>'; }
  else {
    list.innerHTML = history.map(h => {
      const d = new Date(h.picked_at);
      const t = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      return `<div class="history-item"><span class="history-name">${h.menu_name}</span><span class="history-time">${t}</span></div>`;
    }).join('');
  }
  renderStats();
  updatePickInfo();
}

async function clearHistory() { await window.api.clearHistory(); await loadHistory(); showToast('기록 삭제 완료'); }

// ── 통계 ──
function renderStats() {
  const el = document.getElementById('stats-content');
  if (!history.length) { el.innerHTML = '<div class="stat-empty">아직 기록이 없습니다</div>'; return; }

  // 메뉴별 횟수
  const counts = {};
  history.forEach(h => { counts[h.menu_name] = (counts[h.menu_name] || 0) + 1; });
  const top5   = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCnt = top5[0][1];

  // 카테고리별 횟수
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
        <span class="stat-name">${name}</span>
        <div class="stat-bar-wrap"><div class="stat-bar" style="width:${Math.round(cnt/maxCnt*100)}%"></div></div>
        <span class="stat-count">${cnt}회</span>
      </div>`).join('')}
    <div class="stats-section-title" style="margin-top:6px">선호 카테고리</div>
    <div class="stat-item">
      <span class="stat-rank">1</span>
      <span class="stat-name">${topCat[0]}</span>
      <div class="stat-bar-wrap"><div class="stat-bar" style="width:100%"></div></div>
      <span class="stat-count">${topCat[1]}회</span>
    </div>
  `;
}

// ── Toast ──
let toastTimer;
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function setMapStatus(message, isError = false) {
  const status = document.getElementById('map-status');
  status.textContent = message;
  status.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function showMapPanel() {
  document.getElementById('map-test-panel').classList.add('show');
}

function hideMapPanel() {
  document.getElementById('map-test-panel').classList.remove('show');
}

function renderMapSearchResults(places = []) {
  const container = document.getElementById('map-search-results');
  if (!places.length) {
    container.innerHTML = '<div class="map-search-empty">검색 결과가 없습니다.</div>';
    return;
  }

  container.innerHTML = places.map((place, index) => `
    <div class="map-place-item" onclick="focusPlaceMarker(${index})">
      <div class="map-place-title">${place.name}</div>
      <div class="map-place-meta">${place.category || '카테고리 없음'}${place.distance ? ` · ${place.distance}m` : ''}</div>
      <div class="map-place-address">${place.address || '주소 정보 없음'}</div>
    </div>
  `).join('');
}

function clearPlaceMarkers() {
  kakaoPlaceMarkers.forEach(entry => entry.marker.setMap(null));
  kakaoPlaceMarkers = [];
  kakaoPlaceInfoWindow?.close();
}

function openPlaceInfo(place, marker) {
  if (!window.kakao?.maps || !kakaoMapInstance) return;
  if (!kakaoPlaceInfoWindow) kakaoPlaceInfoWindow = new window.kakao.maps.InfoWindow({ removable: true });

  const content = `
    <div style="padding:10px 12px; min-width:220px; color:#111; line-height:1.5;">
      <div style="font-weight:700; margin-bottom:4px;">${place.name}</div>
      <div style="font-size:12px; color:#555;">${place.category || ''}</div>
      <div style="font-size:12px; color:#333; margin-top:6px;">${place.address || ''}</div>
      ${place.distance ? `<div style="font-size:12px; color:#ff6b35; margin-top:6px;">현재 중심에서 ${place.distance}m</div>` : ''}
      ${place.url ? `<div style="margin-top:8px;"><a href="${place.url}" target="_blank" style="font-size:12px; color:#0068c3; text-decoration:none;">카카오맵에서 보기</a></div>` : ''}
    </div>
  `;

  kakaoPlaceInfoWindow.setContent(content);
  kakaoPlaceInfoWindow.open(kakaoMapInstance, marker);
}

function focusPlaceMarker(index) {
  const entry = kakaoPlaceMarkers[index];
  if (!entry || !kakaoMapInstance) return;

  kakaoMapInstance.panTo(entry.position);
  openPlaceInfo(entry.place, entry.marker);
}

function updateMapStatusWithCenter(lat, lng, extra = '') {
  const prefix = `위도 ${lat.toFixed(6)} / 경도 ${lng.toFixed(6)}`;
  document.getElementById('current-location-meta').textContent = extra ? `${prefix} · ${extra}` : prefix;
}

function getCurrentPosition() {
  return fetch('https://ipapi.co/json/')
    .then(r => r.json())
    .then(data => {
      if (!data.latitude) throw new Error('IP 위치 조회 실패');
      return { coords: { latitude: data.latitude, longitude: data.longitude, accuracy: 5000 } };
    });
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('브라우저 위치 정보를 사용할 수 없습니다.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

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

async function getPreferredCurrentPosition() {
  try {
    const position = await getBrowserPosition();
    return { ...position, source: 'geolocation' };
  } catch (error) {
    console.warn('[Location] geolocation failed, falling back to IP lookup:', error);
    return getIpBasedPosition();
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
      cleanup(new Error('Kakao 지도 SDK 로드 시간 초과. 앱 키와 등록 도메인(http://localhost:3000)을 확인하세요.'));
    }, 10000);

    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.onload = () => {
      window.kakao.maps.load(() => { clearTimeout(timer); resolve(window.kakao.maps); });
    };
    script.onerror = (e) => {
      clearTimeout(timer);
      console.error('[Kakao SDK] 스크립트 로드 실패:', e);
      cleanup(new Error('Kakao 지도 SDK를 불러오지 못했습니다. 앱 키와 등록 도메인을 확인하세요.'));
    };
    document.head.appendChild(script);
  });

  return kakaoMapScriptPromise;
}

async function testCurrentLocationMap() {
  showMapPanel();
  const appKey = (kakaoMapConfig?.jsKey || '').trim();

  if (!appKey) {
    setMapStatus('Kakao JavaScript 키를 먼저 입력해 주세요.', true);
    showToast('Kakao JavaScript 키가 필요합니다.', true);
    return;
  }

  try {
    setMapStatus('현재 위치와 Kakao 지도를 불러오는 중입니다...');
    const [maps, position] = await Promise.all([
      loadKakaoMapSdk(appKey),
      getPreferredCurrentPosition(),
    ]);

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
    const sourceLabel = position.source === 'ip' ? 'IP 기반 대략 위치' : '현재 위치';
    locationMeta.textContent = `위도 ${lat.toFixed(6)} / 경도 ${lng.toFixed(6)} · ${sourceLabel}`;
    clearPlaceMarkers();
    renderMapSearchResults([]);
    setMapStatus(position.source === 'ip'
      ? '정확한 현재 위치를 가져오지 못해 IP 기반 대략 위치로 지도를 불러왔습니다.'
      : '현재 위치 기반 지도를 불러왔습니다.');
    showToast(position.source === 'ip'
      ? 'IP 기반 대략 위치로 지도를 불러왔습니다.'
      : '현재 위치 지도를 불러왔습니다.');
  } catch (error) {
    setMapStatus(error.message || '현재 위치 지도를 불러오지 못했습니다.', true);
    showToast(error.message || '현재 위치 지도를 불러오지 못했습니다.', true);
  }
}

async function searchPlacesOnMap() {
  showMapPanel();
  const keyword = document.getElementById('map-search-keyword').value.trim();

  if (!keyword) {
    setMapStatus('검색어를 먼저 입력해 주세요.', true);
    showToast('검색어를 입력해 주세요.', true);
    return;
  }

  try {
    if (!kakaoMapInstance) {
      await testCurrentLocationMap();
      if (!kakaoMapInstance) return;
    }

    const center = kakaoMapInstance.getCenter();
    setMapStatus(`"${keyword}" 검색 중입니다...`);

    const result = await window.api.searchPlaces({
      query: keyword,
      x: center.getLng(),
      y: center.getLat(),
      radius: 3000,
      size: 10,
    });

    if (!result?.success) {
      throw new Error(result?.error || '장소 검색에 실패했습니다.');
    }

    clearPlaceMarkers();
    renderMapSearchResults(result.places || []);

    if (!result.places?.length) {
      updateMapStatusWithCenter(center.getLat(), center.getLng(), `"${keyword}" 결과 없음`);
      setMapStatus(`"${keyword}" 검색 결과가 없습니다.`, true);
      return;
    }

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
    updateMapStatusWithCenter(center.getLat(), center.getLng(), `"${keyword}" ${result.places.length}건`);
    setMapStatus(`"${keyword}" 검색 결과 ${result.places.length}건을 표시했습니다.`);
    showToast(`"${keyword}" 검색 결과를 표시했습니다.`);
  } catch (error) {
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
      if (label.length > 5) label = label.slice(0, 5) + '…';
      ctx.fillText(label, r - 10, 4);
      ctx.restore();
    }
    cur = e;
  });

  // 중앙 원
  ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#0d0d0f'; ctx.fill();
  ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 2; ctx.stroke();
}

function spinWheel() {
  const items = getActiveItems();
  if (!items.length) { showToast('선택 가능한 메뉴가 없어요!', true); return; }
  if (wheelSpinning) return;
  wheelSpinning = true;

  const btn = document.getElementById('wheel-btn');
  const resultBox = document.getElementById('wheel-result');
  btn.disabled = true; resultBox.textContent = '';

  // 가중치 기반 랜덤 선택
  const total = totalWeight(items);
  let rand = Math.random() * total, targetIdx = items.length - 1;
  for (let i = 0; i < items.length; i++) { rand -= items[i].weight; if (rand <= 0) { targetIdx = i; break; } }

  // 목표 조각 중앙 각도
  let sliceStart = 0;
  for (let i = 0; i < targetIdx; i++) sliceStart += (items[i].weight / total) * Math.PI * 2;
  const sliceAngle = (items[targetIdx].weight / total) * Math.PI * 2;
  const sliceMid   = sliceStart + sliceAngle / 2;

  // 포인터(-π/2)가 sliceMid를 가리키도록 역산
  const targetAngle = -Math.PI / 2 - sliceMid;
  const extraSpins  = Math.PI * 2 * (6 + Math.floor(Math.random() * 4));
  const finalAngle  = targetAngle - extraSpins;

  const duration   = 4200 + Math.random() * 1200;
  const startAngle = wheelAngle;
  const startTime  = performance.now();

  function easeOut(t) { return 1 - Math.pow(1 - t, 3.5); }

  function animate(now) {
    const t = Math.min((now - startTime) / duration, 1);
    wheelAngle = startAngle + (finalAngle - startAngle) * easeOut(t);
    drawWheel(wheelAngle);
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      wheelAngle = finalAngle;
      wheelSpinning = false;
      btn.disabled = false;
      resultBox.textContent = `🎉 ${items[targetIdx].name}!`;
      window.api.recordPick(items[targetIdx].name).then(() => loadHistory());
    }
  }
  requestAnimationFrame(animate);
}

// ── 마블 룰렛 (Dynamic Plinko — 5구역) ──────────────────────────────
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

function generatePegs(W) {
  marblePegs = [];
  const m  = MB_MARBLE_R * 3 + MB_PEG_R;
  const uW = W - m * 2;

  // Zone 1 ENTRY — 표준 플링코 7행
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

  // Zone 3 MID — 지그재그 (좌우 교대 통로)
  const MID_Y0   = 1500;
  const MID_ROWS = 7;
  const MID_DY   = 130;
  const PASS_W   = W * 0.25; // 통과 구멍 폭

  for (let row = 0; row < MID_ROWS; row++) {
    const y = MID_Y0 + row * MID_DY;
    // 짝수 행: 오른쪽에 구멍 / 홀수 행: 왼쪽에 구멍
    const passOnRight = row % 2 === 0;
    const passX0 = passOnRight ? W - m - PASS_W : m;
    const passX1 = passOnRight ? W - m           : m + PASS_W;

    const step = MB_PEG_R * 2 + 14;
    for (let x = m; x <= W - m; x += step) {
      if (x + MB_PEG_R > passX0 && x - MB_PEG_R < passX1) continue;
      marblePegs.push({ x, y, r: MB_PEG_R });
    }
  }

  // Zone 5 EXIT — 표준 플링코 7행
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

function generateBumpers(W) {
  marbleBumpers = [];

  // Zone 2 SLALOM — 좌우 교번 대각선 범퍼 4개 (경사 강화: 수직 낙하 시 자연스럽게 튕기도록)
  marbleBumpers.push(
    { x1: 1,     y1:  762, x2: W * 0.46, y2:  882, color: '#9b5de5' },
    { x1: W - 1, y1:  942, x2: W * 0.54, y2: 1062, color: '#9b5de5' },
    { x1: 1,     y1: 1122, x2: W * 0.46, y2: 1242, color: '#9b5de5' },
    { x1: W - 1, y1: 1302, x2: W * 0.54, y2: 1422, color: '#9b5de5' },
  );

  // Zone 6 NARROW — 최하단 좁은 도착 통로 (벽에 완전히 붙임)
  const nY1 = 3010, nY2 = 3138;
  const nHalf = 55;
  marbleBumpers.push(
    { x1: 1,     y1: nY1, x2: W / 2 - nHalf, y2: nY2, color: '#ff6b35' },
    { x1: W - 1, y1: nY1, x2: W / 2 + nHalf, y2: nY2, color: '#ff6b35' },
  );
}

function initMarble() {
  marbleItems     = menus.filter(m => !m.excluded);
  marbleExitOrder = [];
  marbleRunning   = false;
  marbleFinished  = false;
  marbleBalls     = [];
  marblePegs      = [];
  marbleBumpers   = [];
  marbleRotators  = [];
  if (marbleAnimId) { cancelAnimationFrame(marbleAnimId); marbleAnimId = null; }

  const canvas  = document.getElementById('marbleCanvas');
  const minimap = document.getElementById('marbleMinimap');
  const wrap    = document.getElementById('marble-track-wrap');
  const layout  = document.getElementById('marble-layout');
  if (!canvas || !wrap) return;

  mbTrackW      = Math.max(wrap.clientWidth - 2, 280);
  canvas.width  = mbTrackW;
  canvas.height = MB_TRACK_H;

  const mmH = layout ? Math.max(layout.clientHeight - 2, 200) : 400;
  minimap.width  = MINIMAP_W;
  minimap.height = mmH;

  wrap.scrollTop = 0;

  generatePegs(mbTrackW);
  generateBumpers(mbTrackW);

  // 회전 구조물: 왼쪽 NARROW 범퍼 끝점에 피벗 고정
  marbleRotators = [
    { cx: mbTrackW / 2 - 55, cy: 3138, armLen: 88, angle: 0, speed: -0.022, armR: 6, arms: 2 },
  ];

  // NARROW 범퍼 선분을 따라 밀집 peg — 구슬이 범퍼를 관통하지 못하도록 물리적 봉인
  const _nY1 = 3010, _nY2 = 3138, _nHalf = 55;
  [
    [1,             _nY1, mbTrackW / 2 - _nHalf, _nY2],
    [mbTrackW - 1,  _nY1, mbTrackW / 2 + _nHalf, _nY2],
  ].forEach(([x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const step = (MB_MARBLE_R + MB_BUMPER_R) * 1.4;
    for (let d = step * 0.5; d < len; d += step) {
      const t = d / len;
      marblePegs.push({ x: x1 + t * dx, y: y1 + t * dy, r: MB_BUMPER_R + 1, hidden: true });
    }
  });
  // NARROW 범퍼 하단 끝점 + 피벗 봉인 peg
  marblePegs.push({ x: mbTrackW / 2 - _nHalf, y: _nY2, r: MB_BUMPER_R + 3 });
  marblePegs.push({ x: mbTrackW / 2 + _nHalf, y: _nY2, r: MB_BUMPER_R + 3 });

  document.getElementById('marble-result').textContent    = '';
  document.getElementById('marble-start-btn').disabled    = false;
  document.getElementById('marble-start-btn').textContent = '출 발 !';
  document.getElementById('marble-skip-btn').disabled     = true;

  if (!marbleItems.length) {
    drawMarbleTrack(canvas);
    drawMinimap(minimap, wrap);
    return;
  }

  const padding = MB_MARBLE_R * 4;
  marbleItems.forEach((m, i) => {
    const t = marbleItems.length > 1 ? i / (marbleItems.length - 1) : 0.5;
    const x = padding + t * (mbTrackW - padding * 2) + (Math.random() - 0.5) * 6;
    const y = 30 + Math.random() * 20;
    marbleBalls.push({
      menu      : m,
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
}

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

  // 구역 구분선 + 레이블
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

  // 탈락 순서 (상단)
  if (marbleExitOrder.length > 0) {
    ctx.fillStyle = '#555';
    ctx.font      = '10px Pretendard, sans-serif';
    ctx.textAlign = 'left';
    const names = marbleExitOrder.map((b, idx) =>
      idx === marbleExitOrder.length - 1 && marbleFinished
        ? '[당첨] ' + b.menu.name : b.menu.name
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

    // 이름 레이블
    const rawName = b.menu.name;
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

function physicsStep() {
  const W      = mbTrackW;
  const exitY  = MB_TRACK_H - 60;
  const active = marbleBalls.filter(b => !b.exited);

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

    // 하단 좁은 구간(y>2800) 서브스텝: 회전 장애물↔고정 범퍼 터널링 방지
    const SUBSTEPS = b.y > 2800 ? 5 : 1;
    for (let _sub = 0; _sub < SUBSTEPS; _sub++) {
      b.x += b.vx / SUBSTEPS;
      b.y += b.vy / SUBSTEPS;

      // ── 충돌 해결: 제약 수집 → 쐐기 감지 → 단일 적용 ──

      // 1. 좌우 벽 충돌 (먼저 처리)
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

      // 3. 쐐기 감지: 서로 반대 방향으로 미는 접촉 쌍 존재 여부 확인
      let wedged = false;
      outer: for (let i = 0; i < contacts.length; i++) {
        for (let j = i + 1; j < contacts.length; j++) {
          const dot = contacts[i].nx * contacts[j].nx + contacts[i].ny * contacts[j].ny;
          if (dot < -0.2) { wedged = true; break outer; }
        }
      }

      contacts.sort((a, c) => c.depth - a.depth);
      if (wedged) {
        // 쐐기: 각 접촉면 표면으로 위치 보정 후 위로 튕겨냄
        contacts.forEach(c => {
          b.x = c.cx + c.nx * (c.minD + 1);
          b.y = c.cy + c.ny * (c.minD + 1);
        });
        b.vy = -(Math.abs(b.vy) + 5);           // 현재 속력 반전 + 추가 상향 속도
        b.vx += (Math.random() - 0.5) * 4;      // 좌우 랜덤 분산 (무한 재끼임 방지)
        b._stuckTick = 0;
      } else {
        // 정상 충돌 해결
        contacts.forEach(c => {
          if (c.type === 'rotator') {
            const tanX = -c.ny * c.rot.speed * c.armDist * 12;
            const tanY =  c.nx * c.rot.speed * c.armDist * 12;
            const relDot = (b.vx - tanX) * c.nx + (b.vy - tanY) * c.ny;
            if (relDot < 0) {
              // 법선 성분만 반전(접선 보존) + 회전 팔 속도 전달
              b.vx -= (1 + MB_RESTITUTION) * relDot * c.nx;
              b.vy -= (1 + MB_RESTITUTION) * relDot * c.ny;
              b.vx += tanX * 0.3;
              b.vy += tanY * 0.3;
            }
          } else {
            const dot = b.vx * c.nx + b.vy * c.ny;
            if (dot < 0) {
              // 법선 성분만 반전, 접선 성분 보존 → 자연스러운 바운스
              b.vx -= (1 + MB_RESTITUTION) * dot * c.nx;
              b.vy -= (1 + MB_RESTITUTION) * dot * c.ny;
            }
          }
          b.x = c.cx + c.nx * (c.minD + 0.2);
          b.y = c.cy + c.ny * (c.minD + 0.2);
        });
      }

      // 4. 최종 벽 클램프
      if (b.x - b.r < 1)     b.x = 1 + b.r;
      if (b.x + b.r > W - 1) b.x = W - 1 - b.r;
    } // end SUBSTEPS

    // 끼임 감지 및 탈출 로직
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
      if (b._stuckTick > 60) {
        b.y += 5;
        b._stuckTick = 0;
      }
    }

    if (b.y > exitY) {
      b.exited = true;
      marbleExitOrder.push(b);
    }
  });

  // 5+6. 공-공 충돌 ↔ 장애물 보정을 3회 교차 반복 (다중 구슬 연쇄 관통 방지)
  for (let iter = 0; iter < 3; iter++) {
    // 공-공 충돌
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
          // 첫 번째 반복에서만 속도 교환 (이후는 위치 보정만)
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

    // 장애물 보정 — 위치 + 속도 동시 보정 (장애물 쪽으로 향하는 속도 성분 제거)
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
function autoScrollToLast() {
  const wrap = document.getElementById('marble-track-wrap');
  if (!wrap) return;
  const active = marbleBalls.filter(b => !b.exited);
  if (!active.length) return;
  const last   = active.reduce((a, b) => b.y > a.y ? b : a);
  wrap.scrollTop = Math.max(0, last.y - wrap.clientHeight * 0.45);
}

function startMarble() {
  if (marbleFinished) { initMarble(); return; }
  if (marbleRunning) return;
  if (!marbleItems.length) { showToast('선택 가능한 메뉴가 없어요!', true); return; }

  marbleRunning = true;
  document.getElementById('marble-start-btn').disabled = true;
  document.getElementById('marble-skip-btn').disabled  = false;

  const canvas  = document.getElementById('marbleCanvas');
  const minimap = document.getElementById('marbleMinimap');
  const wrap    = document.getElementById('marble-track-wrap');

  function frame() {
    physicsStep();
    drawMarbleTrack(canvas);
    drawMinimap(minimap, wrap);

    if (marbleBalls.filter(b => !b.exited).length === 0) {
      marbleRunning  = false;
      marbleFinished = true;
      const winner = marbleExitOrder[marbleExitOrder.length - 1];
      document.getElementById('marble-result').textContent    = winner.menu.name + ' 당첨!';
      document.getElementById('marble-start-btn').disabled    = false;
      document.getElementById('marble-start-btn').textContent = '다시 하기';
      document.getElementById('marble-skip-btn').disabled     = true;
      window.api.recordPick(winner.menu.name).then(() => loadHistory());
      return;
    }
    marbleAnimId = requestAnimationFrame(frame);
  }
  marbleAnimId = requestAnimationFrame(frame);
}

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

  const winner = marbleExitOrder[marbleExitOrder.length - 1];
  document.getElementById('marble-result').textContent    = winner.menu.name + ' 당첨!';
  document.getElementById('marble-start-btn').disabled    = false;
  document.getElementById('marble-start-btn').textContent = '다시 하기';
  document.getElementById('marble-skip-btn').disabled     = true;
  window.api.recordPick(winner.menu.name).then(() => loadHistory());
}

// ── Init ──
loadKakaoMapConfig();
loadAll();
