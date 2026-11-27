// ==========================================
// 0. PWA Service Worker 登録（ホーム画面アプリ化＆オフラインキャッシュ）
// ==========================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ==========================================
// 1. ユーザーカスタマイズ可能なナビ案内・高速2倍・インカム音声設定
// ==========================================
const DEFAULT_NAV_CONFIG = {
  stage1Dist: 1000,       // ① 車線誘導（1回目・一般道基準）
  stage2Dist: 500,        // ② 中間告知（2回目・一般道基準）
  stage3Dist: 200,        // ③ 減速準備（3回目・一般道基準）
  stage4Dist: 100,        // ④ 直前案内（4回目・一般道基準）
  rerouteDist: 35,        // ルート逸脱リルート判定距離(m)
  highwayAutoScale: true, // 時速70km以上で案内距離を自動2倍にする
  voiceChime: true,       // 案内前の「ポーン♪」チャイム音
  voiceRate: 1.10,        // 読み上げ話速 (0.8〜1.5)
  voicePitch: 1.05        // 声の高さ (0.7〜1.4)
};

let navConfig = Object.assign(
  {},
  DEFAULT_NAV_CONFIG,
  JSON.parse(localStorage.getItem("apex_nav_config") || "{}")
);

let isHighwaySpeedMode = false;

function updateHighwaySpeedState(speedKmh) {
  if (!navConfig.highwayAutoScale) {
    isHighwaySpeedMode = false;
    updateSpeedModeHUD(speedKmh);
    return;
  }

  const prevMode = isHighwaySpeedMode;
  if (!isHighwaySpeedMode && speedKmh >= 70) {
    isHighwaySpeedMode = true;
  } else if (isHighwaySpeedMode && speedKmh <= 55) {
    isHighwaySpeedMode = false;
  }

  updateSpeedModeHUD(speedKmh);

  if (prevMode !== isHighwaySpeedMode && isRouteActive) {
    const modeMsg = isHighwaySpeedMode
      ? "高速巡航を検知しました。車線案内と分岐予告の距離を2倍に広げます。"
      : "一般道ペースに戻りました。標準の案内距離に戻します。";
    document.getElementById("voiceSubtitle").textContent = `🛣️ ${modeMsg}`;
    speakJapanese(modeMsg);
  }
}

function updateSpeedModeHUD(speedKmh) {
  const hud = document.getElementById("speedHud");
  const badge = document.getElementById("highwayBadge");
  const unit = document.getElementById("speedUnit");
  if (!hud || !badge || !unit) return;

  if (isHighwaySpeedMode) {
    hud.classList.add("highway-active");
    badge.style.display = "block";
    unit.textContent = "km/h (高速2倍)";
  } else {
    hud.classList.remove("highway-active");
    badge.style.display = "none";
    unit.textContent = (isGpsActive || isSimActive) ? "km/h (一般道)" : "km/h (待機)";
  }
}

function getEffectiveNavDistances() {
  const mult = (navConfig.highwayAutoScale && isHighwaySpeedMode) ? 2 : 1;
  return {
    mult,
    s1: navConfig.stage1Dist * mult,
    s2: navConfig.stage2Dist * mult,
    s3: navConfig.stage3Dist * mult,
    s4: navConfig.stage4Dist * mult,
    reroute: navConfig.rerouteDist * mult
  };
}

function formatJapaneseMeters(meters) {
  if (meters >= 1000) {
    const km = meters / 1000;
    return Number.isInteger(km) ? `${km}キロ` : `${km.toFixed(1)}キロ`;
  }
  return `${meters}メートル`;
}

function saveNavConfig() {
  localStorage.setItem("apex_nav_config", JSON.stringify(navConfig));
  updateStandbyConfigCaption();
}

function updateStandbyConfigCaption() {
  const el = document.getElementById("standbySubMsg");
  if (!el) return;
  const hwText = navConfig.highwayAutoScale ? "70km/h以上で自動2倍" : "高速2倍OFF";
  el.textContent = `${navConfig.stage1Dist}m・${navConfig.stage2Dist}m・${navConfig.stage3Dist}m・${navConfig.stage4Dist}m車線案内（${hwText}）`;
}

function toggleHighwayAutoScale() {
  navConfig.highwayAutoScale = !navConfig.highwayAutoScale;
  if (!navConfig.highwayAutoScale) isHighwaySpeedMode = false;
  syncSettingsSlidersUI();
  saveNavConfig();
  updateSpeedModeHUD(currentSpeedKmh);
}

function toggleVoiceChime() {
  navConfig.voiceChime = !navConfig.voiceChime;
  syncSettingsSlidersUI();
  saveNavConfig();
  if (navConfig.voiceChime) playIntercomChime();
}

function syncSettingsSlidersUI() {
  document.getElementById("sliderStage1").value = navConfig.stage1Dist;
  document.getElementById("sliderStage2").value = navConfig.stage2Dist;
  document.getElementById("sliderStage3").value = navConfig.stage3Dist;
  document.getElementById("sliderStage4").value = navConfig.stage4Dist;
  document.getElementById("sliderRerouteDist").value = navConfig.rerouteDist;
  document.getElementById("sliderVoiceRate").value = navConfig.voiceRate;
  document.getElementById("sliderVoicePitch").value = navConfig.voicePitch;

  const hwBtn = document.getElementById("highwayAutoBtn");
  if (hwBtn) {
    hwBtn.classList.toggle("active", navConfig.highwayAutoScale);
    hwBtn.textContent = navConfig.highwayAutoScale ? "ON (自動2倍)" : "OFF (固定)";
  }

  const chimeBtn = document.getElementById("voiceChimeBtn");
  if (chimeBtn) {
    chimeBtn.classList.toggle("active", navConfig.voiceChime);
    chimeBtn.textContent = navConfig.voiceChime ? "ON (チャイム有)" : "OFF (音声のみ)";
  }

  document.getElementById("valVoiceRate").textContent = `${Number(navConfig.voiceRate).toFixed(2)}倍`;
  document.getElementById("valVoicePitch").textContent = `${Number(navConfig.voicePitch).toFixed(2)}`;

  const hwSuffix = navConfig.highwayAutoScale;
  document.getElementById("valStage1").textContent = hwSuffix
    ? `${navConfig.stage1Dist}m (高速${navConfig.stage1Dist * 2}m)`
    : `${navConfig.stage1Dist}m手前`;
  document.getElementById("valStage2").textContent = hwSuffix
    ? `${navConfig.stage2Dist}m (高速${navConfig.stage2Dist * 2}m)`
    : `${navConfig.stage2Dist}m手前`;
  document.getElementById("valStage3").textContent = hwSuffix
    ? `${navConfig.stage3Dist}m (高速${navConfig.stage3Dist * 2}m)`
    : `${navConfig.stage3Dist}m手前`;
  document.getElementById("valStage4").textContent = hwSuffix
    ? `${navConfig.stage4Dist}m (高速${navConfig.stage4Dist * 2}m)`
    : `${navConfig.stage4Dist}m手前`;
  document.getElementById("valRerouteDist").textContent = hwSuffix
    ? `${navConfig.rerouteDist}m (高速${navConfig.rerouteDist * 2}m)`
    : `${navConfig.rerouteDist}m外れたら`;

  const preview = document.getElementById("highwayPreviewText");
  if (preview) {
    preview.textContent = navConfig.highwayAutoScale
      ? `一般道 (${navConfig.stage1Dist}/${navConfig.stage2Dist}/${navConfig.stage3Dist}/${navConfig.stage4Dist}m) → 70km/h以上で (${navConfig.stage1Dist * 2}/${navConfig.stage2Dist * 2}/${navConfig.stage3Dist * 2}/${navConfig.stage4Dist * 2}m)`
      : "高速道路でも一般道と同じ固定距離で案内します";
  }
}

