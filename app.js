// ==========================================
// 1. 状態管理変数
// ==========================================
let currentLat = 35.4535;
let currentLng = 139.6345;
let prevLat = null;
let prevLng = null;
let currentHeading = 0;
let isHeadingUp = true;
let isPitch3D = true;
let autoFollow = true;
let watchId = null;
let isGpsActive = false;
let isRouteActive = false;
let isNorenOpen = false;
let isMajorRoadPriority = true; // 大通り優先（狭路回避）ON
let activeDestName = "";
let wakeLock = null;

// 時間帯に応じた自動ダーク地図判定（17:30〜翌5:30は夜間省電力ダークモード）
const initialHour = new Date().getHours();
let isDarkMap = initialHour >= 18 || initialHour < 6;

const MAP_STYLES = {
  day: "https://tiles.openfreemap.org/styles/positron",
  night: "https://tiles.openfreemap.org/styles/dark"
};

// 気象＆テレメトリーデータ
let realTempC = 16;
let realWindMs = 3.2;
let realPrecipMm = 0;
let currentSpeedKmh = 0;
let totalDistanceKm = 0;
let maxSpeedKmh = 0;
let maxLeanLeft = 0;
let maxLeanRight = 0;
let rideStartTime = Date.now();
let lastWeatherFetch = 0;
let lastRestAlertMin = 0;

// ルート座標キャッシュ（地図スタイル切替時の再描画用）
let currentRouteGeoJson = null;

// ==========================================
// 2. 右上メニュー開閉＆SOS長押し安全ロック
// ==========================================
let isMenuOpen = false;
let sosHoldTimer = null;

function toggleMapMenu(forceState = null) {
  isMenuOpen = forceState !== null ? forceState : !isMenuOpen;
  const drawer = document.getElementById("mapMenuDrawer");
  const btn = document.getElementById("menuToggleBtn");
  drawer.classList.toggle("open", isMenuOpen);
  btn.classList.toggle("open", isMenuOpen);
  btn.textContent = isMenuOpen ? "✕ 閉じる" : "⚙️ メニュー";
}

function startSosHold() {
  const btn = document.getElementById("sosHoldBtn");
  btn.classList.add("holding");
  btn.textContent = "⏳ そのまま長押し...";
  sosHoldTimer = setTimeout(() => {
    cancelSosHold();
    toggleMapMenu(false);
    openSosModal();
  }, 1500);
}

function cancelSosHold() {
  if (sosHoldTimer) {
    clearTimeout(sosHoldTimer);
    sosHoldTimer = null;
  }
  const btn = document.getElementById("sosHoldBtn");
  if (btn) {
    btn.classList.remove("holding");
    btn.textContent = "🆘 緊急SOS (長押し)";
  }
}

// ==========================================
// 3. ゲーム風チュートリアルモード
// ==========================================
let tutStep = 0;
const tutorialMissions = [
  {
    badge: "MISSION 1 / 4",
    avatar: "🎧",
    sub: "STEP 1: VOICE & INTERCOM",
    title: "インカム音声ガイダンス起動",
    desc: "このナビは面倒なAPIキー登録や会員登録は一切不要です！まずはスマホの音声案内をオンにして、先導ライダーの声をテストしましょう。",
    apiTag: "使用API: Web Speech API（登録不要・無料）",
    btnText: "🔊 音声テストを実行して次へ ▶"
  },
  {
    badge: "MISSION 2 / 4",
    avatar: "🛰️",
    sub: "STEP 2: GPS & LIVE WEATHER",
    title: "GPS現在地 ＆ リアル天気リンク",
    desc: "下のボタンを押すとスマホの「位置情報の許可」が出ます。「許可」を押すと、現在地の速度・方位と、Open-Meteo気象APIからのリアル気温・体感温度が自動で繋がります！",
    apiTag: "使用API: Geolocation API ＋ Open-Meteo気象API（無料）",
    btnText: "📡 GPSと気象データを接続する ▶"
  },
  {
    badge: "MISSION 3 / 4",
    avatar: "📐",
    sub: "STEP 3: LEAN ANGLE SENSOR",
    title: "バンク角（リーンアングル）計測起動",
    desc: "コーナリング中のバイクの傾き（左右バンク角）を計測するジャイロセンサーを起動します。iPhoneの場合は「動作と方向へのアクセス」で許可を押してください。",
    apiTag: "使用API: DeviceOrientation API（スマホ内蔵センサー）",
    btnText: "📐 バンク角センサーを有効化する ▶"
  },
  {
    badge: "MISSION 4 / 4",
    avatar: "🏁",
    sub: "FINAL MISSION: ROUTE SIMULATION",
    title: "先読みルート検索を体験して完了！",
    desc: "最後に、無料地図API（OSRM）を使って「江ノ島」までの実戦ルートと「2つ先の信号で右折」の先読み車線ガイドをテストしてチュートリアル完了です！",
    apiTag: "使用API: Nominatim ＆ OSRM ルートAPI（無料）",
    btnText: "🚀 サンプルルートを検索して出発する！"
  }
];

function openTutorial(stepIdx = 0) {
  tutStep = stepIdx;
  renderTutorialStep();
  document.getElementById("tutorialOverlay").classList.add("open");
}

