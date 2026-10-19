// ============================================================
//  createSimulation.js
//  Motor visual "MATRIX CITY" (canvas 2D, JS puro).
//
//  Capas (de atrás hacia delante):
//    cielo → sol retro → lluvia de glifos → piso con grilla →
//    3 capas de edificios cifrados → láseres → ecualizador LED →
//    postproceso (bloom, glitch, viñeta, scanlines)
//
//  El audio se analiza en 3 bandas (bajo / medios / agudos) y se
//  detectan beats; todo el visual reacciona a esos valores.
// ============================================================

import { AUDIO_SRC, AUDIO_NAME, config, defaultParams, regenKeys } from './parameters.js';

// ---------- utilidades ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mod = (n, m) => ((n % m) + m) % m;
const rand = (a, b) => a + Math.random() * (b - a);
const hsla = (h, s, l, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`;
// convierte una tasa "por frame a 60fps" en una tasa independiente de dt
const smoothK = (rate, dt) => 1 - Math.pow(1 - clamp(rate, 0, 0.999), dt * 60);
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE = config.baseHue;
const GLYPHS = [...config.glyphs];
const AS = 32; // tamaño de cada glifo en el atlas

// 3 capas de profundidad para la ciudad (lejos → cerca)
const LAYERS = [
  { scale: 0.55, bright: 0.4, speed: 0.35, ground: 0.0, hMul: 0.85, gap: [6, 26] },
  { scale: 0.8, bright: 0.65, speed: 0.65, ground: 0.09, hMul: 1.0, gap: [10, 40] },
  { scale: 1.15, bright: 1.0, speed: 1.0, ground: 0.2, hMul: 1.05, gap: [24, 90] },
];

// colores de los láseres (tonos HSL, alrededor del verde)
const LASER_HUES = [BASE, BASE + 28, BASE - 30, BASE + 55, BASE - 12, BASE + 14];

// Dibuja todos los glifos en una tira horizontal para reutilizarlos
// con drawImage (mucho más barato que fillText cada frame).
function buildAtlas(color) {
  const c = document.createElement('canvas');
  c.width = GLYPHS.length * AS;
  c.height = AS;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(AS * 0.78)}px "MS Gothic","Noto Sans Mono CJK JP","Courier New",monospace`;
  GLYPHS.forEach((ch, i) => g.fillText(ch, i * AS + AS / 2, AS / 2 + 1));
  return c;
}