function onSettingSliderChange() {
  let s1 = Number(document.getElementById("sliderStage1").value);
  let s2 = Number(document.getElementById("sliderStage2").value);
  let s3 = Number(document.getElementById("sliderStage3").value);
  let s4 = Number(document.getElementById("sliderStage4").value);
  const rr = Number(document.getElementById("sliderRerouteDist").value);
  const vRate = Number(document.getElementById("sliderVoiceRate").value);
  const vPitch = Number(document.getElementById("sliderVoicePitch").value);

  if (s2 >= s1) s2 = s1 - 100;
  if (s3 >= s2) s3 = s2 - 50;
  if (s4 >= s3) s4 = s3 - 30;

  navConfig = {
    ...navConfig,
    stage1Dist: s1,
    stage2Dist: s2,
    stage3Dist: s3,
    stage4Dist: s4,
    rerouteDist: rr,
    voiceRate: vRate,
    voicePitch: vPitch
  };

  syncSettingsSlidersUI();
  saveNavConfig();
}

function resetNavSettingsDefault() {
  navConfig = { ...DEFAULT_NAV_CONFIG };
  syncSettingsSlidersUI();
  saveNavConfig();
  speakJapanese("案内距離とインカム音声設定を初期値に戻しました。");
}

function testVoiceAnnouncement() {
  const eff = getEffectiveNavDistances();
  speakJapanese(
    `およそ${formatJapaneseMeters(eff.s1)}先で右折です。今のうちに一番右の車線へ移動しておきましょう。`
  );
}

// ==========================================
// 2. Web Audio API インカム事前チャイム音（「ポーン♪」）
// ==========================================
let audioCtx = null;

function playIntercomChime() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const now = audioCtx.currentTime;
    const notes = [
      { freq: 659.25, start: now, dur: 0.14 },
      { freq: 523.25, start: now + 0.13, dur: 0.24 }
    ];

    notes.forEach(n => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, n.start);

      gain.gain.setValueAtTime(0.001, n.start);
      gain.gain.exponentialRampToValueAtTime(0.18, n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, n.start + n.dur);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(n.start);
      osc.stop(n.start + n.dur + 0.02);
    });
  } catch (e) {}
}

function speakJapanese(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  const startSpeech = () => {
    const uttr = new SpeechSynthesisUtterance(text);
    uttr.lang = "ja-JP";
    uttr.rate = navConfig.voiceRate || 1.10;
    uttr.pitch = navConfig.voicePitch || 1.05;
    window.speechSynthesis.speak(uttr);
  };

  if (navConfig.voiceChime) {
    playIntercomChime();
    setTimeout(startSpeech, 260);
  } else {
    startSpeech();
  }
}

// ==========================================
// 3. 状態管理・永続データ（マイガレージ＆称号）
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
let isMajorRoadPriority = true;
let activeDestName = "";
let activeDestCoord = null;
let activeWaypoint = null;
let wakeLock = null;

// GPS精度フィルタリング用カウンタ（連続逸脱検知）
let offRouteStreakCount = 0;
const MAX_ACCEPTABLE_GPS_ACCURACY_M = 45;

const initialHour = new Date().getHours();
let isDarkMap = initialHour >= 18 || initialHour < 6;

const MAP_STYLES = {
  day: "https://tiles.openfreemap.org/styles/positron",
  night: "https://tiles.openfreemap.org/styles/dark"
};

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

let currentRouteGeoJson = null;
let routeCoordinates = [];
let remainingRouteMeters = 0;
let remainingRouteSeconds = 0;
let lastRerouteTime = 0;

const DEFAULT_FAVS = ["箱根大観山", "宮ヶ瀬ダム 鳥居原ふれあいの館", "大黒パーキングエリア", "江ノ島"];
let favoriteSpots = JSON.parse(localStorage.getItem("apex_favs") || "null") || DEFAULT_FAVS;
let rideHistory = JSON.parse(localStorage.getItem("apex_history") || "[]");
let unlockedBadges = JSON.parse(localStorage.getItem("apex_badges") || "{}");

const RIDER_BADGES = [
  { id: "first_gps", icon: "🛰️", title: "ナビ起動", desc: "GPSを接続して走行を開始" },
  { id: "corner_25", icon: "🏍️", title: "峠マスター", desc: "バンク角 25°以上を記録" },
  { id: "night_rider", icon: "🌙", title: "ナイトライダー", desc: "夜間ダークモードで走行" },
  { id: "rain_rider", icon: "☔", title: "全天候ツアラー", desc: "雨天・ウェット路面を走破" },
  { id: "dist_50", icon: "🛣️", title: "ロングツアラー", desc: "1回の走行で50km以上走破" },
  { id: "voice_pro", icon: "🎙️", title: "ハンズフリー達人", desc: "音声指令で目的地・経由地を操作" }
];

function unlockBadge(badgeId) {
  if (unlockedBadges[badgeId]) return;
  const b = RIDER_BADGES.find(item => item.id === badgeId);
  if (!b) return;
  unlockedBadges[badgeId] = Date.now();
  localStorage.setItem("apex_badges", JSON.stringify(unlockedBadges));
  const msg = `称号「${b.title}」を獲得しました！`;
  document.getElementById("voiceSubtitle").textContent = `🏆 ${msg}`;
  speakJapanese(msg);
}