function closeTutorial() {
  document.getElementById("tutorialOverlay").classList.remove("open");
  try { localStorage.setItem("apex_navi_tut_done", "1"); } catch (e) {}
}

function renderTutorialStep() {
  const m = tutorialMissions[tutStep];
  document.getElementById("tutStepBadge").textContent = m.badge;
  document.getElementById("tutAvatar").textContent = m.avatar;
  document.getElementById("tutSub").textContent = m.sub;
  document.getElementById("tutTitle").textContent = m.title;
  document.getElementById("tutDesc").innerHTML = `${m.desc}<br><span class="tut-api-pill">${m.apiTag}</span>`;
  document.getElementById("tutActionBtn").textContent = m.btnText;

  for (let i = 0; i < 4; i++) {
    const bar = document.getElementById(`tutBar${i}`);
    bar.className = "tut-bar" + (i < tutStep ? " done" : i === tutStep ? " current" : "");
  }
}

function runTutorialStep() {
  if (tutStep === 0) {
    speakJapanese("インカム接続完了です。次はGPSと気象データをリンクします。");
    tutStep = 1;
    renderTutorialStep();
  } else if (tutStep === 1) {
    if (!isGpsActive) toggleGPS();
    speakJapanese("GPSと気象データに接続しました。次はバンク角センサーを有効にします。");
    tutStep = 2;
    renderTutorialStep();
  } else if (tutStep === 2) {
    enableGyroSensors();
    speakJapanese("バンク角センサーの準備が整いました。最後にサンプルルートを検索します。");
    tutStep = 3;
    renderTutorialStep();
  } else if (tutStep === 3) {
    closeTutorial();
    document.getElementById("destInput").value = "江ノ島";
    searchAndRoute();
  }
}

// ==========================================
// 4. Googleマップ風ベクター地図（昼＆夜間省電力ダーク切替対応）
// ==========================================
const map = new maplibregl.Map({
  container: "vectorMap",
  style: isDarkMap ? MAP_STYLES.night : MAP_STYLES.day,
  center: [currentLng, currentLat],
  zoom: 15.5,
  pitch: 45,
  bearing: 0,
  attributionControl: false
});

const riderEl = document.createElement("div");
riderEl.className = "rider-pin";
riderEl.textContent = "🏍️";

const riderMarker = new maplibregl.Marker({ element: riderEl })
  .setLngLat([currentLng, currentLat])
  .addTo(map);

let destMarker = null;
let poiMarkers = [];
let generatedSteps = [];
let currentStepIdx = 0;
let trackCoords = [[currentLng, currentLat]];

function setupRouteAndTrackLayers() {
  if (!map.getSource("route-source")) {
    map.addSource("route-source", {
      type: "geojson",
      data: currentRouteGeoJson || { type: "Feature", geometry: { type: "LineString", coordinates: [] } }
    });
  }

  if (!map.getLayer("route-casing")) {
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route-source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": isDarkMap ? "#0d47a1" : "#174ea6",
        "line-width": 12
      }
    });
  }

  if (!map.getLayer("route-line")) {
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route-source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": isDarkMap ? "#38bdf8" : "#4285f4",
        "line-width": 7
      }
    });
  }

  if (!map.getSource("track-source")) {
    map.addSource("track-source", {
      type: "geojson",
      data: { type: "Feature", geometry: { type: "LineString", coordinates: trackCoords } }
    });
  }

  if (!map.getLayer("track-line")) {
    map.addLayer({
      id: "track-line",
      type: "line",
      source: "track-source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#00e676", "line-width": 4, "line-dasharray": [2, 1] }
    });
  }
}

map.on("load", () => {
  setupRouteAndTrackLayers();
  syncThemeButtonsUI();
});

// スタイル切替（昼モード ⇔ 夜間省電力ダークモード）完了時にルート線を再復元
map.on("style.load", () => {
  setupRouteAndTrackLayers();
});

function toggleMapTheme() {
  isDarkMap = !isDarkMap;
  map.setStyle(isDarkMap ? MAP_STYLES.night : MAP_STYLES.day);
  syncThemeButtonsUI();
  const msg = isDarkMap
    ? "夜間・省電力ダーク地図に切り替えました。有機EL画面の消費電力と眩しさを抑えます。"
    : "昼間の高視認ライト地図に切り替えました。";
  document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
  speakJapanese(msg);
}

function syncThemeButtonsUI() {
  const viewport = document.getElementById("mapViewport");
  const menuBtn = document.getElementById("mapThemeBtn");
  const quickBtn = document.getElementById("quickThemeBtn");

  viewport.classList.toggle("night-mode", isDarkMap);
  if (menuBtn) {
    menuBtn.textContent = isDarkMap ? "🌙 地図: 夜間ダーク" : "☀️ 地図: 昼モード";
  }
  if (quickBtn) {
    quickBtn.textContent = isDarkMap ? "☀️ 昼マップへ" : "🌙 夜間ダーク";
    quickBtn.classList.toggle("night-active", isDarkMap);
  }
}

map.on("dragstart", () => {
  autoFollow = false;
  document.getElementById("recenterBtn").classList.add("active");
});

function togglePitchView() {
  isPitch3D = !isPitch3D;
  const btn = document.getElementById("tiltModeBtn");
  btn.textContent = isPitch3D ? "📐 視点: ナビ3D" : "📐 視点: 真上2D";
  map.easeTo({ pitch: isPitch3D ? 45 : 0, duration: 400 });
}