export function createSimulation(canvas, options = {}) {
  const { onState, onFrame, initialParams } = options;
  const ctx = canvas.getContext('2d', { alpha: false });

  // ---------- parámetros vivos ----------
  const params = { ...defaultParams };
  if (initialParams) {
    for (const k of Object.keys(defaultParams)) {
      if (k in initialParams && typeof initialParams[k] === typeof defaultParams[k]) {
        params[k] = initialParams[k];
      }
    }
  }

  // ---------- estado ----------
  let W = 0, H = 0, dpr = 1;
  let raf = 0, last = 0, time = 0, running = false;
  let city = [];
  let rain = [];
  const rainCell = 14;
  let sunCanvas = null, sunR = 0;
  let bloomA = null, bloomB = null, vignette = null, scanPattern = null;
  let gridZ = 0, wave = 0, pattern = 0, beatCount = 0;
  let appliedHue = null, regenTimer = 0, resizeTimer = 0;
  let playing = false, audioError = false;

  const atlasGreen = buildAtlas(hsla(BASE, 100, 58, 1));
  const atlasHead = buildAtlas('#e6fff0');

  // ---------- audio ----------
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  audio.src = AUDIO_SRC;

  let actx = null, analyser = null, gainNode = null, freq = null;
  const emit = (e) => { if (onState) onState(e); };

  audio.addEventListener('play', () => { playing = true; emit({ type: 'play' }); });
  audio.addEventListener('pause', () => { playing = false; emit({ type: 'pause' }); });
  audio.addEventListener('canplay', () => { audioError = false; emit({ type: 'ready' }); });
  audio.addEventListener('error', () => {
    audioError = true;
    emit({
      type: 'error',
      message: `No se pudo cargar ${AUDIO_NAME}. Revisa que exista en la carpeta public/.`,
    });
  });

  function ensureGraph() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = config.fftSize;
    analyser.smoothingTimeConstant = 0.5;
    gainNode = actx.createGain();
    gainNode.gain.value = params.volume;
    // el analizador lee ANTES del volumen: los visuales no se apagan al bajar el volumen
    src.connect(analyser);
    src.connect(gainNode);
    gainNode.connect(actx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
  }

  async function play() {
    try {
      ensureGraph();
      if (actx.state === 'suspended') await actx.resume();
      await audio.play();
      return true;
    } catch (err) {
      emit({
        type: 'error',
        message: audioError
          ? `No se pudo cargar ${AUDIO_NAME}. Revisa que exista en la carpeta public/.`
          : `No se pudo reproducir el audio (${err && err.name ? err.name : 'error'}).`,
      });
      return false;
    }
  }
  function pause() { audio.pause(); }
  async function toggle() { if (playing) { pause(); return false; } return play(); }

  // ---------- análisis ----------
  const levels = {
    bass: 0, mid: 0, treble: 0, energy: 0, beat: 0, bpm: 0,
    playing: false, time: 0, duration: 0, pattern: 0,
    spectrum: new Float32Array(config.bandsCount),
  };
  const spectrum = levels.spectrum;
  const peak = { bass: 0.2, mid: 0.2, treble: 0.2 };
  const bassHist = [];
  const beatTimes = [];
  let lastBeat = -10;

  function bandLevel(lo, hi) {
    const binHz = actx.sampleRate / analyser.fftSize;
    const a = clamp(Math.floor(lo / binHz), 1, freq.length - 2);
    const b = clamp(Math.ceil(hi / binHz), a, freq.length - 1);
    let s = 0;
    for (let i = a; i <= b; i++) s += freq[i];
    return s / ((b - a + 1) * 255);
  }

  function analyse(dt, t) {
    let nb = 0, nm = 0, nt = 0;
    const n = config.bandsCount;
    const specTarget = analyse.tmp || (analyse.tmp = new Float32Array(n));
    specTarget.fill(0);

    if (playing && analyser) {
      analyser.getByteFrequencyData(freq);
      const rb = bandLevel(...config.bands.bass);
      const rm = bandLevel(...config.bands.mid);
      const rt = bandLevel(...config.bands.treble);
      // autoganancia: se adapta a lo fuerte que esté la canción
      peak.bass = Math.max(rb, peak.bass - dt * 0.02, 0.12);
      peak.mid = Math.max(rm, peak.mid - dt * 0.02, 0.12);
      peak.treble = Math.max(rt, peak.treble - dt * 0.02, 0.12);
      nb = clamp((rb / peak.bass) * params.sensitivity, 0, 1.4);
      nm = clamp((rm / peak.mid) * params.sensitivity, 0, 1.4);
      nt = clamp((rt / peak.treble) * params.sensitivity, 0, 1.4);
      for (let i = 0; i < n; i++) {
        const lo = 35 * Math.pow(300, i / n);
        const hi = 35 * Math.pow(300, (i + 1) / n);
        specTarget[i] = clamp(bandLevel(lo, hi) * (1 + (i / n) * 1.8) * params.sensitivity * 1.15, 0, 1);
      }

      // --- detección de beat (el bajo supera su promedio reciente) ---
      bassHist.push(nb);
      if (bassHist.length > 43) bassHist.shift();
      let avg = 0;
      for (const v of bassHist) avg += v;
      avg /= bassHist.length;
      if (nb > avg * params.beatThreshold + 0.04 && nb > 0.45 && t - lastBeat > 0.22) {
        lastBeat = t;
        levels.beat = 1;
        beatTimes.push(t);
        if (beatTimes.length > 12) beatTimes.shift();
        onBeat();
      }
    } else if (params.idleMotion) {
      // modo demo: respiración suave para que no se vea muerto
      nb = 0.26 + 0.12 * Math.sin(t * 1.6);
      nm = 0.2 + 0.1 * Math.sin(t * 0.9 + 1);
      nt = 0.16 + 0.1 * Math.sin(t * 2.3 + 2);
      for (let i = 0; i < n; i++) {
        const s = Math.sin(t * 1.4 + i * 0.35);
        specTarget[i] = 0.1 + 0.12 * s * s * (1 - i / n * 0.5);
      }
    }

    const att = smoothK(0.75, dt);
    const rel = smoothK(1 - params.smoothing, dt);
    levels.bass += (nb - levels.bass) * (nb > levels.bass ? att : rel);
    levels.mid += (nm - levels.mid) * (nm > levels.mid ? att : rel);
    levels.treble += (nt - levels.treble) * (nt > levels.treble ? att : rel);
    for (let i = 0; i < n; i++) {
      spectrum[i] += (specTarget[i] - spectrum[i]) * (specTarget[i] > spectrum[i] ? att : rel);
    }
    levels.energy = levels.bass * 0.5 + levels.mid * 0.3 + levels.treble * 0.2;
    levels.beat = Math.max(0, levels.beat - dt * 5);

    // BPM estimado con la mediana de los intervalos entre beats
    if (beatTimes.length >= 4) {
      const iv = [];
      for (let i = 1; i < beatTimes.length; i++) {
        const d = beatTimes[i] - beatTimes[i - 1];
        if (d > 0.3 && d < 1.0) iv.push(d);
      }
      if (iv.length >= 3) {
        iv.sort((a, b) => a - b);
        const target = 60 / iv[Math.floor(iv.length / 2)];
        levels.bpm = levels.bpm ? levels.bpm + (target - levels.bpm) * 0.1 : target;
      }
    }
    levels.playing = playing;
    levels.time = audio.currentTime || 0;
    levels.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    levels.pattern = pattern;
  }

  function onBeat() {
    beatCount++;
    wave = 0.001;
    if (params.autoPattern && beatCount % 8 === 0) pattern = (pattern + 1) % 4;
    // algunos edificios se encienden con el golpe
    for (const layer of city) {
      const list = layer.buildings;
      list[Math.floor(Math.random() * list.length)].flash = 1;
      if (Math.random() < 0.5) list[Math.floor(Math.random() * list.length)].flash = 1;
    }
    // de vez en cuando un edificio se "re-encripta": colapsa y se regenera
    if (Math.random() < 0.22) {
      const layer = city[Math.floor(Math.random() * city.length)];
      if (layer) {
        const b = layer.buildings[Math.floor(Math.random() * layer.buildings.length)];
        if (b.state === 'idle') b.state = 'collapsing';
      }
    }
  }

  // ---------- ciudad ----------
  function shapeBuilding(b, def, keepCols) {
    b.cell = Math.max(6, Math.round(params.glyphSize * def.scale));
    if (!keepCols) b.cols = 4 + Math.floor(Math.random() * 6);
    const totalRows = Math.max(
      5,
      Math.round((H * 0.62 * params.buildingHeight * def.hMul * Math.pow(Math.random(), 0.8) * 0.85 + H * 0.05) / b.cell)
    );
    // varios "pisos" que se van angostando (setbacks)
    const tiers = [];
    let remaining = totalRows;
    let tc = b.cols;
    const n = Math.random() < 0.55 ? (Math.random() < 0.4 ? 3 : 2) : 1;
    for (let i = 0; i < n && remaining > 0; i++) {
      const r = i === n - 1 ? remaining : Math.max(3, Math.round(remaining * rand(0.45, 0.7)));
      const rows = Math.min(r, remaining);
      tiers.push({ cols: tc, rows });
      remaining -= rows;
      tc = Math.max(2, tc - (Math.random() < 0.5 ? 2 : 1));
    }
    b.tiers = tiers;
    b.rows = tiers.reduce((s, t) => s + t.rows, 0);
    b.seed = Math.floor(Math.random() * 1e9);
    b.ant = Math.random() < 0.5 ? Math.round(rand(8, 22) * def.scale) : 0;
  }

  // Pre-dibuja el edificio completo (cuerpo + glifos) en un canvas aparte
  function renderBuilding(b, def) {
    const bs = Math.min(dpr, 1.5);
    const cell = b.cell;
    const bw = b.cols * cell;
    const bh = b.rows * cell;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(bw * bs));
    cv.height = Math.max(1, Math.ceil(bh * bs));
    const g = cv.getContext('2d');
    g.scale(bs, bs);
    const rng = mulberry32(b.seed);
    let yBottom = bh;
    for (const t of b.tiers) {
      const tw = t.cols * cell;
      const th = t.rows * cell;
      const x0 = (bw - tw) / 2;
      const y0 = yBottom - th;
      // cuerpo oscuro y opaco (tapa la lluvia que está detrás)
      const grad = g.createLinearGradient(0, y0, 0, yBottom);
      grad.addColorStop(0, 'rgba(0,26,9,1)');
      grad.addColorStop(1, 'rgba(0,9,4,1)');
      g.fillStyle = grad;
      g.fillRect(x0, y0, tw, th);
      // retícula de glifos "encriptados"
      for (let r = 0; r < t.rows; r++) {
        for (let c = 0; c < t.cols; c++) {
          const gi = Math.floor(rng() * GLYPHS.length);
          const lit = rng() < 0.22;
          g.globalAlpha = (lit ? 0.55 + rng() * 0.45 : 0.08 + rng() * 0.22) * def.bright;
          g.drawImage(atlasGreen, gi * AS, 0, AS, AS, x0 + c * cell, y0 + r * cell, cell, cell);
        }
      }
      // líneas de piso tenues
      g.globalAlpha = 0.14 * def.bright;
      g.fillStyle = hsla(BASE, 100, 50, 1);
      for (let r = 4; r < t.rows; r += 4) g.fillRect(x0, y0 + r * cell, tw, 1);
      // bordes brillantes
      g.globalAlpha = 0.9 * def.bright;
      g.fillStyle = hsla(BASE, 100, 58, 1);
      g.fillRect(x0, y0, 1, th);
      g.fillRect(x0 + tw - 1, y0, 1, th);
      g.fillRect(x0, y0, tw, 2);
      g.globalAlpha = 1;
      yBottom = y0;
    }
    return cv;
  }

  function makeBuilding(def, x, index) {
    const b = {
      x,
      state: 'growing',
      grow: -(index * 0.06 + rand(0, 1.2)), // se construyen escalonados al inicio
      growSpeed: rand(0.5, 1.1),
      flash: 0,
      phase: rand(0, TAU),
    };
    shapeBuilding(b, def, false);
    b.buf = renderBuilding(b, def);
    return b;
  }

  function regenerateBuilding(b, def) {
    shapeBuilding(b, def, true);
    b.buf = renderBuilding(b, def);
  }

  function buildCity() {
    city = LAYERS.map((def) => {
      const buildings = [];
      let x = 0;
      const target = W + 260;
      let i = 0;
      while (x < target) {
        const b = makeBuilding(def, x, i++);
        buildings.push(b);
        x += b.cols * b.cell + rand(def.gap[0], def.gap[1]) / params.buildingDensity;
      }
      return { def, buildings, span: x, offset: Math.random() * 1000 };
    });
  }

  function updateCity(dt) {
    for (const layer of city) {
      layer.offset += dt * 40 * layer.def.speed * params.citySpeed;
      for (const b of layer.buildings) {
        b.flash = Math.max(0, b.flash - dt * 2.2);
        if (b.state === 'growing') {
          b.grow += dt * b.growSpeed;
          if (b.grow >= 1) { b.grow = 1; b.state = 'idle'; }
        } else if (b.state === 'collapsing') {
          b.grow -= dt * 2.8;
          if (b.grow <= 0) {
            regenerateBuilding(b, layer.def);
            b.grow = 0;
            b.state = 'growing';
          }
        }
      }
    }
  }

  function drawBuilding(b, def, x, gy, t) {
    if (b.grow <= 0.001) return;
    const e = easeOutCubic(clamp(b.grow, 0, 1));
    const bw = b.cols * b.cell;
    const pulse = 1 + params.buildingPulse * levels.bass * 0.05 * def.scale;
    const fullH = b.rows * b.cell;
    const dh = fullH * e * pulse;
    const sh = b.buf.height * e;
    const sy = b.buf.height - sh;
    ctx.globalAlpha = 1;
    ctx.drawImage(b.buf, 0, sy, b.buf.width, sh, x, gy - dh, bw, dh);

    // cabeza brillante mientras se "construye"
    if (b.grow < 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hsla(BASE, 100, 70, 0.9);
      ctx.fillRect(x, gy - dh, bw, 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    // destello cuando le toca el beat
    if (b.flash > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = b.flash * 0.6;
      ctx.drawImage(b.buf, 0, sy, b.buf.width, sh, x, gy - dh, bw, dh);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (e < 0.98) return;

    // glifos que parpadean (datos "vivos")
    const t0 = b.tiers[0];
    ctx.globalAlpha = 0.9 * def.bright;
    for (let k = 0; k < 2; k++) {
      const c = Math.floor(Math.random() * t0.cols);
      const r = Math.floor(Math.random() * t0.rows);
      const gi = Math.floor(Math.random() * GLYPHS.length);
      ctx.drawImage(
        atlasHead, gi * AS, 0, AS, AS,
        x + ((b.cols - t0.cols) * b.cell) / 2 + c * b.cell,
        gy - (r + 1) * b.cell, b.cell, b.cell
      );
    }
    ctx.globalAlpha = 1;

    // antena con luz intermitente
    if (b.ant > 0) {
      const cx = x + bw / 2;
      const topY = gy - dh;
      ctx.fillStyle = hsla(BASE, 100, 60, 0.7 * def.bright);
      ctx.fillRect(cx - 0.5, topY - b.ant, 1, b.ant);
      if (Math.sin(t * 2.4 + b.phase) > 0.4) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hsla(BASE + 40, 100, 70, 0.9 * def.bright);
        ctx.beginPath(); ctx.arc(cx, topY - b.ant, 1.6, 0, TAU); ctx.fill();
        ctx.fillStyle = hsla(BASE + 40, 100, 60, 0.15 * def.bright);
        ctx.beginPath(); ctx.arc(cx, topY - b.ant, 7, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  function drawCity(t) {
    const hy = H * params.horizon;
    const fh = H - hy;
    for (const layer of city) {
      const def = layer.def;
      const gy = hy + fh * def.ground;
      for (const b of layer.buildings) {
        const bw = b.cols * b.cell;
        const bx = mod(b.x - layer.offset, layer.span);
        if (bx < W) drawBuilding(b, def, bx, gy, t);
        const bx2 = bx - layer.span;
        if (bx2 + bw > 0) drawBuilding(b, def, bx2, gy, t);
      }
      // bruma verde en la base de cada capa → sensación de profundidad
      ctx.globalCompositeOperation = 'lighter';
      const fog = ctx.createLinearGradient(0, gy - 110 * def.scale, 0, gy);
      fog.addColorStop(0, hsla(BASE, 100, 40, 0));
      fog.addColorStop(1, hsla(BASE, 100, 40, 0.1 + levels.bass * 0.08));
      ctx.fillStyle = fog;
      ctx.fillRect(0, gy - 110 * def.scale, W, 110 * def.scale);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---------- lluvia matrix ----------
  const randGlyph = () => Math.floor(Math.random() * GLYPHS.length);

  function newDrop(i, initial, rows) {
    return {
      i,
      y: initial ? rand(-rows, rows) : rand(-30, -2),
      speed: rand(8, 24),
      lenFrac: rand(0.5, 1),
      active: Math.random(),
      g: Array.from({ length: 32 }, randGlyph),
    };
  }

  function buildRain() {
    const cols = Math.ceil(W / rainCell);
    const rows = Math.ceil(H / rainCell);
    rain = Array.from({ length: cols }, (_, i) => newDrop(i, true, rows));
  }

  function updateRain(dt) {
    const rows = Math.ceil(H / rainCell);
    const mul = params.rainSpeed * (0.6 + levels.treble * 1.2 + levels.beat * 0.8);
    for (const d of rain) {
      d.y += d.speed * dt * mul;
      if (d.y - params.rainTrail * d.lenFrac > rows) Object.assign(d, newDrop(d.i, false, rows));
    }
    // mutación de glifos
    for (let k = 0; k < 10; k++) {
      const d = rain[Math.floor(Math.random() * rain.length)];
      if (d) d.g[Math.floor(Math.random() * 32)] = randGlyph();
    }
  }

  function drawRain() {
    const rows = Math.ceil(H / rainCell) + 1;
    const boost = 0.55 + levels.treble * 0.25;
    for (const d of rain) {
      if (d.active > params.rainDensity) continue;
      const len = Math.max(4, Math.round(params.rainTrail * d.lenFrac));
      const head = Math.floor(d.y);
      const x = d.i * rainCell;
      for (let j = 0; j < len; j++) {
        const gy = head - j;
        if (gy < 0 || gy > rows) continue;
        ctx.globalAlpha = Math.pow(1 - j / len, 1.7) * boost;
        ctx.drawImage(
          j === 0 ? atlasHead : atlasGreen,
          d.g[mod(gy, 32)] * AS, 0, AS, AS,
          x, gy * rainCell, rainCell, rainCell
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- cielo, sol y piso ----------
  function buildSun() {
    sunR = Math.min(W, H) * 0.28;
    const R = Math.ceil(sunR);
    const c = document.createElement('canvas');
    c.width = c.height = R * 2;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, R * 2);
    grad.addColorStop(0, hsla(BASE - 35, 100, 62, 1));
    grad.addColorStop(0.55, hsla(BASE, 100, 48, 1));
    grad.addColorStop(1, hsla(BASE + 15, 100, 28, 1));
    g.fillStyle = grad;
    g.beginPath(); g.arc(R, R, R, 0, TAU); g.fill();
    // franjas horizontales (sol retro)
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 9; k++) {
      g.fillRect(0, R * 1.1 + k * R * 0.1 + k * k * 1.1, R * 2, 2 + k * 1.7);
    }
    sunCanvas = c;
  }

  function drawSky() {
    const hy = H * params.horizon;
    const g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, '#000603');
    g.addColorStop(0.6, '#00150a');
    g.addColorStop(1, hsla(BASE, 100, 11 + levels.bass * 7, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hy + 2);
  }

  function drawSun() {
    if (!sunCanvas) return;
    const hy = H * params.horizon;
    const R = sunR * (1 + levels.bass * 0.06 + levels.beat * 0.03);
    ctx.globalAlpha = 0.8 * (0.7 + levels.bass * 0.3);
    ctx.drawImage(sunCanvas, W / 2 - R, hy - R * 1.35, R * 2, R * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(W / 2, hy - R * 0.35, R * 0.6, W / 2, hy - R * 0.35, R * 1.7);
    halo.addColorStop(0, hsla(BASE, 100, 50, 0.16 + levels.bass * 0.1));
    halo.addColorStop(1, hsla(BASE, 100, 50, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, hy + 4);
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFloor(dt) {
    const hy = H * params.horizon;
    const fh = H - hy;
    const g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, hsla(BASE, 100, 9, 1));
    g.addColorStop(1, '#000402');
    ctx.fillStyle = g;
    ctx.fillRect(0, hy, W, fh + 1);

    const glow = params.gridGlow * (0.6 + levels.bass * 0.8 + levels.beat * 0.5);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hsla(BASE, 100, 55, clamp(0.55 * glow, 0, 1));
    ctx.fillRect(0, hy - 1, W, 2);

    if (params.showGrid) {
      gridZ = mod(gridZ + dt * 0.18 * params.gridSpeed * (0.35 + levels.energy * 1.8), 1);
      ctx.lineWidth = 1;
      const rows = 16;
      for (let i = 0; i < rows; i++) {
        const tt = (i + gridZ) / rows;
        const y = hy + fh * tt * tt;
        ctx.strokeStyle = hsla(BASE, 100, 55, clamp((0.08 + 0.55 * tt) * glow, 0, 1));
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      const vx = W / 2;
      const spacingB = W * 0.08;
      ctx.strokeStyle = hsla(BASE, 100, 55, clamp(0.35 * glow, 0, 1));
      ctx.beginPath();
      for (let k = -24; k <= 24; k++) {
        ctx.moveTo(vx + k * 4, hy);
        ctx.lineTo(vx + k * spacingB, H);
      }
      ctx.stroke();
    }
    // onda de luz que viaja por el piso con cada beat
    if (wave > 0) {
      wave += dt * 1.6;
      if (wave >= 1) wave = 0;
      else {
        const y = hy + fh * wave * wave;
        ctx.fillStyle = hsla(BASE + 20, 100, 65, (1 - wave) * 0.7);
        ctx.fillRect(0, y, W, 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- láseres ----------
  function drawLasers(t) {
    const n = Math.round(params.laserCount);
    const len = Math.hypot(W, H) * 1.15;
    const sweep = params.laserSweep;
    const spd = params.laserSpeed;
    const inten = clamp(0.3 + 0.5 * levels.mid + 0.9 * levels.beat, 0, 1.4);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const fromTop = i % 2 === 1;
      const ox = ((i + 0.5) / n) * W;
      const oy = fromTop ? -10 : H + 10;
      const base = fromTop ? Math.PI / 2 : -Math.PI / 2;
      let sw;
      switch (pattern) {
        case 1: // abanico sincronizado
          sw = Math.sin(t * spd * 0.9) * sweep * ((i / Math.max(1, n - 1)) * 2 - 1);
          break;
        case 2: // haces que se cruzan
          sw = Math.sin(t * spd * 1.2 + (fromTop ? 0 : Math.PI)) * sweep * (ox < W / 2 ? 1 : -1);
          break;
        case 3: // barrido tipo escáner
          sw = (mod(t * spd * 0.35 + i * 0.1, 1) * 2 - 1) * sweep;
          break;
        default: // cada haz por su lado
          sw = Math.sin(t * spd * (0.5 + 0.13 * i) + i * 1.7) * sweep;
      }
      const ang = base + sw + levels.beat * 0.1 * (i % 3 - 1);
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const ex = ox + dx * len;
      const ey = oy + dy * len;
      const hue = LASER_HUES[i % LASER_HUES.length];

      // cono de niebla
      if (params.laserFog > 0.01) {
        const spread = 0.018 + 0.02 * levels.bass;
        const px = -dy * len * spread;
        const py = dx * len * spread;
        const fog = ctx.createLinearGradient(ox, oy, ex, ey);
        fog.addColorStop(0, hsla(hue, 100, 50, clamp(0.2 * params.laserFog * inten, 0, 1)));
        fog.addColorStop(1, hsla(hue, 100, 50, 0));
        ctx.fillStyle = fog;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex + px, ey + py);
        ctx.lineTo(ex - px, ey - py);
        ctx.closePath();
        ctx.fill();
      }
      // haz (halo + núcleo)
      const lw = (1 + levels.bass * 2.2) * params.laserWidth;
      const core = ctx.createLinearGradient(ox, oy, ex, ey);
      core.addColorStop(0, hsla(hue, 100, 75, clamp(0.95 * inten, 0, 1)));
      core.addColorStop(1, hsla(hue, 100, 60, 0.05));
      ctx.strokeStyle = core;
      ctx.lineWidth = lw * 5;
      ctx.globalAlpha = 0.14;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
      // destello en el emisor
      const fl = ctx.createRadialGradient(ox, oy, 0, ox, oy, 46);
      fl.addColorStop(0, hsla(hue, 100, 70, clamp(0.7 * inten, 0, 1)));
      fl.addColorStop(1, hsla(hue, 100, 50, 0));
      ctx.fillStyle = fl;
      ctx.fillRect(ox - 46, oy - 46, 92, 92);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- ecualizador LED retro ----------
  const BAR_COLORS = Array.from({ length: 16 }, (_, s) => hsla(BASE - 38 * (s / 15), 100, 50 + s * 0.8, 0.88));

  function drawBars(dt) {
    const n = config.bandsCount;
    const bw = W / n;
    const maxH = H * 0.16;
    const seg = 7, gap = 2;
    const maxSeg = Math.floor(maxH / (seg + gap));
    if (!drawBars.peaks) drawBars.peaks = new Float32Array(n);
    const pk = drawBars.peaks;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const v = spectrum[i];
      pk[i] = Math.max(v, pk[i] - dt * 0.35);
      const ns = Math.floor((v * maxH) / (seg + gap));
      for (let s = 0; s < ns; s++) {
        ctx.fillStyle = BAR_COLORS[Math.min(15, Math.floor((s / maxSeg) * 15))];
        ctx.fillRect(i * bw + 1, H - (s + 1) * (seg + gap), bw - 2, seg);
      }
      const ps = Math.floor((pk[i] * maxH) / (seg + gap));
      if (ps > 0) {
        ctx.fillStyle = hsla(BASE + 40, 100, 80, 0.9);
        ctx.fillRect(i * bw + 1, H - (ps + 1) * (seg + gap), bw - 2, 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- postproceso ----------
  function post(t) {
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // bloom barato: reducir la imagen y volver a sumarla ampliada
    if (params.bloom > 0.01 && bloomA && bloomB) {
      const a = bloomA.getContext('2d');
      const b = bloomB.getContext('2d');
      a.imageSmoothingQuality = 'high';
      b.imageSmoothingQuality = 'high';
      a.drawImage(canvas, 0, 0, cw, ch, 0, 0, bloomA.width, bloomA.height);
      b.drawImage(bloomA, 0, 0, bloomA.width, bloomA.height, 0, 0, bloomB.width, bloomB.height);
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(params.bloom * 0.55 * (0.8 + levels.beat * 0.6), 0, 1);
      ctx.drawImage(bloomB, 0, 0, bloomB.width, bloomB.height, 0, 0, cw, ch);
      ctx.globalAlpha = clamp(params.bloom * 0.3, 0, 1);
      ctx.drawImage(bloomA, 0, 0, bloomA.width, bloomA.height, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // glitch: franjas desplazadas + eco, solo con el beat
    const gl = params.glitch * levels.beat;
    if (gl > 0.06) {
      const strips = 2 + Math.floor(gl * 4);
      for (let k = 0; k < strips; k++) {
        const sy = Math.floor(rand(0, Math.max(1, ch - 60)));
        const sh = Math.floor(rand(6, 40) * dpr);
        const dx = Math.round(rand(-1, 1) * 50 * gl * dpr);
        ctx.drawImage(canvas, 0, sy, cw, sh, dx, sy, cw, sh);
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 * gl;
      ctx.drawImage(canvas, Math.round(4 * dpr * gl), 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // flash suave de pantalla en cada golpe
    if (levels.beat > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hsla(BASE, 100, 50, levels.beat * 0.06);
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    }
    // parpadeo CRT ocasional
    if (Math.random() < 0.03 * params.glitch) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 0, cw, ch);
    }
    if (vignette) ctx.drawImage(vignette, 0, 0);
    if (params.scanlines > 0.01 && scanPattern) {
      ctx.globalAlpha = clamp(params.scanlines * 0.55, 0, 1);
      ctx.fillStyle = scanPattern;
      ctx.fillRect(0, 0, cw, ch);
      // barra que baja lentamente (refresco de pantalla)
      const by = (mod(t * 0.08, 1.3) - 0.15) * ch;
      const bar = ctx.createLinearGradient(0, by, 0, by + ch * 0.12);
      bar.addColorStop(0, hsla(BASE, 100, 60, 0));
      bar.addColorStop(0.5, hsla(BASE, 100, 60, 0.05 * params.scanlines));
      bar.addColorStop(1, hsla(BASE, 100, 60, 0));
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = bar;
      ctx.fillRect(0, by, cw, ch * 0.12);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // ---------- tamaño y recursos dependientes del tamaño ----------
  function buildStatic() {
    const cw = canvas.width;
    const ch = canvas.height;
    bloomA = document.createElement('canvas');
    bloomA.width = Math.max(2, Math.ceil(cw / 4));
    bloomA.height = Math.max(2, Math.ceil(ch / 4));
    bloomB = document.createElement('canvas');
    bloomB.width = Math.max(2, Math.ceil(cw / 12));
    bloomB.height = Math.max(2, Math.ceil(ch / 12));

    vignette = document.createElement('canvas');
    vignette.width = cw;
    vignette.height = ch;
    const v = vignette.getContext('2d');
    const rg = v.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.6);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.78)');
    v.fillStyle = rg;
    v.fillRect(0, 0, cw, ch);

    const ph = Math.max(3, Math.round(3 * dpr));
    const sp = document.createElement('canvas');
    sp.width = 1;
    sp.height = ph;
    const s = sp.getContext('2d');
    s.fillStyle = 'rgba(0,0,0,1)';
    s.fillRect(0, 0, 1, Math.max(1, Math.round(dpr)));
    scanPattern = ctx.createPattern(sp, 'repeat');

    buildSun();
  }

  function resize() {
    W = Math.max(320, window.innerWidth);
    H = Math.max(240, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    buildStatic();
    buildRain();
    buildCity();
  }

  function onWindowResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }

  function regenerateCity() { buildCity(); }

  // ---------- bucle principal ----------
  function render(t, dt) {
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    const sh = levels.beat * params.shake * 6;
    ctx.setTransform(dpr, 0, 0, dpr, (Math.random() - 0.5) * sh * dpr, (Math.random() - 0.5) * sh * dpr);

    drawSky();
    if (params.showSun) drawSun();
    if (params.showRain) drawRain();
    drawFloor(dt);
    if (params.showCity) drawCity(t);
    if (params.showLasers) drawLasers(t);
    if (params.showBars) drawBars(dt);
    post(t);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    time += dt;

    analyse(dt, time);
    updateCity(dt);
    updateRain(dt);

    if (params.hue !== appliedHue) {
      canvas.style.filter = params.hue ? `hue-rotate(${params.hue}deg)` : '';
      appliedHue = params.hue;
    }
    render(time, dt);
    if (onFrame) onFrame(levels);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // ---------- API pública ----------
  function setParam(key, value) {
    if (!(key in params)) return;
    params[key] = value;
    if (key === 'volume' && gainNode) gainNode.gain.value = value;
    if (regenKeys.includes(key)) {
      clearTimeout(regenTimer);
      regenTimer = setTimeout(regenerateCity, 200);
    }
  }

  function applyPreset(preset) {
    Object.assign(params, defaultParams, preset || {});
    if (gainNode) gainNode.gain.value = params.volume;
    regenerateCity();
  }

  function resetParams() { applyPreset({}); }

  function nextPattern() { pattern = (pattern + 1) % 4; }

  function destroy() {
    stop();
    window.removeEventListener('resize', onWindowResize);
    clearTimeout(regenTimer);
    clearTimeout(resizeTimer);
    audio.pause();
    if (actx && actx.close) actx.close();
  }

  window.addEventListener('resize', onWindowResize);
  resize();

  return {
    params,
    audio,
    start,
    stop,
    resize,
    destroy,
    play,
    pause,
    toggle,
    setParam,
    applyPreset,
    resetParams,
    regenerateCity,
    nextPattern,
    getLevels: () => levels,
    isPlaying: () => playing,
  };
}