// ==========================================
// 4. 共通位置更新パイプライン（実GPS＆シミュレーター共用）
// ==========================================
function processPositionUpdate({ latitude, longitude, speedKmh, headingDeg, altitudeM, accuracyM }) {
  const accM = Math.round(accuracyM);
  const isGoodSignal = accM <= MAX_ACCEPTABLE_GPS_ACCURACY_M;

  if (isGoodSignal && prevLat !== null && prevLng !== null) {
    const dKm = haversineKm(prevLat, prevLng, latitude, longitude);
    if (dKm > 0.002 && dKm < 0.8) {
      totalDistanceKm += dKm;
      if (totalDistanceKm >= 50) unlockBadge("dist_50");
      trackCoords.push([longitude, latitude]);
      if (map.getSource("track-source")) {
        map.getSource("track-source").setData({
          type: "Feature",
          geometry: { type: "LineString", coordinates: trackCoords }
        });
      }
    }
  }

  if (headingDeg !== null && !isNaN(headingDeg)) {
    currentHeading = Math.round(headingDeg);
  } else if (isGoodSignal && prevLat !== null && (Math.abs(latitude - prevLat) > 0.00002 || Math.abs(longitude - prevLng) > 0.00002)) {
    currentHeading = Math.round(calcBearing(prevLat, prevLng, latitude, longitude));
  }

  if (isGoodSignal) {
    prevLat = latitude;
    prevLng = longitude;
  }
  currentLat = latitude;
  currentLng = longitude;

  riderMarker.setLngLat([currentLng, currentLat]);

  if (autoFollow) {
    map.easeTo({
      center: [currentLng, currentLat],
      bearing: isHeadingUp ? currentHeading : 0,
      pitch: isPitch3D ? 45 : 0,
      duration: 420
    });
  }

  const kmh = Math.max(0, Math.round(speedKmh));
  currentSpeedKmh = kmh;
  if (kmh > maxSpeedKmh && kmh < 250) maxSpeedKmh = kmh;

  document.getElementById("speedVal").textContent = kmh;
  document.getElementById("speedHud").classList.add("live");

  updateHighwaySpeedState(kmh);

  const elapsedMin = Math.floor((Date.now() - rideStartTime) / 60000);
  const hh = String(Math.floor(elapsedMin / 60)).padStart(2, "0");
  const mm = String(elapsedMin % 60).padStart(2, "0");
  document.getElementById("tripSummaryText").textContent = `走行: ${totalDistanceKm.toFixed(1)}km / ${hh}:${mm}`;

  if (elapsedMin >= 60 && elapsedMin - lastRestAlertMin >= 60) {
    lastRestAlertMin = elapsedMin;
    speakJapanese(`連続走行が${elapsedMin}分を超えました。集中力維持のため、次の道の駅やコンビニで休憩しましょう。`);
  }

  const altStr = altitudeM !== null ? `${Math.round(altitudeM)}m` : "--m";
  document.getElementById("headingText").textContent = `方位: ${currentHeading}° / 標高: ${altStr}`;

  const eff = getEffectiveNavDistances();
  if (isSimActive) {
    document.getElementById("gpsToggleBtn").classList.add("gps-on");
    document.getElementById("gpsBtnLabel").textContent = "🧪 シミュ稼働中";
    document.getElementById("gpsBtnSub").textContent = isGoodSignal ? `逸脱${eff.reroute}m監視中` : `誤差±${accM}mブロック中`;
  } else if (isGpsActive) {
    document.getElementById("gpsToggleBtn").classList.add("gps-on");
    document.getElementById("gpsBtnLabel").textContent = isHighwaySpeedMode ? "🛣️ 高速2倍稼働" : "🛰️ GPS稼働中";
    document.getElementById("gpsBtnSub").textContent = isGoodSignal ? `逸脱${eff.reroute}m監視中` : `精度低下(±${accM}m)`;
  }

  const dotEl = document.getElementById("gpsDot");
  dotEl.className = isGoodSignal ? "gps-status-dot active" : "gps-status-dot warn";
  const prefix = isSimActive ? "SIM" : "GPS";
  document.getElementById("gpsStatusText").textContent = isGoodSignal
    ? `${prefix} OK (±${accM}m)`
    : `測位不安定 (±${accM}m)`;

  evaluateLiveNavigation(currentLat, currentLng, kmh, accM);
  fetchRealWeather(currentLat, currentLng);
  updateWeatherUI();
}

// ==========================================
// 5. 実走シミュレーション（デバッグ）エンジン
// ==========================================
let isSimActive = false;
let simTimer = null;
let simSpeedKmh = 40;
let simRouteIndex = 0;
let simSegmentProgress = 0;
let simTunnelNoiseOn = false;

function toggleSimulationMode() {
  if (isSimActive) {
    stopSimulationMode();
  } else {
    startSimulationMode();
  }
}

async function startSimulationMode() {
  // 実GPSが動いていたら停止
  if (isGpsActive) toggleGPS();

  // ルートが未設定の場合は自動でサンプルルートを検索
  if (!isRouteActive || routeCoordinates.length < 2) {
    const input = document.getElementById("destInput");
    if (!input.value.trim()) input.value = "江ノ島";
    await searchAndRoute();
  }

  if (routeCoordinates.length < 2) return;

  isSimActive = true;
  simRouteIndex = 0;
  simSegmentProgress = 0;
  autoFollow = true;
  document.getElementById("recenterBtn").classList.remove("active");
  document.getElementById("simControlPanel").classList.add("open");
  document.getElementById("quickSimBtn").classList.add("sim-running");
  document.getElementById("quickSimBtn").textContent = "🧪 テスト停止";

  setSimSpeed(40);
  speakJapanese("実走シミュレーションを開始します。仮想バイクがルート上を走行します。");

  if (simTimer) clearInterval(simTimer);
  simTimer = setInterval(tickSimulation, 500);
}

function stopSimulationMode() {
  isSimActive = false;
  simTunnelNoiseOn = false;
  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
  }
  isHighwaySpeedMode = false;
  updateSpeedModeHUD(0);

  document.getElementById("simControlPanel").classList.remove("open");
  document.getElementById("quickSimBtn").classList.remove("sim-running");
  document.getElementById("quickSimBtn").textContent = "🧪 実走テスト";
  document.getElementById("simTunnelBtn").classList.remove("noise-on");
  document.getElementById("simTunnelBtn").textContent = "🚇 トンネル誤差: OFF";

  document.getElementById("gpsToggleBtn").classList.remove("gps-on");
  document.getElementById("gpsBtnLabel").textContent = "📡 GPS開始";
  document.getElementById("gpsBtnSub").textContent = "自動案内＆リルート";
  document.getElementById("gpsDot").className = "gps-status-dot";
  document.getElementById("gpsStatusText").textContent = "GPS未接続";
  document.getElementById("speedVal").textContent = "0";
}

function setSimSpeed(kmh) {
  simSpeedKmh = kmh;
  [40, 80, 160].forEach(v => {
    const btn = document.getElementById(`simSpd${v}`);
    if (btn) btn.classList.toggle("active", v === kmh);
  });
}

function toggleSimTunnelNoise() {
  simTunnelNoiseOn = !simTunnelNoiseOn;
  const btn = document.getElementById("simTunnelBtn");
  btn.classList.toggle("noise-on", simTunnelNoiseOn);
  btn.textContent = simTunnelNoiseOn ? "🚇 トンネル誤差: ON (±80m)" : "🚇 トンネル誤差: OFF";

  if (simTunnelNoiseOn) {
    speakJapanese("トンネル内の測位誤差を再現します。位置が飛んでも誤リルートをブロックします。");
  }
}

function triggerSimOffRoute() {
  if (!isSimActive) return;
  // ルートから東へ約60mずらした座標を2回連続で送り、35m逸脱検知＆自動リルートを発動させる
  const offLng = currentLng + 0.00068;
  const offLat = currentLat + 0.00025;
  const acc = simTunnelNoiseOn ? 80 : 8;

  processPositionUpdate({
    latitude: offLat,
    longitude: offLng,
    speedKmh: simSpeedKmh,
    headingDeg: currentHeading,
    altitudeM: 25,
    accuracyM: acc
  });

  setTimeout(() => {
    if (!isSimActive) return;
    processPositionUpdate({
      latitude: offLat + 0.0001,
      longitude: offLng + 0.0001,
      speedKmh: simSpeedKmh,
      headingDeg: currentHeading,
      altitudeM: 25,
      accuracyM: acc
    });
    // リルート後に新しいルート先頭から走れるようインデックスリセット
    simRouteIndex = 0;
    simSegmentProgress = 0;
  }, 300);
}