function toggleHeadingUp() {
  isHeadingUp = !isHeadingUp;
  const btn = document.getElementById("headingModeBtn");
  btn.textContent = isHeadingUp ? "🧭 ヘディングUP" : "🧭 ノースUP";
  btn.classList.toggle("active", isHeadingUp);
  map.easeTo({ bearing: isHeadingUp ? currentHeading : 0, duration: 400 });
}

function recenterMap() {
  autoFollow = true;
  document.getElementById("recenterBtn").classList.remove("active");
  toggleMapMenu(false);
  map.easeTo({
    center: [currentLng, currentLat],
    zoom: 16,
    bearing: isHeadingUp ? currentHeading : 0,
    pitch: isPitch3D ? 45 : 0,
    duration: 500
  });
}

// ==========================================
// 5. 大通り優先（狭路回避）ルートオプション
// ==========================================
function toggleMajorRoadMode() {
  isMajorRoadPriority = !isMajorRoadPriority;
  const btn = document.getElementById("majorRoadBtn");
  btn.classList.toggle("active", isMajorRoadPriority);
  btn.textContent = isMajorRoadPriority ? "🛣️ 大通り優先" : "🛣️ 標準最短";

  if (!isRouteActive) {
    document.getElementById("signalLabel").textContent = isMajorRoadPriority
      ? "📍 フリー走行モード（大通り優先・狭路回避ON）"
      : "📍 フリー走行モード（標準最短ルート設定）";
  }

  const msg = isMajorRoadPriority
    ? "大通り優先モードをオンにしました。細い生活道路を避けて幹線道路を優先します。"
    : "標準の最短ルートモードに切り替えました。";
  document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
  speakJapanese(msg);

  // すでに目的地が入力されていれば即座にルートを再計算
  if (isRouteActive && document.getElementById("destInput").value.trim()) {
    searchAndRoute();
  }
}

// 複数候補ルートから「大通り（幹線道路）の比率が最も高いルート」を選抜するアルゴリズム
function pickBestRouteForRider(routes) {
  if (!routes || routes.length === 0) return null;
  if (!isMajorRoadPriority || routes.length === 1) return routes[0];

  let bestRoute = routes[0];
  let bestMajorScore = -1;

  routes.forEach((r) => {
    let majorDistance = 0;
    let totalDistance = Math.max(1, r.distance);

    if (r.legs && r.legs[0] && r.legs[0].steps) {
      r.legs[0].steps.forEach((st) => {
        const ref = st.ref || "";
        const name = st.name || "";
        // 国道・県道番号(ref)がある道路や「〜通り」「〜街道」「バイパス」は幹線道路として高く評価
        const isMajor =
          ref.length > 0 ||
          /(国道|県道|都道|府道|道道|バイパス|街道|大通り|幹線|環状)/.test(name);
        if (isMajor) {
          majorDistance += st.distance;
        }
      });
    }

    const majorRatio = majorDistance / totalDistance;
    if (majorRatio > bestMajorScore) {
      bestMajorScore = majorRatio;
      bestRoute = r;
    }
  });

  return bestRoute;
}

