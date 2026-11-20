/* =========================================================
   祁煜 0306 · 全球大屏应援潮汐图
   引擎：点阵世界地图（纯代码绘制，零图片文件）
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量与工具 ---------------- */
  const D2R = Math.PI / 180;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  const mx = (lon) => lon * D2R;
  const my = (lat) => Math.log(Math.tan(Math.PI / 4 + clamp(lat, -84, 84) * D2R / 2));
  const invMy = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R;

  const COL = {
    pink: [255, 77, 157],       // 主色
    pinkHot: [255, 154, 200],
    pinkPale: [255, 211, 232],
    violet: [162, 107, 255],     // 辅色
    blue: [74, 133, 255],        // 辅色
    amber: [255, 180, 92],       // 仅用于「待核实」警示
    foam: [246, 240, 255]
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function hueOf(kind) {
    if (kind === 'screen' || kind === 'taxi' || kind === 'fleet') return COL.pink;
    if (kind === 'popup' || kind === 'transit') return COL.violet;
    if (kind === 'online') return COL.blue;
    return COL.blue;
  }

  /* ---------------- DOM ---------------- */
  const canvas = $('#map');
  const ctx = canvas.getContext('2d', { alpha: false });
  const el = {
    stats: $('#stats'),
    hud: $('#hud'),
    panel: $('#panel'),
    panelBody: $('#panelBody'),
    panelClose: $('#panelClose'),
    scrub: $('#scrub'),
    scrubFill: $('#scrubFill'),
    scrubHandle: $('#scrubHandle'),
    scrubTicks: $('#scrubTicks'),
    tlDate: $('#tlDate'),
    tlSub: $('#tlSub'),
    listview: $('#listview'),
    toast: $('#toast'),
    hint: $('#hint'),
    settings: $('#settings'),
    btnList: $('#btnList'),
    btnSettings: $('#btnSettings'),
    btnTheme: $('#btnTheme'),
    themeSeg: $('#themeSeg'),
    themeVal: $('#themeVal'),
    themeHint: $('#themeHint'),
    btnWorld: $('#btnWorld'),
    btnChina: $('#btnChina'),
    btnZoomIn: $('#btnZoomIn'),
    btnZoomOut: $('#btnZoomOut'),
    search: $('#search'),
    chipsKind: $('#chipsKind'),
    chipsStatus: $('#chipsStatus'),
    progressFill: $('#progressFill'),
    progressVal: $('#progressVal'),
    btnReset: $('#btnReset'),
    glassRange: $('#glassRange'),
    glassVal: $('#glassVal'),
    toggleMotion: $('#toggleMotion'),
    toggleContrast: $('#toggleContrast'),
    jumps: $('#jumps')
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    cam: { x: mx(70), y: my(14), s: 230 },
    target: null,                       // 补间目标
    dragging: false,
    pointers: new Map(),
    vel: { x: 0, y: 0 },
    lastMove: null,
    moved: false,
    hover: null,
    selected: null,
    selectedGroup: null,
    date: new Date('2026-03-06T00:00:00'),
    kindFilter: new Set(Object.keys(KINDS)),
    statusFilter: 'all',
    query: '',
    checked: new Set(),
    waves: [],
    beams: [],
    reducedMotion: false,
    highContrast: false,
    theme: 'ivory',
    intro: 0,
    view: 'map'
  };

  const T_START = new Date('2025-01-01T00:00:00').getTime();
  const T_END = new Date('2026-12-31T00:00:00').getTime();

  try {
    const saved = JSON.parse(localStorage.getItem('qiyu-tide-checked') || '[]');
    if (Array.isArray(saved)) saved.forEach((id) => state.checked.add(id));
  } catch (e) { /* 忽略存储异常 */ }

  /* ---------------- 陆地点阵 ---------------- */
  const DOTS = (function buildDots() {
    const out = [];
    LAND_MASK.forEach((row) => {
      const parts = row.split('|');
      const lat = parseFloat(parts[0]);
      const y = my(lat);
      for (let s = 1; s < parts.length; s++) {
        const ab = parts[s].split(',');
        const c0 = Math.round((parseFloat(ab[0]) + 180) / 2.5);
        const c1 = Math.round((parseFloat(ab[1]) + 180) / 2.5);
        for (let c = c0; c <= c1; c++) {
          const lon = c * 2.5 - 180;
          out.push({ x: mx(lon), y, lat, lon });
        }
      }
    });
    return out;
  })();

  /* ---------------- 画布尺寸 ---------------- */
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (typeof layoutTicks === 'function') layoutTicks();
  }
  window.addEventListener('resize', resize);

  const sMin = () => Math.max(W / (2 * Math.PI) * 0.92, H / 3.4);
  const sMax = () => 1700;
  /* s = 像素 / 墨卡托弧度。1° 经度 = 0.017453 弧度 ⇒ 每像素 = 1/(s*0.017453) 度 */
  const pxPerDeg = () => state.cam.s * 0.017453;
  /* 标记物的屏幕尺寸基准：随缩放温和变化，不喧宾夺主 */
  const markerScale = () => clamp(.62 + Math.log2(Math.max(state.cam.s, 1) / 400) * .17, .62, 1.85);
  const toScreenX = (wx) => (wx - state.cam.x) * state.cam.s + W / 2;
  const toScreenY = (wy) => (wy - state.cam.y) * state.cam.s + H / 2;
  const toWorldX = (sx) => (sx - W / 2) / state.cam.s + state.cam.x;
  const toWorldY = (sy) => (sy - H / 2) / state.cam.s + state.cam.y;

  /* ---------------- 过滤与状态 ---------------- */
  function statusOf(v) {
    const d = state.date.getTime();
    const s = new Date(v.start + 'T00:00:00').getTime();
    const e = new Date(v.end + 'T23:59:59').getTime();
    if (v.tier === 'reported') return 'reported';
    if (d < s) return 'future';
    if (d > e) return 'past';
    return 'lit';
  }
  function matchQuery(v) {
    if (!state.query) return true;
    const q = state.query.toLowerCase();
    return (v.city + ' ' + v.name + ' ' + (v.addr || '')).toLowerCase().includes(q);
  }
  function visibleVenues() {
    return VENUES.filter((v) => {
      if (!state.kindFilter.has(v.kind)) return false;
      if (!matchQuery(v)) return false;
      const st = statusOf(v);
      if (state.statusFilter !== 'all' && st !== state.statusFilter) return false;
      return true;
    });
  }

  /* =========================================================
     渲染
     ========================================================= */
  let raf = 0, lastT = 0;

  function draw(now) {
    const t = now || 0;
    ctx.fillStyle = '#04080F';
    ctx.fillRect(0, 0, W, H);

    drawDepth(t);
    if (state.intro < 1) drawDots(t, state.intro);
    else drawDots(t, 1);
    drawGlow(t);
    drawBeams(t);
    drawMarkers(t);
    drawLabels(t);
  }

  /* 深海底色 + 流动光斑 */
  function drawDepth(t) {
    const deep = THEMES[state.theme].deep;
    const g = ctx.createRadialGradient(W * .5, H * .42, 0, W * .5, H * .42, Math.max(W, H) * .82);
    g.addColorStop(0, deep[0]);
    g.addColorStop(.52, deep[1]);
    g.addColorStop(1, deep[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (state.reducedMotion) return;
    const tt = t * 0.00004;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const px = W * (.5 + .40 * Math.sin(tt * (.7 + i * .11) + i * 2.1));
      const py = H * (.5 + .36 * Math.cos(tt * (.53 + i * .09) + i * 1.7));
      const rad = Math.max(W, H) * (.30 + .07 * Math.sin(tt * .9 + i));
      const rg = ctx.createRadialGradient(px, py, 0, px, py, rad);
      rg.addColorStop(0, rgba([92, 44, 140], .20));
      rg.addColorStop(.55, rgba([58, 26, 108], .08));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  /* 经纬网 */
  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = THEMES[state.theme].grid;
    ctx.lineWidth = 1;
    const spacing = 20 * pxPerDeg();
    if (spacing > 18) {
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 20) {
        const x = Math.round(toScreenX(mx(lon))) + .5;
        if (x < -20 || x > W + 20) continue;
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
      }
      for (let lat = -80; lat <= 80; lat += 20) {
        const y = Math.round(toScreenY(my(lat))) + .5;
        if (y < -20 || y > H + 20) continue;
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 陆地点阵（受光点影响而染色） */
  function drawDots(t, intro) {
    drawGrid();
    const s = state.cam.s;
    const spacing = 2.5 * pxPerDeg();
    const terrain = spacing > 22;                       // 放大后改用柔和地形光晕
    const size = terrain ? Math.min(spacing * .80, 130) : clamp(spacing * .24, 1.1, 4.6);
    const half = size / 2;

    // 收集光源：让粉色灯光浸染周围的陆地光点
    const lights = [];
    const vis = visibleVenues();
    for (const v of vis) {
      const st = statusOf(v);
      if (st !== 'lit') continue;
      const rad = clamp(155 / s, 0.04, 1.4);   // 墨卡托弧度（≈155px）
      lights.push({ x: mx(v.lon), y: my(v.lat), r2: rad * rad, c: hueOf(v.kind) });
    }
    const waves = state.waves;
    const bandW = 46 / s;

    const BUCKETS = 9;
    const buckets = [];
    for (let i = 0; i < BUCKETS; i++) buckets.push([]);
    const soft = [];
    const land = THEMES[state.theme].land;
    const baseR = land[0], baseG = land[1], baseB = land[2];
    const baseA = terrain ? .42 : .78;

    for (let i = 0; i < DOTS.length; i++) {
      const d = DOTS[i];
      const sx = (d.x - state.cam.x) * s + W / 2;
      if (sx < -size || sx > W + size) continue;
      const sy = (d.y - state.cam.y) * s + H / 2;
      if (sy < -size || sy > H + size) continue;

      let lr = 0, lg = 0, lb = 0, lk = 0;
      for (let j = 0; j < lights.length; j++) {
        const L = lights[j];
        const dx = d.x - L.x, dy = d.y - L.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > L.r2) continue;
        const f = 1 - Math.sqrt(d2) / Math.sqrt(L.r2);
        const w = f * f;
        lr += L.c[0] * w; lg += L.c[1] * w; lb += L.c[2] * w; lk += w;
      }
      for (let j = 0; j < waves.length; j++) {
        const wv = waves[j];
        const dx = d.x - wv.x, dy = d.y - wv.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const diff = Math.abs(dist - wv.r);
        if (diff > bandW) continue;
        const g = (1 - diff / bandW) * (1 - diff / bandW) * wv.k;
        lr += COL.pinkHot[0] * g; lg += COL.pinkHot[1] * g; lb += COL.pinkHot[2] * g; lk += g;
      }

      let r = baseR, gg = baseG, b = baseB, alpha = baseA;
      if (lk > 0) {
        const m = Math.min(lk, 1.9);
        r = clamp(baseR + lr, 0, 255);
        gg = clamp(baseG + lg, 0, 255);
        b = clamp(baseB + lb, 0, 255);
        alpha = clamp(baseA + m * (terrain ? .34 : .22), 0, 1);
      }
      if (terrain) soft.push(sx, sy, r, gg, b, alpha);
      else {
        const bi = clamp(Math.floor((alpha - baseA) / (terrain ? .34 : .22) * (BUCKETS - 1)), 0, BUCKETS - 1);
        buckets[bi].push(sx, sy, r, gg, b);
      }
    }

    ctx.save();
    if (terrain) {
      // 柔光地形：相互重叠的光晕拼出大洲轮廓
      const r = half;
      for (let j = 0; j < soft.length; j += 6) {
        const x = soft[j], y = soft[j + 1];
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        const col = `${soft[j + 2] | 0},${soft[j + 3] | 0},${soft[j + 4] | 0}`;
        rg.addColorStop(0, `rgba(${col},${soft[j + 5] * intro})`);
        rg.addColorStop(.55, `rgba(${col},${soft[j + 5] * .45 * intro})`);
        rg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = rg;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    } else {
      for (let i = 0; i < BUCKETS; i++) {
        const arr = buckets[i];
        if (!arr.length) continue;
        ctx.globalAlpha = (baseA + (i / (BUCKETS - 1)) * .22) * intro;
        for (let j = 0; j < arr.length; j += 5) {
          ctx.fillStyle = `rgb(${arr[j + 2] | 0},${arr[j + 3] | 0},${arr[j + 4] | 0})`;
          ctx.fillRect(arr[j] - half, arr[j + 1] - half, size, size);
        }
      }
    }
    ctx.restore();
  }

  /* 打卡瞬间升起的光柱 */
  function drawBeams(t) {
    if (!state.beams.length) return;
    const base = markerScale();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of state.beams) {
      const age = (t - b.born) / 1100;
      if (age < 0 || age > 1) continue;
      const sx = toScreenX(b.x), sy = toScreenY(b.y);
      const h = (90 + 240 * easeOutCubic(age)) * base;
      const w = 13 * base * (1 - age * .72);
      const a = (1 - age) * .75;
      const lg = ctx.createLinearGradient(sx, sy, sx, sy - h);
      lg.addColorStop(0, rgba(COL.pinkPale, a));
      lg.addColorStop(.22, rgba(COL.pinkHot, a * .7));
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(sx - w / 2, sy - h, w, h);
      // 升空的光环
      const rr = (10 + 70 * easeOutCubic(age)) * base;
      ctx.strokeStyle = rgba(COL.pinkHot, (1 - age) * .8);
      ctx.lineWidth = 2 * base;
      ctx.beginPath(); ctx.ellipse(sx, sy - h * .55, rr, rr * .32, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /* 加色辉光层：光点 + 点亮扫过环 */
  function drawGlow(t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const v of visibleVenues()) {
      const st = statusOf(v);
      if (st === 'reported' || st === 'past') continue;
      const sx = toScreenX(mx(v.lon)), sy = toScreenY(my(v.lat));
      if (sx < -120 || sx > W + 120 || sy < -120 || sy > H + 120) continue;
      const c = hueOf(v.kind);
      const rad = clamp(34 * Math.pow(state.cam.s / 400, .30), 22, 88);
      const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      rg.addColorStop(0, rgba(c, st === 'lit' ? .58 : .20));
      rg.addColorStop(.42, rgba(c, st === 'lit' ? .18 : .06));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    }

    for (const wv of state.waves) {
      const sx = toScreenX(wv.x), sy = toScreenY(wv.y);
      const r = wv.r * state.cam.s;
      if (r > Math.max(W, H) * 2.2) continue;
      const a = wv.k * .62;
      ctx.strokeStyle = rgba(COL.pinkHot, a);
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = rgba(COL.pinkPale, a * .65);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, r * .93, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /* 光点本体 */
  function drawMarkers(t) {
    const groups = clusterPoints();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const g of groups) {
      const sx = g.x, sy = g.y;
      if (sx < -140 || sx > W + 140 || sy < -140 || sy > H + 140) continue;

      if (g.members.length > 1) { drawCluster(g, t); continue; }
      const v = g.members[0].v;
      const st = statusOf(v);
      const c = hueOf(v.kind);
      const isSel = state.selected && state.selected.id === v.id;
      const checked = state.checked.has(v.id);

      if (st === 'reported') { drawReported(v, sx, sy); continue; }
      if (st === 'past') { drawPast(v, sx, sy); continue; }
      if (st === 'future') { drawFuture(v, sx, sy, t); continue; }

      // 点亮中的信标
      const base = markerScale();
      const shaftH = 46 * base;
      const shaftW = 3.2 * base;
      const pulse = state.reducedMotion ? .5 : (Math.sin(t * .0022 + v.lon) * .5 + .5);

      // 垂直光柱
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createLinearGradient(sx, sy, sx, sy - shaftH);
      lg.addColorStop(0, rgba(c, .62));
      lg.addColorStop(.35, rgba(c, .24));
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(sx - shaftW / 2, sy - shaftH, shaftW, shaftH);
      ctx.restore();

      // 声纳环
      if (!state.reducedMotion) {
        const phase = ((((t * .00016) + (Math.abs(v.lon) % 10) / 10) % 1) + 1) % 1;
        const rr = Math.max(.6, 6 + phase * (34 * base));
        ctx.strokeStyle = rgba(c, (1 - phase) * .42);
        ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.stroke();
      }

      // 核心
      const coreR = 2.6 * base;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(sx, sy, coreR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(c, .55 + pulse * .3);
      ctx.beginPath(); ctx.arc(sx, sy, coreR * 2.1, 0, Math.PI * 2); ctx.fill();

      if (checked) drawCheckRing(sx, sy, 8 * base, t);
      if (isSel) drawSelectRing(sx, sy, 13 * base, t);
    }
    ctx.restore();
  }

  function drawCheckRing(sx, sy, r, t) {
    ctx.save();
    ctx.strokeStyle = rgba(COL.pinkHot, .9);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = rgba(COL.pinkPale, .95);
    ctx.beginPath(); ctx.arc(sx, sy - r - 5, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawSelectRing(sx, sy, r, t) {
    ctx.save();
    const rot = state.reducedMotion ? 0 : t * .0006;
    ctx.translate(sx, sy); ctx.rotate(rot);
    ctx.strokeStyle = rgba(COL.pinkHot, .95);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = rgba(COL.pinkHot, .3);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawCluster(g, t) {
    const n = g.members.length;
    const base = markerScale();
    const r = (10 + Math.min(n, 14) * 1.0) * base;
    const sx = g.x, sy = g.y;

    ctx.save();
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.8);
    rg.addColorStop(0, rgba(COL.pink, .30));
    rg.addColorStop(.5, rgba(COL.violet, .12));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rg;
    ctx.fillRect(sx - r * 2.8, sy - r * 2.8, r * 5.6, r * 5.6);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(14,7,28,.78)';
    ctx.strokeStyle = rgba(COL.pinkHot, .55);
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = rgba(COL.pink, .85);
    ctx.lineWidth = 1.8;
    const a0 = state.reducedMotion ? 0 : t * .0009;
    ctx.beginPath(); ctx.arc(sx, sy, r + 3.5, a0, a0 + 1.15); ctx.stroke();
    ctx.fillStyle = '#F6F0FF';
    ctx.font = `700 ${Math.round(12 * base)}px 'Archivo', system-ui, sans-serif`;
    ctx.fillText(String(n), sx, sy + .5);
    ctx.restore();
  }

  function drawPast(v, sx, sy) {
    const base = markerScale();
    ctx.save();
    ctx.fillStyle = 'rgba(176,163,207,.34)';
    ctx.beginPath(); ctx.arc(sx, sy, 1.9 * base, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(176,163,207,.26)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy, 5.4 * base, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawFuture(v, sx, sy, t) {
    const base = markerScale();
    const c = hueOf(v.kind);
    ctx.save();
    ctx.strokeStyle = rgba(c, .40);
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(sx, sy, 4.6 * base, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(c, .55);
    ctx.beginPath(); ctx.arc(sx, sy, 1.5 * base, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawReported(v, sx, sy) {
    const base = markerScale();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,180,92,.5)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.arc(sx, sy, 4.2 * base, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,180,92,.34)';
    ctx.beginPath(); ctx.arc(sx, sy, 1.3 * base, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* 城市标签 */
  function drawLabels(t) {
    const s = state.cam.s;
    if (s < 240) return;
    const groups = clusterPoints();
    ctx.save();
    ctx.font = "500 11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const g of groups) {
      if (g.members.length > 1) continue;
      const v = g.members[0].v;
      const st = statusOf(v);
      if (st === 'past' || st === 'reported') continue;
      const sx = g.x, sy = g.y;
      if (sx < -60 || sx > W + 60) continue;
      const label = v.city;
      const wpx = ctx.measureText(label).width;
      const base = markerScale();
      ctx.fillStyle = 'rgba(8,4,18,.72)';
      ctx.fillRect(sx + 9 * base - 2, sy - 9 * base, wpx + 8, 17 * base);
      ctx.fillStyle = st === 'lit' ? 'rgba(246,240,255,.95)' : 'rgba(176,163,207,.75)';
      ctx.fillText(label, sx + 9 * base + 2, sy - .5 * base);
    }
    ctx.restore();
  }

  /* 聚类 */
  let clusterCache = null, clusterKey = '';
  function clusterPoints() {
    const key = state.cam.x.toFixed(4) + '|' + state.cam.y.toFixed(4) + '|' + state.cam.s.toFixed(3) + '|' + state.date.getTime() + '|' + state.statusFilter + '|' + state.query + '|' + state.kindFilter.size + '|' + [...state.kindFilter].join(',');
    if (clusterKey === key && clusterCache) return clusterCache;
    const items = [];
    for (const v of visibleVenues()) {
      const sx = toScreenX(mx(v.lon)), sy = toScreenY(my(v.lat));
      items.push({ v, sx, sy });
    }
    items.sort((a, b) => a.sx - b.sx);
    const out = [];
    const R = 34;
    const used = new Array(items.length).fill(false);
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const members = [items[i]];
      used[i] = true;
      for (let j = i + 1; j < items.length; j++) {
        if (used[j]) continue;
        const dx = items[j].sx - items[i].sx, dy = items[j].sy - items[i].sy;
        if (dx * dx + dy * dy < R * R) { members.push(items[j]); used[j] = true; }
      }
      let cx = 0, cy = 0;
      members.forEach((m) => { cx += m.sx; cy += m.sy; });
      out.push({ x: cx / members.length, y: cy / members.length, members });
    }
    clusterCache = out; clusterKey = key;
    return out;
  }

  /* =========================================================
     交互：拖拽 / 缩放 / 点击
     ========================================================= */
  function onPointerDown(e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 环境不支持指针捕获时忽略 */ }
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (state.pointers.size === 1) {
      state.dragging = true;
      state.moved = false;
      state.lastMove = { x: e.clientX, y: e.clientY, t: performance.now() };
      state.vel = { x: 0, y: 0 };
      canvas.classList.add('is-dragging');
      hideHint();
    } else if (state.pointers.size === 2) {
      state.dragging = false;
      state.pinch = pinchDist();
    }
  }

  function pinchDist() {
    const p = [...state.pointers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  function onPointerMove(e) {
    const p = state.pointers.get(e.pointerId);
    if (!p) { updateHover(e.clientX, e.clientY); return; }
    p.x = e.clientX; p.y = e.clientY;

    if (state.pointers.size === 2) {
      const d = pinchDist();
      if (state.pinch) {
        const factor = d / state.pinch;
        const rect = canvas.getBoundingClientRect();
        const cx = (state.pointers.get([...state.pointers.keys()][0]).x + state.pointers.get([...state.pointers.keys()][1]).x) / 2 - rect.left;
        const cy = (state.pointers.get([...state.pointers.keys()][0]).y + state.pointers.get([...state.pointers.keys()][1]).y) / 2 - rect.top;
        zoomAt(cx, cy, factor);
      }
      state.pinch = d;
      return;
    }

    if (!state.dragging) return;
    const dx = e.clientX - state.lastMove.x;
    const dy = e.clientY - state.lastMove.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true;
    state.cam.x -= dx / state.cam.s;
    state.cam.y -= dy / state.cam.s;
    const now = performance.now();
    const dt = Math.max(now - state.lastMove.t, 1);
    state.vel.x = -(dx / state.cam.s) / dt * 16;
    state.vel.y = -(dy / state.cam.s) / dt * 16;
    state.lastMove = { x: e.clientX, y: e.clientY, t: now };
    state.target = null;
  }

  function onPointerUp(e) {
    state.pointers.delete(e.pointerId);
    if (state.pointers.size < 2) state.pinch = null;
    if (!state.dragging) return;
    state.dragging = false;
    canvas.classList.remove('is-dragging');
    if (!state.moved) {
      const rect = canvas.getBoundingClientRect();
      handlePick(e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  function handlePick(sx, sy) {
    const groups = clusterPoints();
    let best = null, bestD = 30;
    for (const g of groups) {
      const d = Math.hypot(g.x - sx, g.y - sy);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (!best) { closePanel(); return; }
    if (best.members.length > 1) {
      // 先放大分离，仍重叠则列出该组
      const need = separateScale(best.members);
      if (need && state.cam.s < sMax() * .98) {
        flyTo(best.x, best.y, Math.min(sMax(), need), 760);
      }
      openGroup(best.members.map((m) => m.v));
    } else {
      selectVenue(best.members[0].v, true);
    }
  }

  function separateScale(members) {
    let need = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const dx = mx(members[i].v.lon) - mx(members[j].v.lon);
        const dy = my(members[i].v.lat) - my(members[j].v.lat);
        const d = Math.hypot(dx, dy);
        if (d > 1e-6) need = Math.max(need, 70 / d);
      }
    }
    return need ? need : null;
  }

  function updateHover(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    const sx = cx - rect.left, sy = cy - rect.top;
    const groups = clusterPoints();
    let hit = false;
    for (const g of groups) {
      if (Math.hypot(g.x - sx, g.y - sy) < 26) { hit = true; break; }
    }
    if (hit !== state.hover) {
      state.hover = hit;
      canvas.classList.toggle('is-over-marker', hit);
    }
  }

  function zoomAt(cx, cy, factor) {
    const before = { x: toWorldX(cx), y: toWorldY(cy) };
    state.cam.s = clamp(state.cam.s * factor, sMin(), sMax());
    const after = { x: toWorldX(cx), y: toWorldY(cy) };
    state.cam.x += before.x - after.x;
    state.cam.y += before.y - after.y;
    state.target = null;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => { state.hover = null; canvas.classList.remove('is-over-marker'); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * .0016));
    hideHint();
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, 1.9);
  });

  /* 惯性 */
  function applyInertia() {
    if (state.dragging || state.target) return;
    if (Math.abs(state.vel.x) < 0.000002 && Math.abs(state.vel.y) < 0.000002) return;
    state.cam.x += state.vel.x;
    state.cam.y += state.vel.y;
    state.vel.x *= .93;
    state.vel.y *= .93;
  }

  /* 相机补间 */
  function flyTo(x, y, s, dur) {
    const from = { x: state.cam.x, y: state.cam.y, s: state.cam.s };
    const to = { x, y, s: clamp(s, sMin(), sMax()) };
    const t0 = performance.now();
    state.target = to;
    (function step(now) {
      const k = clamp((now - t0) / dur, 0, 1);
      const e = easeInOut(k);
      state.cam.x = lerp(from.x, to.x, e);
      state.cam.y = lerp(from.y, to.y, e);
      state.cam.s = lerp(from.s, to.s, e);
      if (k < 1) requestAnimationFrame(step);
      else state.target = null;
    })(t0);
  }

  /* =========================================================
     面板
     ========================================================= */
  const ICONS = {
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 2.6 13.9 9l6.4 1.9-6.4 1.9L12 19.2 10.1 12.8 3.7 10.9 10.1 9 12 2.6Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M4.5 12.5 9.5 17.5 19.5 7"/></svg>'
  };

  function fmtDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${y}.${m}.${d}`;
  }
  function fmtRange(v) {
    const s = fmtDate(v.start), e = fmtDate(v.end);
    return s === e ? s : `${s} — ${e}`;
  }

  function openPanel(html) {
    el.panelBody.innerHTML = html;
    el.panel.classList.add('is-open');
    el.panel.setAttribute('aria-hidden', 'false');
  }
  function closePanel() {
    el.panel.classList.remove('is-open');
    el.panel.setAttribute('aria-hidden', 'true');
    state.selected = null;
    state.selectedGroup = null;
  }
  el.panelClose.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanel(); closeSettings(); }
  });

  function selectVenue(v, fly) {
    state.selected = v;
    state.selectedGroup = null;
    if (fly) flyTo(mx(v.lon), my(v.lat), Math.max(state.cam.s, 1100), 780);
    const k = KINDS[v.kind] || KINDS.screen;
    const st = statusOf(v);
    const checked = state.checked.has(v.id);
    const screens = (v.screens || []).map((s) => `
      <li class="screen">
        <span class="screen__led"></span>
        <div class="screen__body">
          <div class="screen__name">${esc(s.name)}</div>
          <div class="screen__where">${esc(s.where)}</div>
        </div>
      </li>`).join('');

    openPanel(`
      <div class="panel__eyebrow">
        <span class="tag tag--city">${esc(v.city)}</span>
        <span class="tag${v.kind === 'screen' || v.kind === 'taxi' || v.kind === 'fleet' ? ' tag--flame' : ''}">${esc(k.label)}</span>
        ${v.tier === 'reported' ? '<span class="tag tag--warn">状态待核实</span>' : ''}
        ${st === 'past' ? '<span class="tag">已结束</span>' : st === 'future' ? '<span class="tag">即将投放</span>' : '<span class="tag">投放中</span>'}
      </div>
      <h2 class="panel__title">${esc(v.name)}</h2>
      ${v.quote ? `<p class="panel__quote">${esc(v.quote)}</p>` : ''}
      <p class="panel__addr">${ICONS.pin}<span>${esc(v.addr)}</span></p>

      <div class="meta">
        <div class="meta__cell">
          <span class="meta__k">投放日期</span>
          <span class="meta__v${v.tier === 'reported' ? ' is-warn' : ''}">${fmtRange(v)}</span>
        </div>
        <div class="meta__cell">
          <span class="meta__k">亮屏时段</span>
          <span class="meta__v${v.tier === 'reported' ? ' is-warn' : ''}">${esc(v.hours || '—')}</span>
        </div>
        <div class="meta__cell">
          <span class="meta__k">播放频次</span>
          <span class="meta__v${v.tier === 'reported' ? ' is-warn' : ''}">${esc(v.freq || '—')}</span>
        </div>
        <div class="meta__cell">
          <span class="meta__k">屏幕 / 点位</span>
          <span class="meta__v">${(v.screens || []).length} 处</span>
        </div>
      </div>

      ${screens ? `<div class="sec-title">具体位置 <b>${(v.screens || []).length}</b></div><ul class="screens">${screens}</ul>` : ''}

      ${v.note ? `<p class="note${v.tier === 'reported' ? ' note--warn' : ''}">${esc(v.note)}</p>` : ''}

      <button class="cta${checked ? ' is-done' : ''}" id="ctaCheck" ${v.tier === 'reported' ? 'disabled' : ''}>
        ${checked ? ICONS.check + '已点亮 · 点击取消' : ICONS.spark + '点亮这处应援'}
      </button>
    `);

    const cta = $('#ctaCheck');
    if (cta) cta.addEventListener('click', () => toggleCheck(v));
  }

  function openGroup(list) {
    state.selectedGroup = list.map((v) => v.id);
    state.selected = null;
    const cities = [...new Set(list.map((v) => v.city))];
    const head = cities.length > 1 ? `${cities.length} 城 · ${list.length} 处应援` : `${cities[0]} · 应援点位`;
    openPanel(`
      <div class="panel__eyebrow">
        ${cities.length > 1
          ? cities.slice(0, 6).map((c) => `<span class="tag tag--city">${esc(c)}</span>`).join('')
          : `<span class="tag tag--city">${esc(cities[0])}</span>`}
        <span class="tag">${list.length} 处</span>
      </div>
      <h2 class="panel__title">${esc(head)}</h2>
      <p class="panel__quote">当所有光芒汇聚成海，我们将在粉色的海洋里辨认出彼此。</p>
      <ul class="screens">
        ${list.map((v) => `
          <li class="screen" data-id="${v.id}" style="cursor:pointer">
            <span class="screen__led" style="background:linear-gradient(150deg,${hueOf(v.kind).map((c) => 'rgb(' + c + ')').join(',')},rgba(255,255,255,.2));box-shadow:none"></span>
            <div class="screen__body">
              <div class="screen__name"><span style="color:#A26BFF;font-family:'JetBrains Mono',monospace;font-size:11px;margin-right:7px">${esc(v.city)}</span>${esc(v.name)}</div>
              <div class="screen__where">${fmtRange(v)} · ${esc(v.hours || '')}</div>
            </div>
          </li>`).join('')}
      </ul>
      <p class="note">这些点位在当前缩放下彼此靠得很近。继续放大地图，或直接点击上方任意一处查看详情。</p>
    `);
    $$('#panelBody .screen').forEach((elx) => {
      elx.addEventListener('click', () => {
        const v = VENUES.find((x) => x.id === elx.getAttribute('data-id'));
        if (v) selectVenue(v, true);
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 打卡点亮 ---------------- */
  function toggleCheck(v) {
    const has = state.checked.has(v.id);
    if (has) {
      state.checked.delete(v.id);
      toast(`已取消 <b>${esc(v.city)}</b> 的点亮`);
    } else {
      state.checked.add(v.id);
      fireWave(v);
      toast(`<b>${esc(v.city)}</b> 已点亮 · 光芒正在扫过整片海`);
    }
    try { localStorage.setItem('qiyu-tide-checked', JSON.stringify([...state.checked])); } catch (e) { /* 忽略 */ }
    updateProgress();
    const cta = $('#ctaCheck');
    if (cta) {
      const nowChecked = state.checked.has(v.id);
      cta.className = 'cta' + (nowChecked ? ' is-done' : '');
      cta.innerHTML = nowChecked ? ICONS.check + '已点亮 · 点击取消' : ICONS.spark + '点亮这处应援';
    }
  }

  function fireWave(v) {
    const wx = mx(v.lon), wy = my(v.lat);
    const speed = (W / state.cam.s) / 1500;
    state.waves.push({ x: wx, y: wy, r: 0, speed, k: 1, born: performance.now() });
    state.beams.push({ x: wx, y: wy, born: performance.now() });
  }

  function updateProgress() {
    const total = VENUES.filter((v) => v.tier !== 'reported').length;
    const n = state.checked.size;
    el.progressVal.innerHTML = `<em>${n}</em> / ${total}`;
    el.progressFill.style.width = (total ? (n / total) * 100 : 0) + '%';
  }

  let toastTimer = 0;
  function toast(html) {
    el.toast.innerHTML = html;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), 2800);
  }

  /* =========================================================
     时间轴
     ========================================================= */
  function dateToPct(t) { return clamp((t - T_START) / (T_END - T_START), 0, 1); }
  function pctToDate(p) { return new Date(T_START + p * (T_END - T_START)); }

  function buildTicks() {
    el.scrubTicks.innerHTML = MILESTONES.map((m) => {
      const p = dateToPct(new Date(m.date + 'T00:00:00').getTime()) * 100;
      return `<div class="tick${m.major ? ' is-major' : ''}" style="left:${p}%" title="${esc(m.label)} · ${esc(m.note)}"><span class="tick__label">${esc(m.label)}</span></div>`;
    }).join('');
    layoutTicks();
  }

  /* 里程碑标签避让：先排下排，放不下的排上排，仍放不下则隐藏（保留 title 提示） */
  function layoutTicks() {
    const w = el.scrub.getBoundingClientRect().width;
    if (!w) return;
    const rows = [[], []];
    $$('#scrubTicks .tick').forEach((tick) => {
      const lb = tick.querySelector('.tick__label');
      if (!lb) return;
      const p = parseFloat(tick.style.left) / 100 * w;
      const lw = lb.offsetWidth || 40;
      let placed = -1;
      for (const cand of [0, 1]) {
        if (rows[cand].every((x) => Math.abs(x - p) > (lw + 26))) { placed = cand; break; }
      }
      if (placed === -1) { lb.style.visibility = 'hidden'; tick.classList.remove('tick--up'); return; }
      lb.style.visibility = '';
      tick.classList.toggle('tick--up', placed === 1);
      rows[placed].push(p);
    });
  }

  function setDate(d) {
    state.date = d;
    const p = dateToPct(d.getTime());
    el.scrubFill.style.width = (p * 100) + '%';
    el.scrubHandle.style.left = (p * 100) + '%';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    el.tlDate.textContent = `${d.getFullYear()}.${mm}.${dd}`;
    const lit = VENUES.filter((v) => statusOf(v) === 'lit').length;
    const all = visibleVenues().length;
    el.tlSub.innerHTML = `此刻 <b>${lit}</b> 处在投放期 · 共 ${all} 处可选`;
    renderList();
  }

  let scrubDrag = false;
  function scrubFromEvent(e, clampOut) {
    const track = el.scrub.querySelector('.scrub__track');
    const r = (track || el.scrub).getBoundingClientRect();
    if (!r.width) return;
    const x = e.clientX - r.left;
    // 落点不在轨道范围内（且不是拖拽中的越界）时一律忽略，避免误触把潮位拉回起点
    if (!clampOut && (x < -6 || x > r.width + 6)) return;
    const p = clamp(x / r.width, 0, 1);
    setDate(pctToDate(p));
  }
  el.scrub.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    scrubDrag = true; el.scrub.classList.add('is-drag');
    try { el.scrub.setPointerCapture(e.pointerId); } catch (err) { /* 环境不支持指针捕获时忽略 */ }
    scrubFromEvent(e, false);
  });
  el.scrub.addEventListener('pointermove', (e) => { if (scrubDrag) scrubFromEvent(e, true); });
  el.scrub.addEventListener('pointerup', () => { scrubDrag = false; el.scrub.classList.remove('is-drag'); });
  el.scrub.addEventListener('pointercancel', () => { scrubDrag = false; el.scrub.classList.remove('is-drag'); });

  el.jumps.innerHTML = MILESTONES.map((m) =>
    `<button class="jump${m.major ? ' is-major' : ''}" data-date="${m.date}">${esc(m.label)}</button>`).join('');
  el.jumps.addEventListener('click', (e) => {
    const b = e.target.closest('.jump');
    if (!b) return;
    setDate(new Date(b.getAttribute('data-date') + 'T00:00:00'));
  });

  /* =========================================================
     筛选 / 搜索 / 视图
     ========================================================= */
  el.chipsKind.innerHTML = Object.keys(KINDS).map((k) =>
    `<button class="chip" data-kind="${k}" aria-pressed="true">${esc(KINDS[k].label)}</button>`).join('');
  el.chipsKind.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const k = b.getAttribute('data-kind');
    if (state.kindFilter.has(k)) { state.kindFilter.delete(k); b.setAttribute('aria-pressed', 'false'); }
    else { state.kindFilter.add(k); b.setAttribute('aria-pressed', 'true'); }
    if (!state.kindFilter.size) { state.kindFilter.add(k); b.setAttribute('aria-pressed', 'true'); }
    renderList();
  });

  const STATUSES = [
    { id: 'all', label: '全部' },
    { id: 'lit', label: '投放中' },
    { id: 'future', label: '即将' },
    { id: 'past', label: '已结束' },
    { id: 'reported', label: '待核实' }
  ];
  el.chipsStatus.innerHTML = STATUSES.map((s) =>
    `<button class="chip${s.id === 'reported' ? ' chip--ghost' : ''}" data-status="${s.id}" aria-pressed="${s.id === 'all'}">${s.label}</button>`).join('');
  el.chipsStatus.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.statusFilter = b.getAttribute('data-status');
    $$('#chipsStatus .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    renderList();
  });

  el.search.addEventListener('input', () => { state.query = el.search.value.trim(); renderList(); });

  el.btnReset.addEventListener('click', () => {
    state.checked.clear();
    try { localStorage.removeItem('qiyu-tide-checked'); } catch (e) { /* 忽略 */ }
    updateProgress();
    if (state.selected) selectVenue(state.selected, false);
    toast('已清空点亮记录');
  });

  function toggleList() {
    const on = state.view === 'map';
    state.view = on ? 'list' : 'map';
    el.listview.classList.toggle('is-on', on);
    document.querySelector('.app').classList.toggle('is-list', on);
    el.btnList.setAttribute('aria-pressed', String(on));
    canvas.style.opacity = on ? '.16' : '1';
    canvas.style.transition = 'opacity .35s ease';
    if (on) renderList();
  }
  el.btnList.addEventListener('click', toggleList);

  function renderList() {
    const vis = visibleVenues();
    if (!vis.length) {
      el.listview.innerHTML = '<p style="color:#8FA8C9;font-size:13px;padding:20px">当前筛选下没有点位。换个日期或放宽筛选试试。</p>';
      return;
    }
    const byCity = {};
    vis.forEach((v) => { (byCity[v.city] = byCity[v.city] || []).push(v); });
    const cities = Object.keys(byCity).sort((a, b) => byCity[b].length - byCity[a].length || a.localeCompare(b));
    el.listview.innerHTML = cities.map((c) => `
      <div class="lv-group">
        <div class="lv-group__head">
          <span class="lv-group__city">${esc(c)}</span>
          <span class="lv-group__meta">${byCity[c].length} 处 · ${byCity[c].reduce((n, v) => n + (v.screens || []).length, 0)} 个屏幕</span>
        </div>
        ${byCity[c].map((v) => {
          const st = statusOf(v);
          const color = st === 'lit' ? '#7CF7FF' : st === 'reported' ? '#FFB45C' : '#5B7295';
          return `<button class="lv-card" data-id="${v.id}">
            <div>
              <div class="lv-card__name">${esc(v.name)}</div>
              <div class="lv-card__meta">${esc(v.addr)}</div>
            </div>
            <div class="lv-card__right">
              <span class="lv-card__when" style="color:${color}">${fmtRange(v)}</span>
              <span class="lv-card__screens">${esc(v.hours || '')} · ${(v.screens || []).length} 屏</span>
            </div>
          </button>`;
        }).join('')}
      </div>`).join('');
    $$('#listview .lv-card').forEach((b) => {
      b.addEventListener('click', () => {
        const v = VENUES.find((x) => x.id === b.getAttribute('data-id'));
        if (!v) return;
        toggleList();
        selectVenue(v, true);
      });
    });
  }

  /* ---------------- 顶栏统计 ---------------- */
  function renderStats() {
    const items = [
      { n: OFFICIAL.cities, s: '+', l: '全球城市' },
      { n: OFFICIAL.projects, s: '', l: '应援项目' },
      { n: OFFICIAL.malls, s: '+', l: '商场' },
      { n: OFFICIAL.screens, s: '+', l: '大屏' },
      { n: OFFICIAL.districts, s: '+', l: '地级行政区' }
    ];
    el.stats.innerHTML = items.map((it) => `
      <div class="stat">
        <span class="stat__num">${it.n}${it.s ? `<small>${it.s}</small>` : ''}</span>
        <span class="stat__label">${it.l}</span>
      </div>`).join('');
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    const on = !el.settings.classList.contains('is-on');
    el.settings.classList.toggle('is-on', on);
    el.btnSettings.setAttribute('aria-pressed', String(on));
  }
  function closeSettings() {
    el.settings.classList.remove('is-on');
    el.btnSettings.setAttribute('aria-pressed', 'false');
  }
  el.btnSettings.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  document.addEventListener('click', (e) => {
    if (el.settings.classList.contains('is-on') && !el.settings.contains(e.target) && e.target !== el.btnSettings) closeSettings();
  });

  el.glassRange.addEventListener('input', () => {
    const v = Number(el.glassRange.value) / 100;
    document.documentElement.style.setProperty('--glass-tint', v.toFixed(2));
    el.glassVal.textContent = v < .25 ? '极透' : v < .62 ? '标准' : '厚实';
  });

  el.toggleMotion.addEventListener('click', () => {
    state.reducedMotion = !state.reducedMotion;
    document.body.classList.toggle('reduced-motion', state.reducedMotion);
    el.toggleMotion.setAttribute('aria-pressed', String(state.reducedMotion));
  });

  el.toggleContrast.addEventListener('click', () => {
    state.highContrast = !state.highContrast;
    document.body.classList.toggle('hc', state.highContrast);
    el.toggleContrast.setAttribute('aria-pressed', String(state.highContrast));
  });

  /* ---------------- 配色版本（双版本） ---------------- */
  const THEMES = {
    neon: {
      name: '霓虹紫夜',
      hint: '深紫罗兰液态玻璃 + 粉色霓虹；紫与蓝用于区分应援类型。',
      land: [58, 46, 98],
      deep: ['#1A0B33', '#0D0620', '#05030C'],
      grid: 'rgba(255,180,225,.06)'
    },
    ivory: {
      name: '主粉副白',
      hint: '樱白磨砂玻璃为结构层，粉色是唯一强调色，紫蓝退为语义辅助。',
      land: [104, 78, 122],
      deep: ['#1C0A2C', '#100620', '#070310'],
      grid: 'rgba(255,205,235,.07)'
    }
  };
  function applyTheme(name, persist) {
    const th = THEMES[name] ? name : 'neon';
    const t = THEMES[th];
    state.theme = th;
    document.body.dataset.theme = th;
    if (el.themeVal) el.themeVal.textContent = t.name;
    if (el.themeHint) el.themeHint.textContent = t.hint;
    $$('.seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-theme') === th)));
    if (el.btnTheme) {
      el.btnTheme.setAttribute('aria-pressed', String(th === 'ivory'));
      el.btnTheme.setAttribute('title', '切换配色版本（当前：' + t.name + '）');
      el.btnTheme.setAttribute('aria-label', '切换配色版本，当前 ' + t.name);
    }
    if (persist) { try { localStorage.setItem('qiyu-tide-theme', th); } catch (e) { /* 隐私模式下忽略 */ } }
  }
  if (el.btnTheme) el.btnTheme.addEventListener('click', (e) => {
    e.stopPropagation();
    applyTheme(state.theme === 'neon' ? 'ivory' : 'neon', true);
  });
  if (el.themeSeg) el.themeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg__btn');
    if (!b) return;
    applyTheme(b.getAttribute('data-theme'), true);
  });

  /* ---------------- 视图按钮 ---------------- */
  el.btnWorld.addEventListener('click', () => { flyTo(mx(10), my(16), sMin(), 820); });
  el.btnChina.addEventListener('click', () => { flyTo(mx(112), my(30), 1250, 820); });
  el.btnZoomIn.addEventListener('click', () => { zoomAt(W / 2, H / 2, 1.55); });
  el.btnZoomOut.addEventListener('click', () => { zoomAt(W / 2, H / 2, 1 / 1.55); });

  /* ---------------- 提示 ---------------- */
  let hintGone = false;
  function hideHint() {
    if (hintGone) return;
    hintGone = true;
    el.hint.classList.add('is-gone');
  }
  setTimeout(hideHint, 9000);

  /* ---------------- 键盘 ---------------- */
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const step = 90 / state.cam.s;
    if (e.key === 'ArrowLeft') { state.cam.x -= step; state.target = null; }
    else if (e.key === 'ArrowRight') { state.cam.x += step; state.target = null; }
    else if (e.key === 'ArrowUp') { state.cam.y -= step; state.target = null; }
    else if (e.key === 'ArrowDown') { state.cam.y += step; state.target = null; }
    else if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.4);
    else if (e.key === '-' || e.key === '_') zoomAt(W / 2, H / 2, 1 / 1.4);
    else return;
    e.preventDefault();
  });

  /* =========================================================
     主循环
     ========================================================= */
  function loop(now) {
    const dt = Math.min(now - (lastT || now), 64);
    lastT = now;
    // 陆地点阵的淡入：无论何时进入都平滑显现
    if (state.intro < 1) state.intro = Math.min(1, state.intro + dt / 700);
    if (!state.reducedMotion) applyInertia();
    // 波纹推进
    for (let i = state.waves.length - 1; i >= 0; i--) {
      const w = state.waves[i];
      w.r += w.speed * dt;
      w.k = Math.max(0, 1 - (now - w.born) / 1700);
      if (w.k <= 0 || w.r * state.cam.s > Math.max(W, H) * 2.4) state.waves.splice(i, 1);
    }
    for (let i = state.beams.length - 1; i >= 0; i--) {
      const b = state.beams[i];
      if (now - b.born > 1100) state.beams.splice(i, 1);
    }
    try { draw(now); } catch (e) { /* 单帧异常不应中断渲染循环 */ }
    raf = requestAnimationFrame(loop);
  }

  /* =========================================================
     启动
     ========================================================= */
  function boot() {
    resize();
    renderStats();
    buildTicks();
    updateProgress();
    try { applyTheme(localStorage.getItem('qiyu-tide-theme') || 'ivory', false); }
    catch (e) { applyTheme('ivory', false); }
    setDate(new Date('2026-03-06T00:00:00'));
    renderList();

    // 开场：从世界缓缓推近到东亚
    const from = { x: mx(46), y: my(6), s: Math.max(150, sMin() * .72) };
    const to = { x: mx(100), y: my(27), s: 400 };
    state.cam.x = from.x; state.cam.y = from.y; state.cam.s = from.s;
    state.intro = 0;
    const t0 = performance.now();
    const DUR = 2000;
    (function intro(now) {
      const k = clamp((now - t0) / DUR, 0, 1);
      const e = easeInOut(k);
      state.cam.x = lerp(from.x, to.x, e);
      state.cam.y = lerp(from.y, to.y, e);
      state.cam.s = lerp(from.s, to.s, e);
      if (k < 1) requestAnimationFrame(intro);
    })(t0);

    raf = requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__tide = { state, VENUES, flyTo, setDate, selectVenue };
})();