function tickSimulation() {
  if (!isSimActive || !isRouteActive || routeCoordinates.length < 2) return;

  // 0.5秒間に進む距離(m)
  let stepMeters = (simSpeedKmh * 1000 / 3600) * 0.5;

  while (stepMeters > 0 && simRouteIndex < routeCoordinates.length - 1) {
    const p1 = routeCoordinates[simRouteIndex];
    const p2 = routeCoordinates[simRouteIndex + 1];
    const segDistM = Math.max(0.5, haversineKm(p1[1], p1[0], p2[1], p2[0]) * 1000);
    const remainInSeg = segDistM * (1 - simSegmentProgress);

    if (stepMeters < remainInSeg) {
      simSegmentProgress += stepMeters / segDistM;
      stepMeters = 0;
    } else {
      stepMeters -= remainInSeg;
      simRouteIndex++;
      simSegmentProgress = 0;
    }
  }

  if (simRouteIndex >= routeCoordinates.length - 1) {
    const lastPt = routeCoordinates[routeCoordinates.length - 1];
    processPositionUpdate({
      latitude: lastPt[1],
      longitude: lastPt[0],
      speedKmh: 0,
      headingDeg: currentHeading,
      altitudeM: 18,
      accuracyM: 6
    });
    speakJapanese("シミュレーション目的地に到着しました。テストを終了します。");
    stopSimulationMode();
    return;
  }

  const a = routeCoordinates[simRouteIndex];
  const b = routeCoordinates[simRouteIndex + 1];
  let simLng = a[0] + (b[0] - a[0]) * simSegmentProgress;
  let simLat = a[1] + (b[1] - a[1]) * simSegmentProgress;
  const heading = calcBearing(a[1], a[0], b[1], b[0]);

  // トンネル誤差ON時はわざと座標を55m横に飛ばしつつ精度を±80mにする
  if (simTunnelNoiseOn) {
    simLng += 0.0006;
  }

  processPositionUpdate({
    latitude: simLat,
    longitude: simLng,
    speedKmh: simSpeedKmh,
    headingDeg: heading,
    altitudeM: 24,
    accuracyM: simTunnelNoiseOn ? 80 : 7
  });
}

// ==========================================
// 6. 右上メニュー開閉＆SOS長押し安全ロック
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
// 7. ゲーム風チュートリアルモード
// ==========================================
let tutStep = 0;
const tutorialMissions = [
  {
    badge: "MISSION 1 / 4",
    avatar: "🎧",
    sub: "STEP 1: INTERCOM CHIME & 2X HIGHWAY",
    title: "事前チャイム音 ＋ 高速70km/h以上自動2倍",
    desc: "案内前に「ポーン♪」とチャイムが鳴り、一般道では1000m→500m→200m→100m、時速70km以上の高速道路では自動で2倍距離で車線誘導します！",
    apiTag: "使用API: Web Speech API ＋ Web Audio API",
    btnText: "🔔 チャイム＆音声テストを実行して次へ ▶"
  },
  {
    badge: "MISSION 2 / 4",
    avatar: "🛰️",
    sub: "STEP 2: GPS ACCURACY FILTER & 35m REROUTE",
    title: "トンネル誤作動防止 ＋ 35m自動リルート",
    desc: "GPS誤差45m以上のトンネルや高架下では誤リルートを自動ブロック！通常時は35m（高速70m）外れると即座に再計算します。",
    apiTag: "使用API: Geolocation API ＋ Open-Meteo気象API",
    btnText: "📡 GPSと気象データを接続する ▶"
  },
  {
    badge: "MISSION 3 / 4",
    avatar: "📐",
    sub: "STEP 3: LEAN ANGLE SENSOR",
    title: "バンク角（リーンアングル）計測起動",
    desc: "コーナリング中の左右バンク角を計測します。25°以上で「峠マスター」称号が解除されます！",
    apiTag: "使用API: DeviceOrientation API",
    btnText: "📐 バンク角センサーを有効化する ▶"
  },
  {
    badge: "MISSION 4 / 4",
    avatar: "🧪",
    sub: "FINAL MISSION: SIMULATION & RIDE",
    title: "実走シミュレーションで動作テスト！",
    desc: "画面下の「🧪 実走テスト」を押すと部屋にいながら仮想バイクで走行テストができます。最後にサンプルルートを検索して完了です！",
    apiTag: "実走シミュレーター搭載",
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
    speakJapanese("インカム接続完了です。案内前のチャイム音と高速2倍モードが有効です。");
    tutStep = 1;
    renderTutorialStep();
  } else if (tutStep === 1) {
    if (!isGpsActive) toggleGPS();
    speakJapanese("GPS精度フィルタと気象データに接続しました。次はバンク角センサーを有効にします。");
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
// 8. ベクター地図（昼＆夜間省電力ダーク切替対応）
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
let waypointMarker = null;
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
      paint: { "line-color": isDarkMap ? "#0d47a1" : "#174ea6", "line-width": 12 }
    });
  }

  if (!map.getLayer("route-line")) {
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route-source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": isDarkMap ? "#38bdf8" : "#4285f4", "line-width": 7 }
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

map.on("style.load", () => {
  setupRouteAndTrackLayers();
});

function toggleMapTheme() {
  isDarkMap = !isDarkMap;
  map.setStyle(isDarkMap ? MAP_STYLES.night : MAP_STYLES.day);
  syncThemeButtonsUI();
  if (isDarkMap) unlockBadge("night_rider");
  const msg = isDarkMap
    ? "夜間・省電力ダーク地図に切り替えました。"
    : "昼間の高視認ライト地図に切り替えました。";
  document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
  speakJapanese(msg);
}

function syncThemeButtonsUI() {
  const viewport = document.getElementById("mapViewport");
  const menuBtn = document.getElementById("mapThemeBtn");
  const quickBtn = document.getElementById("quickThemeBtn");

  viewport.classList.toggle("night-mode", isDarkMap);
  if (menuBtn) menuBtn.textContent = isDarkMap ? "🌙 地図: 夜間ダーク" : "☀️ 地図: 昼モード";
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
  document.getElementById("tiltModeBtn").textContent = isPitch3D ? "📐 視点: ナビ3D" : "📐 視点: 真上2D";
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
// 9. 大通り優先（狭路回避）ルートオプション
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

  if (isRouteActive && document.getElementById("destInput").value.trim()) {
    searchAndRoute();
  }
}

function pickBestRouteForRider(routes) {
  if (!routes || routes.length === 0) return null;
  if (!isMajorRoadPriority || routes.length === 1) return routes[0];

  let bestRoute = routes[0];
  let bestMajorScore = -1;

  routes.forEach((r) => {
    let majorDistance = 0;
    let totalDistance = Math.max(1, r.distance);

    r.legs.forEach((leg) => {
      if (!leg.steps) return;
      leg.steps.forEach((st) => {
        const ref = st.ref || "";
        const name = st.name || "";
        const isMajor =
          ref.length > 0 ||
          /(国道|県道|都道|府道|道道|バイパス|街道|大通り|幹線|環状)/.test(name);
        if (isMajor) majorDistance += st.distance;
      });
    });

    const majorRatio = majorDistance / totalDistance;
    if (majorRatio > bestMajorScore) {
      bestMajorScore = majorRatio;
      bestRoute = r;
    }
  });

  return bestRoute;
}

// ==========================================
// 10. 音声コマンド（ハンズフリー目的地＆経由地追加）
// ==========================================
function startVoiceCommand() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    const fallback = prompt("音声指令を入力してください（例: 近くのガソリンスタンドに寄る / 江ノ島へ行く）");
    if (fallback) processVoiceTranscript(fallback);
    return;
  }

  const btn = document.getElementById("micSearchBtn");
  btn.classList.add("listening");
  document.getElementById("voiceSubtitle").textContent = "🎙️ 聞き取り中...「近くのガソリンスタンドに寄る」「大観山へ行く」など話してください";

  const rec = new SpeechRec();
  rec.lang = "ja-JP";
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = (event) => {
    btn.classList.remove("listening");
    const transcript = event.results[0][0].transcript;
    document.getElementById("voiceSubtitle").textContent = `🎙️ 認識: 「${transcript}」`;
    unlockBadge("voice_pro");
    processVoiceTranscript(transcript);
  };

  rec.onerror = () => {
    btn.classList.remove("listening");
    speakJapanese("音声を聞き取れませんでした。もう一度お試しください。");
  };

  rec.onend = () => {
    btn.classList.remove("listening");
  };

  rec.start();
}