// ==========================================
// 6. 気象API＆走行風体感温度計算
// ==========================================
async function fetchRealWeather(lat, lng, placeName = null) {
  const now = Date.now();
  if (!placeName && now - lastWeatherFetch < 60000) return;
  lastWeatherFetch = now;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&wind_speed_unit=ms&timezone=Asia%2FTokyo`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.current) {
      realTempC = Math.round(data.current.temperature_2m);
      realWindMs = Number(data.current.wind_speed_10m.toFixed(1));
      realPrecipMm = data.current.precipitation;
      const elev = data.elevation ? ` (標高${Math.round(data.elevation)}m)` : "";
      const label = placeName ? `${placeName}${elev}` : `現在地${elev}`;
      document.getElementById("weatherSpot").textContent = label;
      updateWeatherUI();
    }
  } catch (e) {
    console.warn("気象取得スキップ:", e);
  }
}

function calcRiderWindChill(tempC, speedKmh, windMs) {
  const effectiveSpeedKmh = Math.max(speedKmh, windMs * 3.6);
  if (effectiveSpeedKmh < 5) return Math.round(tempC);
  const vPow = Math.pow(effectiveSpeedKmh, 0.16);
  return Math.round(13.12 + 0.6215 * tempC - 11.37 * vPow + 0.3965 * tempC * vPow);
}

function updateWeatherUI() {
  const chill = calcRiderWindChill(realTempC, currentSpeedKmh, realWindMs);
  const wBar = document.getElementById("weatherBar");
  const chillBadge = document.getElementById("chillBadge");
  const riskTag = document.getElementById("roadRiskTag");

  const weatherIcon = realPrecipMm > 0 ? "🌧️" : realTempC <= 8 ? "🌥️" : "☀️";
  document.getElementById("weatherTemp").textContent = `${weatherIcon} ${realTempC}℃`;
  chillBadge.textContent = `体感 ${chill}℃`;

  if (chill <= 5) {
    wBar.classList.add("alert-cold");
    chillBadge.classList.add("danger");
  } else {
    wBar.classList.remove("alert-cold");
    chillBadge.classList.remove("danger");
  }

  if (realTempC <= 2 && realPrecipMm > 0) {
    riskTag.textContent = `❄️ 路面凍結警戒！気温${realTempC}℃ / 風速${realWindMs}m/s`;
    riskTag.className = "road-risk-tag danger";
  } else if (realPrecipMm > 0) {
    riskTag.textContent = `☔ ウェット路面注意 (${realPrecipMm}mm) / 風速${realWindMs}m/s`;
    riskTag.className = "road-risk-tag warn";
  } else if (realWindMs >= 7.0) {
    riskTag.textContent = `🌬️ 強風・横風注意！風速 ${realWindMs}m/s`;
    riskTag.className = "road-risk-tag warn";
  } else {
    riskTag.textContent = `🛣️ 路面状態: ドライ良好 / 風速 ${realWindMs}m/s`;
    riskTag.className = "road-risk-tag";
  }
}

// ==========================================
// 7. ルート検索＆暖簾（プルダウン）式・案内一覧
// ==========================================
function setNorenOpen(openState) {
  isNorenOpen = openState;
  const wrap = document.getElementById("guidanceDropdownWrap");
  const pill = document.getElementById("listHintPill");
  wrap.classList.toggle("open", isNorenOpen);
  if (pill && pill.style.display !== "none") {
    pill.textContent = isNorenOpen ? "📋 閉じる ▴" : "📋 一覧 ▾";
  }
}

function toggleRouteDropdown() {
  if (isNorenOpen) {
    setNorenOpen(false);
    return;
  }

  if (!isRouteActive || generatedSteps.length === 0) {
    generatedSteps = demoScenarios;
    currentStepIdx = 0;
  }

  renderNorenList();
  setNorenOpen(true);
}

function renderNorenList() {
  const subEl = document.getElementById("routeListSub");
  const modeTag = isMajorRoadPriority ? "【大通り優先】" : "【標準最短】";
  if (activeDestName) {
    subEl.textContent = `${modeTag}「${activeDestName}」までの案内全${generatedSteps.length}件（タップで移動・再タップで収納）`;
  } else {
    subEl.textContent = "先読みシナリオ一覧（タップで切替・上のカード再タップで収納）";
  }

  const container = document.getElementById("routeStepsContainer");
  container.innerHTML = generatedSteps.map((st, idx) => {
    const isCurrent = idx === currentStepIdx && isRouteActive;
    const isWarn = st.cardClass === "highlight-amber";
    return `
      <div class="step-row ${isCurrent ? "current" : ""} ${isWarn ? "warn-row" : ""}" onclick="jumpToRouteStep(${idx})">
        <div class="step-turn-badge">${st.icon || "↑"}</div>
        <div class="step-body">
          <div class="step-top-line">
            <span class="step-num-tag">${isCurrent ? "● 現在案内中 / " : ""}STEP ${idx + 1} ・ ${st.signalText}</span>
            <span class="step-dist-tag">${st.dist}</span>
          </div>
          <div class="step-main-text">${st.headline}</div>
          <div class="step-sub-advice">🎧 ${st.voice}</div>
        </div>
      </div>
    `;
  }).join("");
}

function jumpToRouteStep(idx) {
  setNorenOpen(false);
  currentStepIdx = idx;
  activateNavModeUI();
  applyGeneratedStep(idx, true);

  const st = generatedSteps[idx];
  if (st && st.location) {
    autoFollow = false;
    document.getElementById("recenterBtn").classList.add("active");
    map.easeTo({
      center: st.location,
      zoom: 16.5,
      pitch: 45,
      duration: 600
    });
  }
}

function resetToStandbyMode() {
  setNorenOpen(false);
  isRouteActive = false;
  activeDestName = "";
  generatedSteps = [];
  currentStepIdx = 0;
  currentRouteGeoJson = { type: "Feature", geometry: { type: "LineString", coordinates: [] } };

  if (map.getSource("route-source")) {
    map.getSource("route-source").setData(currentRouteGeoJson);
  }
  if (destMarker) {
    destMarker.remove();
    destMarker = null;
  }

  const card = document.getElementById("guidanceCard");
  card.className = "guidance-card standby";
  document.getElementById("listHintPill").style.display = "none";
  document.getElementById("signalLabel").textContent = isMajorRoadPriority
    ? "📍 フリー走行モード（大通り優先・狭路回避ON）"
    : "📍 フリー走行モード（標準最短ルート設定）";
  document.getElementById("signalDots").innerHTML = "";
  document.getElementById("distTag").textContent = "STANDBY";
  document.getElementById("actionHeadline").textContent = "上の検索欄から目的地を入力して出発";
  document.getElementById("laneGuide").innerHTML =
    `<div class="lane-box standby-msg">GPSと気象・バンク角のリアルタイム監視はそのまま利用できます</div>`;

  const toast = document.getElementById("intercomToast");
  toast.classList.remove("active-nav");
  document.getElementById("voiceSubtitle").textContent = "目的地を検索するか、GPSを開始するとインカム音声案内が有効になります。";

  const mainBtn = document.getElementById("mainNextBtn");
  mainBtn.classList.remove("primary");
  mainBtn.classList.add("standby-btn");
  document.getElementById("mainNextLabel").textContent = "🔍 目的地を入力";
  document.getElementById("mainNextSub").textContent = "案内待機中";

  const goBtn = document.getElementById("routeActionBtn");
  goBtn.textContent = "検索";
  goBtn.classList.remove("cancel-mode");
  goBtn.onclick = searchAndRoute;

  document.querySelectorAll(".chip-btn").forEach(b => {
    if (b.id !== "quickThemeBtn") b.classList.remove("active");
  });
}

async function searchAndRoute() {
  setNorenOpen(false);
  const query = document.getElementById("destInput").value.trim();
  if (!query) {
    document.getElementById("destInput").focus();
    return;
  }

  const policyLabel = isMajorRoadPriority ? "大通り優先で" : "";
  speakJapanese(`${query}まで${policyLabel}ツーリングルートを検索します。`);
  document.getElementById("actionHeadline").textContent = `「${query}」へ${policyLabel}計算中...`;

  try {
    const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=ja`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (!geoData || geoData.length === 0) {
      alert("目的地が見つかりませんでした。別の地名や施設名をお試しください。");
      resetToStandbyMode();
      return;
    }

    const destLat = parseFloat(geoData[0].lat);
    const destLng = parseFloat(geoData[0].lon);
    const destName = geoData[0].display_name.split(",")[0];
    activeDestName = destName;

    await fetchRealWeather(destLat, destLng, `${destName} 到着予報`);

    // 原付二種(125cc)モード時は自動車専用道・高速道路を除外
    const excludeParam = bikeClassIdx === 2 ? "&exclude=motorway" : "";
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${currentLng},${currentLat};${destLng},${destLat}?overview=full&geometries=geojson&steps=true&alternatives=true${excludeParam}`;
    const routeRes = await fetch(osrmUrl);
    const routeData = await routeRes.json();

    if (!routeData.routes || routeData.routes.length === 0) {
      alert("ルートを計算できませんでした。");
      resetToStandbyMode();
      return;
    }

    const route = pickBestRouteForRider(routeData.routes);
    currentRouteGeoJson = {
      type: "Feature",
      geometry: route.geometry
    };

    if (map.getSource("route-source")) {
      map.getSource("route-source").setData(currentRouteGeoJson);
    }

    if (destMarker) destMarker.remove();
    destMarker = new maplibregl.Marker({ color: "#ea4335" })
      .setLngLat([destLng, destLat])
      .setPopup(new maplibregl.Popup().setHTML(`<b>🏁 ${destName}</b>`))
      .addTo(map)
      .togglePopup();

    autoFollow = false;
    document.getElementById("recenterBtn").classList.add("active");
    const coords = route.geometry.coordinates;
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );
    map.fitBounds(bounds, { padding: 50, pitch: 20 });

    const rawSteps = route.legs[0].steps;
    generatedSteps = buildRiderProactiveSteps(rawSteps, destName, route.distance);
    currentStepIdx = 0;
    activateNavModeUI();
    applyGeneratedStep(0, true);

  } catch (err) {
    console.error(err);
    alert("ルート検索中に通信エラーが発生しました。");
    resetToStandbyMode();
  }
}

function activateNavModeUI() {
  isRouteActive = true;
  document.getElementById("intercomToast").classList.add("active-nav");
  const pill = document.getElementById("listHintPill");
  pill.style.display = "inline-block";
  pill.textContent = isNorenOpen ? "📋 閉じる ▴" : "📋 一覧 ▾";

  const mainBtn = document.getElementById("mainNextBtn");
  mainBtn.classList.remove("standby-btn");
  mainBtn.classList.add("primary");
  document.getElementById("mainNextLabel").textContent = "▶ 次の案内へ";
  document.getElementById("mainNextSub").textContent = "音声再生＆進行";

  const goBtn = document.getElementById("routeActionBtn");
  goBtn.textContent = "終了";
  goBtn.classList.add("cancel-mode");
  goBtn.onclick = resetToStandbyMode;
}

function buildRiderProactiveSteps(osrmSteps, destName, totalDistMeters) {
  const steps = [];
  const totalKm = (totalDistMeters / 1000).toFixed(1);

  osrmSteps.forEach((st) => {
    const mod = st.maneuver.modifier || "";
    const type = st.maneuver.type || "";
    const distM = Math.round(st.distance);
    const roadName = st.ref ? `${st.ref} ${st.name || ""}`.trim() : (st.name || "幹線道路");
    const loc = st.maneuver.location || null;

    if (type === "arrive") {
      steps.push({
        icon: "🏁",
        signals: 0,
        signalText: `目的地「${destName}」に到着`,
        dist: "ゴール",
        headline: `${destName} 周辺に到着！駐輪場を確認`,
        cardClass: "highlight-cyan",
        location: loc,
        lanes: [{ text: "↑", state: "" }, { text: "🏁 到着", state: "recommended" }, { text: "↑", state: "" }],
        voice: `まもなく目的地、${destName}周辺に到着します。バイクを停められる場所を探しましょう。お疲れ様でした。`
      });
    } else if (mod.includes("right")) {
      steps.push({
        icon: "↱",
        signals: 2,
        signalText: `2つ先の交差点で右折 (${roadName})`,
        dist: `約 ${Math.max(150, distM)}m先`,
        headline: "今のうちに一番右の車線へ移動",
        cardClass: "highlight-green",
        location: loc,
        lanes: [
          { text: "↑", state: "" },
          { text: "↑", state: "" },
          { text: "↱ 右折", state: "recommended" }
        ],
        voice: `${destName}方面へ、2つ先の信号で${roadName}へ右折します。早めに一番右の車線へ寄っておきましょう。`
      });
    } else if (mod.includes("left")) {
      const isUrban = distM < 600;
      steps.push({
        icon: isUrban ? "⚠️" : "↰",
        signals: isUrban ? 2 : 1,
        signalText: isUrban ? `信号 2つ先で左折 (${roadName}・路駐警戒)` : `次の信号を左折 (${roadName})`,
        dist: `約 ${Math.max(100, distM)}m先`,
        headline: isUrban ? "路駐注意！真ん中キープ後、直前で左へ" : "左車線へ寄って左折準備",
        cardClass: isUrban ? "highlight-amber" : "highlight-green",
        location: loc,
        lanes: isUrban
          ? [{ text: "⚠️ 路駐", state: "parked-warn" }, { text: "↑ キープ", state: "recommended" }, { text: "↑", state: "" }]
          : [{ text: "↰ 左折", state: "recommended" }, { text: "↑", state: "" }, { text: "↑", state: "" }],
        voice: isUrban
          ? `この先、${roadName}へ左折しますが、左車線に路上駐車がある可能性があります。直前の信号まで真ん中を走りましょう。`
          : `次の信号を${roadName}へ左折します。左後方を確認して左車線へ移動してください。`
      });
    }
  });

  if (steps.length === 0) {
    steps.push({
      icon: "↑",
      signals: 0,
      signalText: `${destName}へ案内開始`,
      dist: `総距離 ${totalKm}km`,
      headline: "道なり直進！体感温度と横風に注意",
      cardClass: "highlight-cyan",
      location: null,
      lanes: [{ text: "↑", state: "" }, { text: "↑ 直進", state: "recommended" }, { text: "↑", state: "" }],
      voice: `${destName}まで総距離${totalKm}キロのルートを設定しました。現在の体感温度は${calcRiderWindChill(realTempC, currentSpeedKmh, realWindMs)}度です。安全運転で出発しましょう。`
    });
  }
  return steps;
}

function applyGeneratedStep(idx, speak = true) {
  const st = generatedSteps[idx];
  if (!st) return;

  const card = document.getElementById("guidanceCard");
  card.className = "guidance-card clickable " + st.cardClass;
  document.getElementById("signalLabel").textContent = st.signalText;
  document.getElementById("distTag").textContent = st.dist;
  document.getElementById("actionHeadline").textContent = st.headline;

  const dotsEl = document.getElementById("signalDots");
  dotsEl.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "dot" + (i < st.signals ? " active" : "");
    dotsEl.appendChild(dot);
  }

  document.getElementById("laneGuide").innerHTML = st.lanes.map(l =>
    `<div class="lane-box ${l.state}">${l.text}</div>`
  ).join("");

  document.getElementById("voiceSubtitle").textContent = `「${st.voice}」`;
  if (isNorenOpen) renderNorenList();
  if (speak) speakJapanese(st.voice);
}

// ==========================================
// 8. 周辺スポット検索 (Overpass API)
// ==========================================
async function searchNearbyPOI(type) {
  setNorenOpen(false);
  const labels = { fuel: "ガソリンスタンド", convenience: "コンビニ", toilets: "トイレ・休憩所" };
  const icons = { fuel: "⛽", convenience: "🏪", toilets: "🚻" };
  const tagMap = {
    fuel: `node["amenity"="fuel"](around:3000,${currentLat},${currentLng});`,
    convenience: `node["shop"="convenience"](around:2500,${currentLat},${currentLng});`,
    toilets: `node["amenity"="toilets"](around:3000,${currentLat},${currentLng});`
  };

  speakJapanese(`現在地周辺の${labels[type]}を検索しています。`);

  try {
    const query = `[out:json][timeout:10];(${tagMap[type]});out body 8;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query
    });
    const data = await res.json();

    poiMarkers.forEach(m => m.remove());
    poiMarkers = [];

    if (!data.elements || data.elements.length === 0) {
      speakJapanese(`近くに${labels[type]}が見つかりませんでした。`);
      return;
    }

    data.elements.forEach(el => {
      const name = (el.tags && el.tags.name) ? el.tags.name : labels[type];
      const m = new maplibregl.Marker({ color: "#ffab00" })
        .setLngLat([el.lon, el.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<b>${icons[type]} ${name}</b>`))
        .addTo(map);
      poiMarkers.push(m);
    });

    autoFollow = false;
    document.getElementById("recenterBtn").classList.add("active");
    map.easeTo({ center: [data.elements[0].lon, data.elements[0].lat], zoom: 15 });
    speakJapanese(`近くに${data.elements.length}件の${labels[type]}が見つかりました。地図上にピンを表示しています。`);
  } catch (e) {
    speakJapanese("スポット検索に失敗しました。通信状況を確認してください。");
  }
}

// ==========================================
// 9. GPS・ジャイロ・画面スリープ防止
// ==========================================
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) {}
}

function enableGyroSensors() {
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission().then(state => {
      if (state === "granted") startOrientationListener();
    });
  } else {
    startOrientationListener();
  }
}

function startOrientationListener() {
  window.addEventListener("deviceorientation", (e) => {
    if (e.gamma === null) return;
    const lean = Math.round(e.gamma);
    const absLean = Math.min(60, Math.abs(lean));
    const dir = lean < -2 ? "L" : lean > 2 ? "R" : "";

    if (lean < -2 && absLean > maxLeanLeft) maxLeanLeft = absLean;
    if (lean > 2 && absLean > maxLeanRight) maxLeanRight = absLean;

    document.getElementById("leanVal").textContent = `${dir}${absLean}°`;
    document.getElementById("leanMax").textContent = `MAX L${maxLeanLeft}° / R${maxLeanRight}°`;
  });
}

function toggleGPS() {
  if (!("geolocation" in navigator)) {
    alert("このブラウザはGPSに対応していません。");
    return;
  }

  if (isGpsActive) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    isGpsActive = false;
    document.getElementById("gpsToggleBtn").classList.remove("gps-on");
    document.getElementById("gpsBtnLabel").textContent = "📡 GPS開始";
    document.getElementById("gpsBtnSub").textContent = "気象・追従連動";
    document.getElementById("gpsDot").classList.remove("active");
    document.getElementById("gpsStatusText").textContent = "GPS停止中";
    return;
  }

  requestWakeLock();
  enableGyroSensors();
  document.getElementById("gpsStatusText").textContent = "測位中...";

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      isGpsActive = true;
      const { latitude, longitude, speed, heading, altitude } = pos.coords;

      if (prevLat !== null && prevLng !== null) {
        const dKm = haversineKm(prevLat, prevLng, latitude, longitude);
        if (dKm > 0.003 && dKm < 0.5) {
          totalDistanceKm += dKm;
          trackCoords.push([longitude, latitude]);
          if (map.getSource("track-source")) {
            map.getSource("track-source").setData({
              type: "Feature",
              geometry: { type: "LineString", coordinates: trackCoords }
            });
          }
        }
      }

      if (heading !== null && !isNaN(heading) && speed > 1.2) {
        currentHeading = Math.round(heading);
      } else if (prevLat !== null && (Math.abs(latitude - prevLat) > 0.00003 || Math.abs(longitude - prevLng) > 0.00003)) {
        currentHeading = Math.round(calcBearing(prevLat, prevLng, latitude, longitude));
      }

      prevLat = latitude;
      prevLng = longitude;
      currentLat = latitude;
      currentLng = longitude;

      riderMarker.setLngLat([currentLng, currentLat]);

      if (autoFollow) {
        map.easeTo({
          center: [currentLng, currentLat],
          bearing: isHeadingUp ? currentHeading : 0,
          pitch: isPitch3D ? 45 : 0,
          duration: 450
        });
      }

      const kmh = speed !== null && speed >= 0 ? Math.round(speed * 3.6) : 0;
      currentSpeedKmh = kmh;
      if (kmh > maxSpeedKmh && kmh < 250) maxSpeedKmh = kmh;

      document.getElementById("speedVal").textContent = kmh;
      document.getElementById("speedUnit").textContent = "km/h (GPS)";
      document.getElementById("speedHud").classList.add("live");

      const elapsedMin = Math.floor((Date.now() - rideStartTime) / 60000);
      const hh = String(Math.floor(elapsedMin / 60)).padStart(2, "0");
      const mm = String(elapsedMin % 60).padStart(2, "0");
      document.getElementById("tripSummaryText").textContent = `走行: ${totalDistanceKm.toFixed(1)}km / ${hh}:${mm}`;

      if (elapsedMin >= 60 && elapsedMin - lastRestAlertMin >= 60) {
        lastRestAlertMin = elapsedMin;
        speakJapanese(`連続走行が${elapsedMin}分を超えました。集中力維持のため、次の道の駅やコンビニで休憩しましょう。`);
      }

      const altStr = altitude !== null ? `${Math.round(altitude)}m` : "--m";
      document.getElementById("headingText").textContent = `方位: ${currentHeading}° / 標高: ${altStr}`;

      document.getElementById("gpsToggleBtn").classList.add("gps-on");
      document.getElementById("gpsBtnLabel").textContent = "🛰️ GPS稼働中";
      document.getElementById("gpsBtnSub").textContent = "タップで停止";
      document.getElementById("gpsDot").classList.add("active");
      document.getElementById("gpsStatusText").textContent = "GPS測位OK";

      fetchRealWeather(currentLat, currentLng);
      updateWeatherUI();
    },
    (err) => {
      document.getElementById("gpsStatusText").textContent = "GPS未許可";
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

// ==========================================
// 10. ユーティリティ・デモ・モーダル制御
// ==========================================
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const demoScenarios = [
  {
    icon: "↱",
    signals: 2, signalText: "【デモ】信号 2つ先で右折", dist: "あと 480m",
    headline: "今のうちに一番右の車線へ移動", cardClass: "highlight-green",
    location: null,
    lanes: [{ text: "↑", state: "" }, { text: "↑", state: "" }, { text: "↱ 右折", state: "recommended" }],
    voice: "2つ先の信号を右折します。交通量が多いので、今のうちに一番右の車線へ寄っておきましょう。"
  },
  {
    icon: "⚠️",
    signals: 2, signalText: "【デモ】信号 2つ先で左折 (路駐警戒)", dist: "あと 350m",
    headline: "路駐多発！真ん中車線をキープ", cardClass: "highlight-amber",
    location: null,
    lanes: [{ text: "⚠️ 路駐", state: "parked-warn" }, { text: "↑ キープ", state: "recommended" }, { text: "↑", state: "" }],
    voice: "2つ先の信号を左折しますが、左車線は路上駐車が多いエリアです。直前の信号まで真ん中の車線を走りましょう。"
  },
  {
    icon: "❄️",
    signals: 0, signalText: "【デモ】気象・防寒アラート", dist: "峠エリア予測",
    headline: "山頂は体感氷点下！手前で防寒準備", cardClass: "highlight-cyan",
    location: null,
    lanes: [{ text: "↑", state: "" }, { text: "🏪 2km先", state: "recommended" }, { text: "↑", state: "" }],
    voice: "この先の峠道は走行風による体感温度が氷点下まで下がる予報です。インナーを着込むなら手前のコンビニが最後のチャンスです。"
  }
];

function selectScenario(idx) {
  activeDestName = "";
  generatedSteps = demoScenarios;
  currentStepIdx = idx;
  activateNavModeUI();
  document.querySelectorAll(".chip-btn").forEach(b => {
    if (b.id !== "quickThemeBtn") b.classList.remove("active");
  });
  const btn = document.getElementById(`demoBtn${idx}`);
  if (btn) btn.classList.add("active");
  applyGeneratedStep(idx, true);
}

function triggerNextStep() {
  if (!isRouteActive || generatedSteps.length === 0) {
    const input = document.getElementById("destInput");
    input.focus();
    speakJapanese("目的地を入力して検索を押してください。");
    return;
  }
  currentStepIdx = (currentStepIdx + 1) % generatedSteps.length;
  applyGeneratedStep(currentStepIdx, true);
}

const bikeClasses = ["🏍️ 中型(400cc)", "🏍️ 大型(750cc+)", "🛵 原付二種(125cc)"];
let bikeClassIdx = 0;
function cycleBikeClass() {
  bikeClassIdx = (bikeClassIdx + 1) % bikeClasses.length;
  const label = bikeClasses[bikeClassIdx];
  document.getElementById("bikeClassLabel").textContent = label;
  const msg = bikeClassIdx === 2
    ? "原付二種モードに切り替えました。高速道路と自動車専用道を自動で回避します。"
    : `${label.replace(/^.\s/, "")}モードに設定しました。`;
  document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
  speakJapanese(msg);

  if (isRouteActive && document.getElementById("destInput").value.trim()) {
    searchAndRoute();
  }
}

function openLogModal() {
  const elapsedMin = Math.floor((Date.now() - rideStartTime) / 60000);
  const hh = String(Math.floor(elapsedMin / 60)).padStart(2, "0");
  const mm = String(elapsedMin % 60).padStart(2, "0");
  document.getElementById("statDist").textContent = `${totalDistanceKm.toFixed(1)} km`;
  document.getElementById("statTime").textContent = `${hh}:${mm}`;
  document.getElementById("statMaxSpeed").textContent = `${maxSpeedKmh} km/h`;
  document.getElementById("statMaxLean").textContent = `L${maxLeanLeft}° / R${maxLeanRight}°`;
  document.getElementById("logModal").classList.add("open");
}

function resetTripLog() {
  totalDistanceKm = 0;
  maxSpeedKmh = 0;
  maxLeanLeft = 0;
  maxLeanRight = 0;
  rideStartTime = Date.now();
  trackCoords = [[currentLng, currentLat]];
  if (map.getSource("track-source")) {
    map.getSource("track-source").setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: trackCoords }
    });
  }
  openLogModal();
}

function openSosModal() {
  document.getElementById("sosCoordDesc").textContent =
    `現在地座標: ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}\nGoogleマップのピンリンクをコピーして救援依頼を送れます。`;
  document.getElementById("sosModal").classList.add("open");
}

async function shareEmergencyLocation() {
  const mapsUrl = `https://maps.google.com/?q=${currentLat},${currentLng}`;
  const text = `【バイク緊急SOS】現在地でトラブルが発生しました。位置情報はこちらです: ${mapsUrl}`;
  if (navigator.share) {
    try { await navigator.share({ title: "バイク緊急位置情報", text }); return; } catch (e) {}
  }
  await navigator.clipboard.writeText(text);
  alert("現在地のGoogleマップURLをコピーしました！LINEやSMSに貼り付けて送信してください。");
}

function closeModals() {
  document.getElementById("logModal").classList.remove("open");
  document.getElementById("sosModal").classList.remove("open");
}

function speakJapanese(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const uttr = new SpeechSynthesisUtterance(text);
  uttr.lang = "ja-JP";
  uttr.rate = 1.08;
  window.speechSynthesis.speak(uttr);
}

// ==========================================
// 11. 初期起動処理（フリー走行待機モードで開始）
// ==========================================
resetToStandbyMode();
syncThemeButtonsUI();
fetchRealWeather(currentLat, currentLng, "横浜・みなとみらい付近");

window.addEventListener("load", () => {
  let done = false;
  try { done = localStorage.getItem("apex_navi_tut_done") === "1"; } catch (e) {}
  if (!done) {
    openTutorial(0);
  }
});