function processVoiceTranscript(text) {
  if (/ガソリン|給油|スタンド/.test(text)) {
    searchNearbyPOI("fuel", true);
    return;
  }
  if (/コンビニ|セブン|ローソン|ファミマ/.test(text)) {
    searchNearbyPOI("convenience", true);
    return;
  }
  if (/トイレ|道の駅|休憩/.test(text)) {
    searchNearbyPOI("toilets", true);
    return;
  }
  if (/案内終了|ルート解除|キャンセル/.test(text)) {
    resetToStandbyMode();
    speakJapanese("ルート案内を終了しました。");
    return;
  }

  const cleaned = text.replace(/(へ行く|に行く|まで案内|まで|へ案内|に行って|を検索)/g, "").trim();
  if (cleaned) {
    document.getElementById("destInput").value = cleaned;
    searchAndRoute();
  }
}

// ==========================================
// 11. 気象API＆走行風体感温度計算
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
      if (realPrecipMm > 0) unlockBadge("rain_rider");
      const elev = data.elevation ? ` (標高${Math.round(data.elevation)}m)` : "";
      const label = placeName ? `${placeName}${elev}` : `現在地${elev}`;
      document.getElementById("weatherSpot").textContent = label;
      updateWeatherUI();
    }
  } catch (e) {}
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
// 12. ルート検索・急カーブ検出・ETA表示・暖簾一覧
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
  const wpTag = activeWaypoint ? `（経由: ${activeWaypoint.name}）` : "";
  if (activeDestName) {
    subEl.textContent = `${modeTag}「${activeDestName}」${wpTag} 案内全${generatedSteps.length}件`;
  } else {
    subEl.textContent = "先読みシナリオ一覧（タップで切替・上のカード再タップで収納）";
  }

  const container = document.getElementById("routeStepsContainer");
  container.innerHTML = generatedSteps.map((st, idx) => {
    const isCurrent = idx === currentStepIdx && isRouteActive;
    const isWarn = st.cardClass === "highlight-amber";
    const isCurve = st.cardClass === "highlight-red";
    return `
      <div class="step-row ${isCurrent ? "current" : ""} ${isWarn ? "warn-row" : ""} ${isCurve ? "curve-row" : ""}" onclick="jumpToRouteStep(${idx})">
        <div class="step-turn-badge">${st.icon || "↑"}</div>
        <div class="step-body">
          <div class="step-top-line">
            <span class="step-num-tag">${isCurrent ? "● 案内中 / " : ""}STEP ${idx + 1} ・ ${st.signalText}</span>
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
    map.easeTo({ center: st.location, zoom: 16.5, pitch: 45, duration: 600 });
  }
}

function updateEtaDisplay(distMeters, durationSeconds) {
  const etaPill = document.getElementById("etaPill");
  if (!isRouteActive || distMeters <= 0) {
    etaPill.style.display = "none";
    return;
  }
  const arrival = new Date(Date.now() + durationSeconds * 1000);
  const hh = String(arrival.getHours()).padStart(2, "0");
  const mm = String(arrival.getMinutes()).padStart(2, "0");
  const kmStr = (distMeters / 1000).toFixed(1);
  etaPill.style.display = "inline-block";
  etaPill.textContent = `残${kmStr}km・${hh}:${mm}着`;
}

function resetToStandbyMode() {
  if (isSimActive) stopSimulationMode();
  setNorenOpen(false);
  isRouteActive = false;
  activeDestName = "";
  activeDestCoord = null;
  activeWaypoint = null;
  generatedSteps = [];
  currentStepIdx = 0;
  routeCoordinates = [];
  offRouteStreakCount = 0;
  currentRouteGeoJson = { type: "Feature", geometry: { type: "LineString", coordinates: [] } };

  if (map.getSource("route-source")) {
    map.getSource("route-source").setData(currentRouteGeoJson);
  }
  if (destMarker) { destMarker.remove(); destMarker = null; }
  if (waypointMarker) { waypointMarker.remove(); waypointMarker = null; }

  const card = document.getElementById("guidanceCard");
  card.className = "guidance-card standby";
  document.getElementById("listHintPill").style.display = "none";
  document.getElementById("etaPill").style.display = "none";
  document.getElementById("signalLabel").textContent = isMajorRoadPriority
    ? "📍 フリー走行モード（大通り優先・狭路回避ON）"
    : "📍 フリー走行モード（標準最短ルート設定）";
  document.getElementById("signalDots").innerHTML = "";
  document.getElementById("distTag").textContent = "STANDBY";
  document.getElementById("actionHeadline").textContent = "上の検索欄か🎙️音声で目的地を入力して出発";
  document.getElementById("laneGuide").innerHTML =
    `<div class="lane-box standby-msg" id="standbySubMsg"></div>`;
  updateStandbyConfigCaption();

  const toast = document.getElementById("intercomToast");
  toast.classList.remove("active-nav");
  document.getElementById("voiceSubtitle").textContent = "「近くのガソリンスタンドに寄る」など音声指令にも対応しています。";

  const mainBtn = document.getElementById("mainNextBtn");
  mainBtn.classList.remove("primary");
  mainBtn.classList.add("standby-btn");
  document.getElementById("mainNextLabel").textContent = "🎙️ 音声指令";
  document.getElementById("mainNextSub").textContent = "目的地・経由地";

  const goBtn = document.getElementById("routeActionBtn");
  goBtn.textContent = "検索";
  goBtn.classList.remove("cancel-mode");
  goBtn.onclick = searchAndRoute;
}

async function searchAndRoute(isReroute = false) {
  setNorenOpen(false);
  offRouteStreakCount = 0;
  const query = document.getElementById("destInput").value.trim();
  if (!query && !activeDestCoord) {
    document.getElementById("destInput").focus();
    return;
  }

  if (!isReroute) {
    const policyLabel = isMajorRoadPriority ? "大通り優先で" : "";
    speakJapanese(`${query}まで${policyLabel}ツーリングルートを検索します。`);
    document.getElementById("actionHeadline").textContent = `「${query}」へ${policyLabel}計算中...`;
  }

  try {
    let destLat, destLng, destName;
    if (isReroute && activeDestCoord) {
      destLat = activeDestCoord.lat;
      destLng = activeDestCoord.lng;
      destName = activeDestName;
    } else {
      const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=ja`;
      const geoRes = await fetch(geoUrl);
      const geoData = await geoRes.json();

      if (!geoData || geoData.length === 0) {
        alert("目的地が見つかりませんでした。別の地名や施設名をお試しください。");
        resetToStandbyMode();
        return;
      }

      destLat = parseFloat(geoData[0].lat);
      destLng = parseFloat(geoData[0].lon);
      destName = geoData[0].display_name.split(",")[0];
      activeDestName = destName;
      activeDestCoord = { lat: destLat, lng: destLng };
      await fetchRealWeather(destLat, destLng, `${destName} 到着予報`);
    }

    const coordStr = activeWaypoint
      ? `${currentLng},${currentLat};${activeWaypoint.lng},${activeWaypoint.lat};${destLng},${destLat}`
      : `${currentLng},${currentLat};${destLng},${destLat}`;

    const excludeParam = bikeClassIdx === 2 ? "&exclude=motorway" : "";
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true&alternatives=true${excludeParam}`;
    const routeRes = await fetch(osrmUrl);
    const routeData = await routeRes.json();

    if (!routeData.routes || routeData.routes.length === 0) {
      alert("ルートを計算できませんでした。");
      resetToStandbyMode();
      return;
    }

    const route = pickBestRouteForRider(routeData.routes);
    routeCoordinates = route.geometry.coordinates;
    remainingRouteMeters = route.distance;
    remainingRouteSeconds = route.duration;

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
      .addTo(map);
    if (!isReroute) destMarker.togglePopup();

    if (waypointMarker) waypointMarker.remove();
    if (activeWaypoint) {
      waypointMarker = new maplibregl.Marker({ color: "#00e676" })
        .setLngLat([activeWaypoint.lng, activeWaypoint.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<b>📍 経由: ${activeWaypoint.name}</b>`))
        .addTo(map);
    }

    if (!isReroute && !isSimActive) {
      autoFollow = false;
      document.getElementById("recenterBtn").classList.add("active");
      const bounds = routeCoordinates.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(routeCoordinates[0], routeCoordinates[0])
      );
      map.fitBounds(bounds, { padding: 50, pitch: 20 });
    }

    const allOsrmSteps = route.legs.flatMap((leg, legIdx) =>
      leg.steps.map(s => ({ ...s, _legIdx: legIdx }))
    );
    generatedSteps = buildRiderProactiveSteps(allOsrmSteps, destName, route.distance);
    currentStepIdx = 0;
    activateNavModeUI();
    updateEtaDisplay(remainingRouteMeters, remainingRouteSeconds);
    applyGeneratedStep(0, !isReroute);

  } catch (err) {
    console.error(err);
    if (!isReroute) {
      alert("ルート検索中に通信エラーが発生しました。");
      resetToStandbyMode();
    }
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
  document.getElementById("mainNextSub").textContent = "高速2倍自動連動";

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
      if (activeWaypoint && st._legIdx === 0) {
        steps.push({
          icon: "⛽",
          turnAction: `${activeWaypoint.name}へ左折進入`,
          laneAction: "左車線へ寄って進入準備",
          signals: 0,
          signalText: `経由地「${activeWaypoint.name}」に到着`,
          dist: "経由地",
          headline: `${activeWaypoint.name} に立ち寄り・休憩`,
          cardClass: "highlight-green",
          location: loc,
          lanes: [{ text: "↰ 進入", state: "recommended" }, { text: "↑", state: "" }, { text: "↑", state: "" }],
          voice: `まもなく経由地の${activeWaypoint.name}です。左折進入に備えて減速してください。`
        });
      } else {
        steps.push({
          icon: "🏁",
          turnAction: `${destName}周辺へ到着`,
          laneAction: "駐輪スペースを確認して減速",
          signals: 0,
          signalText: `目的地「${destName}」に到着`,
          dist: "ゴール",
          headline: `${destName} 周辺に到着！駐輪場を確認`,
          cardClass: "highlight-cyan",
          location: loc,
          lanes: [{ text: "↑", state: "" }, { text: "🏁 到着", state: "recommended" }, { text: "↑", state: "" }],
          voice: `まもなく目的地、${destName}周辺に到着します。バイクを停められる場所を探しましょう。お疲れ様でした。`
        });
      }
    } else if (mod.includes("sharp")) {
      steps.push({
        icon: "🌀",
        turnAction: `${roadName}の急カーブ`,
        laneAction: "直線区間で十分に減速",
        signals: 0,
        signalText: `急カーブ・ヘアピン警戒 (${roadName})`,
        dist: `約 ${Math.max(100, distM)}m先`,
        headline: "急カーブ注意！直線区間で十分に減速",
        cardClass: "highlight-red",
        location: loc,
        lanes: [
          { text: "⚠️ 減速", state: "curve-warn" },
          { text: "🌀 急カーブ", state: "curve-warn" },
          { text: "⚠️ 減速", state: "curve-warn" }
        ],
        voice: `この先、${roadName}に急カーブがあります。進入前の直線でしっかりスピードを落としてください。`
      });
    } else if (type === "merge") {
      steps.push({
        icon: "🔀",
        turnAction: `${roadName}へ合流`,
        laneAction: "本線の速度に合わせて加速合流",
        signals: 0,
        signalText: `本線合流ポイント (${roadName})`,
        dist: `約 ${Math.max(120, distM)}m先`,
        headline: "合流注意！本線の車両速度に合わせて加速",
        cardClass: "highlight-amber",
        location: loc,
        lanes: [
          { text: "🔀 合流", state: "parked-warn" },
          { text: "↑ 本線", state: "recommended" },
          { text: "↑", state: "" }
        ],
        voice: `まもなく${roadName}へ合流します。死角に注意し、本線の流れに合わせてスムーズに合流しましょう。`
      });
    } else if (mod.includes("right")) {
      steps.push({
        icon: "↱",
        turnAction: `${roadName}へ右折`,
        laneAction: "一番右の車線へ移動",
        signals: 2,
        signalText: `この先で右折 (${roadName})`,
        dist: `約 ${Math.max(150, distM)}m先`,
        headline: "今のうちに一番右の車線へ移動",
        cardClass: "highlight-green",
        location: loc,
        lanes: [
          { text: "↑", state: "" },
          { text: "↑", state: "" },
          { text: "↱ 右折", state: "recommended" }
        ],
        voice: `${destName}方面へ、${roadName}を右折します。早めに一番右の車線へ寄っておきましょう。`
      });
    } else if (mod.includes("left")) {
      const isUrban = distM < 600;
      steps.push({
        icon: isUrban ? "⚠️" : "↰",
        turnAction: `${roadName}へ左折`,
        laneAction: isUrban ? "路駐に注意しつつ左折準備" : "左車線へ移動して左折準備",
        signals: isUrban ? 2 : 1,
        signalText: isUrban ? `この先で左折 (${roadName}・路駐警戒)` : `この先で左折 (${roadName})`,
        dist: `約 ${Math.max(100, distM)}m先`,
        headline: isUrban ? "路駐注意！真ん中キープ後、直前で左へ" : "左車線へ寄って左折準備",
        cardClass: isUrban ? "highlight-amber" : "highlight-green",
        location: loc,
        lanes: isUrban
          ? [{ text: "⚠️ 路駐", state: "parked-warn" }, { text: "↑ キープ", state: "recommended" }, { text: "↑", state: "" }]
          : [{ text: "↰ 左折", state: "recommended" }, { text: "↑", state: "" }, { text: "↑", state: "" }],
        voice: isUrban
          ? `この先、${roadName}へ左折しますが、左車線に路上駐車がある可能性があります。直前まで真ん中を走りましょう。`
          : `この先、${roadName}へ左折します。左後方を確認して左車線へ移動してください。`
      });
    }
  });

  if (steps.length === 0) {
    steps.push({
      icon: "↑",
      turnAction: "道なり直進",
      laneAction: "走行車線をキープ",
      signals: 0,
      signalText: `${destName}へ案内開始`,
      dist: `総距離 ${totalKm}km`,
      headline: "道なり直進！体感温度と横風に注意",
      cardClass: "highlight-cyan",
      location: null,
      lanes: [{ text: "↑", state: "" }, { text: "↑ 直進", state: "recommended" }, { text: "↑", state: "" }],
      voice: `${destName}まで総距離${totalKm}キロのルートを設定しました。安全運転で出発しましょう。`
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
// 13. 4段階シビア車線誘導（高速70km/h以上は自動2倍）＆ GPS精度フィルタ付リルート
// ==========================================
function evaluateLiveNavigation(lat, lng, speedKmh, gpsAccuracyM = 10) {
  if (!isRouteActive || generatedSteps.length === 0) return;

  if (activeDestCoord) {
    const distToDestM = haversineKm(lat, lng, activeDestCoord.lat, activeDestCoord.lng) * 1000;
    const estSpeedMs = Math.max(8.3, (speedKmh || 35) / 3.6);
    updateEtaDisplay(distToDestM, distToDestM / estSpeedMs);
  }

  const eff = getEffectiveNavDistances();

  const curStep = generatedSteps[currentStepIdx];
  if (curStep && curStep.location) {
    const stepLng = curStep.location[0];
    const stepLat = curStep.location[1];
    const distM = Math.round(haversineKm(lat, lng, stepLat, stepLng) * 1000);

    document.getElementById("distTag").textContent = distM >= 1000
      ? `あと ${(distM / 1000).toFixed(1)}km`
      : `あと ${distM}m`;

    const action = curStep.turnAction || curStep.headline;
    const laneMsg = curStep.laneAction || curStep.headline;
    const passThreshold = eff.mult === 2 ? 45 : 28;

    if (distM <= eff.s1 && distM > eff.s2 && !curStep._announcedStage1) {
      curStep._announcedStage1 = true;
      const msg = `およそ${formatJapaneseMeters(eff.s1)}先、${action}です。今のうちに${laneMsg}。`;
      document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
      speakJapanese(msg);
    } else if (distM <= eff.s2 && distM > eff.s3 && !curStep._announcedStage2) {
      curStep._announcedStage2 = true;
      const msg = `あと${formatJapaneseMeters(eff.s2)}で${action}です。${laneMsg}。`;
      document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
      speakJapanese(msg);
    } else if (distM <= eff.s3 && distM > eff.s4 && !curStep._announcedStage3) {
      curStep._announcedStage3 = true;
      const msg = `あと${formatJapaneseMeters(eff.s3)}、${action}の準備をしてください。`;
      document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
      speakJapanese(msg);
    } else if (distM <= eff.s4 && distM > passThreshold && !curStep._announcedStage4) {
      curStep._announcedStage4 = true;
      const msg = `まもなく${formatJapaneseMeters(eff.s4)}先、${action}です。`;
      document.getElementById("voiceSubtitle").textContent = `「${msg}」`;
      speakJapanese(msg);
    } else if (distM <= passThreshold && currentStepIdx < generatedSteps.length - 1) {
      currentStepIdx++;
      applyGeneratedStep(currentStepIdx, true);
    }
  }

  if (gpsAccuracyM > MAX_ACCEPTABLE_GPS_ACCURACY_M) {
    offRouteStreakCount = 0;
    return;
  }

  if (routeCoordinates.length > 2 && Date.now() - lastRerouteTime > 10000) {
    let minDistM = Infinity;
    for (let i = 0; i < routeCoordinates.length; i += 2) {
      const d = haversineKm(lat, lng, routeCoordinates[i][1], routeCoordinates[i][0]) * 1000;
      if (d < minDistM) minDistM = d;
    }

    if (minDistM > eff.reroute) {
      offRouteStreakCount++;
      if (offRouteStreakCount >= 2) {
        offRouteStreakCount = 0;
        lastRerouteTime = Date.now();
        const msg = `ルートから${Math.round(minDistM)}メートル外れました。現在地から再計算します。`;
        document.getElementById("voiceSubtitle").textContent = `🔄 ${msg}`;
        speakJapanese(msg);
        searchAndRoute(true);
      }
    } else {
      offRouteStreakCount = 0;
    }
  }
}

// ==========================================
// 14. 周辺スポット検索＆経由地組み込み (Overpass API)
// ==========================================
async function searchNearbyPOI(type, setAsWaypoint = false) {
  setNorenOpen(false);
  const labels = { fuel: "ガソリンスタンド", convenience: "コンビニ", toilets: "トイレ・休憩所" };
  const icons = { fuel: "⛽", convenience: "🏪", toilets: "🚻" };
  const tagMap = {
    fuel: `node["amenity"="fuel"](around:3500,${currentLat},${currentLng});`,
    convenience: `node["shop"="convenience"](around:3000,${currentLat},${currentLng});`,
    toilets: `node["amenity"="toilets"](around:3500,${currentLat},${currentLng});`
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

    data.elements.sort((a, b) =>
      haversineKm(currentLat, currentLng, a.lat, a.lon) - haversineKm(currentLat, currentLng, b.lat, b.lon)
    );

    data.elements.forEach(el => {
      const name = (el.tags && el.tags.name) ? el.tags.name : labels[type];
      const m = new maplibregl.Marker({ color: "#ffab00" })
        .setLngLat([el.lon, el.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<b>${icons[type]} ${name}</b>`))
        .addTo(map);
      poiMarkers.push(m);
    });

    const nearest = data.elements[0];
    const nearestName = (nearest.tags && nearest.tags.name) ? nearest.tags.name : labels[type];

    if (setAsWaypoint && isRouteActive && activeDestCoord) {
      activeWaypoint = { name: nearestName, lat: nearest.lat, lng: nearest.lon };
      speakJapanese(`最寄りの${nearestName}を経由地に追加してルートを再計算します。`);
      searchAndRoute(true);
      return;
    }

    autoFollow = false;
    document.getElementById("recenterBtn").classList.add("active");
    map.easeTo({ center: [nearest.lon, nearest.lat], zoom: 15 });
    speakJapanese(`近くに${data.elements.length}件の${labels[type]}が見つかりました。一番近いのは${nearestName}です。`);
  } catch (e) {
    speakJapanese("スポット検索に失敗しました。通信状況を確認してください。");
  }
}

// ==========================================
// 15. マイガレージ（案内設定・お気に入り・履歴・称号）
// ==========================================
function openGarageModal(tab = "settings") {
  switchGarageTab(tab);
  syncSettingsSlidersUI();
  renderFavorites();
  renderHistory();
  renderBadges();
  updateLiveStatsUI();
  document.getElementById("garageModal").classList.add("open");
}

function switchGarageTab(tab) {
  ["settings", "fav", "log", "badge"].forEach(t => {
    const cap = t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(`tabBtn${cap}`).classList.toggle("active", t === tab);
    document.getElementById(`pane${cap}`).classList.toggle("active", t === tab);
  });
}

function renderFavorites() {
  const box = document.getElementById("favListContainer");
  if (favoriteSpots.length === 0) {
    box.innerHTML = `<div style="color:#94a3b8;font-size:12px;">登録スポットはまだありません</div>`;
    return;
  }
  box.innerHTML = favoriteSpots.map((name, idx) => `
    <div class="fav-item">
      <div class="fav-name">📍 ${name}</div>
      <div class="fav-actions">
        <button class="mini-go-btn" onclick="goToFavorite(${idx})">出発</button>
        <button class="mini-del-btn" onclick="deleteFavorite(${idx})">削除</button>
      </div>
    </div>
  `).join("");
}

function addFavoriteSpot() {
  const input = document.getElementById("newFavInput");
  const val = input.value.trim();
  if (!val) return;
  favoriteSpots.unshift(val);
  localStorage.setItem("apex_favs", JSON.stringify(favoriteSpots));
  input.value = "";
  renderFavorites();
}

function deleteFavorite(idx) {
  favoriteSpots.splice(idx, 1);
  localStorage.setItem("apex_favs", JSON.stringify(favoriteSpots));
  renderFavorites();
}

function goToFavorite(idx) {
  const spot = favoriteSpots[idx];
  closeModals();
  document.getElementById("destInput").value = spot;
  searchAndRoute();
}

function updateLiveStatsUI() {
  const elapsedMin = Math.floor((Date.now() - rideStartTime) / 60000);
  const hh = String(Math.floor(elapsedMin / 60)).padStart(2, "0");
  const mm = String(elapsedMin % 60).padStart(2, "0");
  document.getElementById("statDist").textContent = `${totalDistanceKm.toFixed(1)} km`;
  document.getElementById("statTime").textContent = `${hh}:${mm}`;
  document.getElementById("statMaxSpeed").textContent = `${maxSpeedKmh} km/h`;
  document.getElementById("statMaxLean").textContent = `L${maxLeanLeft}° / R${maxLeanRight}°`;
}

function saveCurrentRideHistory() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  rideHistory.unshift({
    date: dateStr,
    dest: activeDestName || "フリーツーリング",
    dist: totalDistanceKm.toFixed(1),
    maxSpeed: maxSpeedKmh,
    maxLean: `L${maxLeanLeft}°/R${maxLeanRight}°`
  });
  localStorage.setItem("apex_history", JSON.stringify(rideHistory.slice(0, 30)));
  renderHistory();
  speakJapanese("今回の走行ログをマイガレージに保存しました。");
}

function renderHistory() {
  const box = document.getElementById("historyListContainer");
  if (rideHistory.length === 0) {
    box.innerHTML = `<div style="color:#94a3b8;font-size:12px;">保存された履歴はまだありません</div>`;
    return;
  }
  box.innerHTML = rideHistory.map(h => `
    <div class="hist-item">
      <div class="hist-date">${h.date} ・ ${h.dest}</div>
      <div class="hist-meta">距離: ${h.dist}km / 最高速: ${h.maxSpeed}km/h / 最大バンク: ${h.maxLean}</div>
    </div>
  `).join("");
}

function renderBadges() {
  const box = document.getElementById("badgeGridContainer");
  box.innerHTML = RIDER_BADGES.map(b => {
    const isUnlocked = Boolean(unlockedBadges[b.id]);
    return `
      <div class="badge-card ${isUnlocked ? "unlocked" : ""}">
        <div class="badge-icon">${b.icon}</div>
        <div class="badge-title">${b.title}</div>
        <div class="badge-desc">${b.desc}</div>
      </div>
    `;
  }).join("");
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
  updateLiveStatsUI();
}

// ==========================================
// 16. 実GPS・ジャイロ・画面スリープ防止
// ==========================================
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
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
    if (absLean >= 25) unlockBadge("corner_25");

    document.getElementById("leanVal").textContent = `${dir}${absLean}°`;
    document.getElementById("leanMax").textContent = `MAX L${maxLeanLeft}° / R${maxLeanRight}°`;
  });
}

function toggleGPS() {
  if (isSimActive) stopSimulationMode();

  if (!("geolocation" in navigator)) {
    alert("このブラウザはGPSに対応していません。");
    return;
  }

  if (isGpsActive) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    isGpsActive = false;
    isHighwaySpeedMode = false;
    updateSpeedModeHUD(0);
    document.getElementById("gpsToggleBtn").classList.remove("gps-on");
    document.getElementById("gpsBtnLabel").textContent = "📡 GPS開始";
    document.getElementById("gpsBtnSub").textContent = "自動案内＆リルート";
    document.getElementById("gpsDot").className = "gps-status-dot";
    document.getElementById("gpsStatusText").textContent = "GPS停止中";
    return;
  }

  requestWakeLock();
  enableGyroSensors();
  document.getElementById("gpsStatusText").textContent = "測位中...";

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      isGpsActive = true;
      unlockBadge("first_gps");
      const { latitude, longitude, speed, heading, altitude, accuracy } = pos.coords;
      const kmh = speed !== null && speed >= 0 ? speed * 3.6 : 0;

      processPositionUpdate({
        latitude,
        longitude,
        speedKmh: kmh,
        headingDeg: (heading !== null && !isNaN(heading) && speed > 1.2) ? heading : null,
        altitudeM: altitude,
        accuracyM: accuracy || 10
      });
    },
    () => {
      document.getElementById("gpsStatusText").textContent = "GPS未許可";
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

// ==========================================
// 17. ユーティリティ・デモ・モーダル制御
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
    turnAction: "幹線道路へ右折",
    laneAction: "一番右の車線へ移動",
    signals: 2, signalText: "【デモ】1000m先から右折誘導", dist: "あと 1000m",
    headline: "今のうちに一番右の車線へ移動", cardClass: "highlight-green",
    location: null,
    lanes: [{ text: "↑", state: "" }, { text: "↑", state: "" }, { text: "↱ 右折", state: "recommended" }],
    voice: "およそ1キロ先、右折です。今のうちに一番右の車線へ移動しておきましょう。"
  },
  {
    icon: "⚠️",
    turnAction: "次の交差点を左折",
    laneAction: "路駐を避けて真ん中車線をキープ",
    signals: 2, signalText: "【デモ】500m先で左折 (路駐警戒)", dist: "あと 500m",
    headline: "路駐多発！真ん中車線をキープ", cardClass: "highlight-amber",
    location: null,
    lanes: [{ text: "⚠️ 路駐", state: "parked-warn" }, { text: "↑ キープ", state: "recommended" }, { text: "↑", state: "" }],
    voice: "あと500メートルで左折ですが、左車線に路上駐車があります。直前まで真ん中の車線をキープしてください。"
  },
  {
    icon: "🌀",
    turnAction: "急カーブ・ヘアピン進入",
    laneAction: "直線区間で十分に減速",
    signals: 0, signalText: "【デモ】200m先 急カーブ警戒", dist: "あと 200m",
    headline: "急カーブ注意！直線区間で十分に減速", cardClass: "highlight-red",
    location: null,
    lanes: [{ text: "⚠️ 減速", state: "curve-warn" }, { text: "🌀 急カーブ", state: "curve-warn" }, { text: "⚠️ 減速", state: "curve-warn" }],
    voice: "あと200メートル、急カーブがあります。進入前の直線でしっかりスピードを落としてください。"
  }
];

function selectScenario(idx) {
  activeDestName = "";
  generatedSteps = demoScenarios;
  currentStepIdx = idx;
  activateNavModeUI();
  document.querySelectorAll(".chip-btn").forEach(b => {
    if (b.id !== "quickThemeBtn" && b.id !== "quickSimBtn") b.classList.remove("active");
  });
  const btn = document.getElementById(`demoBtn${idx}`);
  if (btn) btn.classList.add("active");
  applyGeneratedStep(idx, true);
}

function handleMainLeftBtn() {
  if (!isRouteActive || generatedSteps.length === 0) {
    startVoiceCommand();
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
  document.getElementById("garageModal").classList.remove("open");
  document.getElementById("sosModal").classList.remove("open");
}

// ==========================================
// 18. 初期起動処理
// ==========================================
resetToStandbyMode();
syncThemeButtonsUI();
syncSettingsSlidersUI();
fetchRealWeather(currentLat, currentLng, "横浜・みなとみらい付近");

window.addEventListener("load", () => {
  let done = false;
  try { done = localStorage.getItem("apex_navi_tut_done") === "1"; } catch (e) {}
  if (!done) openTutorial(0);
});