// =====================================================================
//  main.js — Bucle de render, AudioContext + analizador de frecuencias,
//  detección de beats/drops y transición automática de escenas.
// =====================================================================
import { PARAMS, state, attachSourceFallback } from './simulation/parameters.js';
import { createLabPanel } from './ui/labPanel.js';
import { createSimulation } from './simulation/createSimulation.js';

const canvas = document.getElementById('stage');
const audioEl = document.getElementById('song');

attachSourceFallback(audioEl, PARAMS.assets.audio, () =>
  console.warn('No se encontró la canción:', PARAMS.assets.audio)
);
audioEl.loop = PARAMS.audio.loop;

// ---------- Simulación ----------
const sim = createSimulation(canvas);
sim.setScene(0, true);

function onResize() {
  sim.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
onResize();

// ---------- Panel (slider + tecla P) ----------
const panel = createLabPanel({ canvas, audio: audioEl, onStart: startAudio });

// ---------- Audio ----------
let audioCtx = null;
let analyser = null;
let freq = null;

const BINS = 64;
const a = {
  bass: 0, mid: 0, high: 0, energy: 0,
  bins: new Float32Array(BINS),
  beat: false, beatStrength: 0, beatEnv: 0,
  drop: false, dropStrength: 0,
  peak: false,
};

async function startAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      const node = audioCtx.createMediaElementSource(audioEl);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = PARAMS.audio.fftSize;
      analyser.smoothingTimeConstant = PARAMS.audio.smoothing;
      node.connect(analyser);
      analyser.connect(audioCtx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    }
    await audioCtx.resume();
  } catch (err) {
    // Sin análisis (p. ej. abierto como file://): la canción igual suena
    console.warn('Analizador de audio no disponible:', err);
    analyser = null;
  }
  try {
    await audioEl.play();
  } catch (err) {
    console.warn('No se pudo reproducir el audio:', err);
  }
  state.started = true;
  sim.kick();
}

// Promedio normalizado (0..1) de una banda de frecuencias en Hz
function bandAvg(lo, hi) {
  const binHz = audioCtx.sampleRate / 2 / freq.length;
  const i0 = Math.max(0, Math.floor(lo / binHz));
  const i1 = Math.min(freq.length - 1, Math.ceil(hi / binHz));
  let s = 0;
  for (let i = i0; i <= i1; i++) s += freq[i];
  return s / ((i1 - i0 + 1) * 255);
}

const ema = (prev, v, tau, dt) => prev + (v - prev) * (1 - Math.exp(-dt / tau));

// Normalización automática de nivel (cada banda se ajusta a su propio pico)
const peaks = { bass: 0.3, mid: 0.3, high: 0.3 };
function agc(key, v, dt) {
  peaks[key] = Math.max(v, peaks[key] - dt * 0.02, PARAMS.audio.agcFloor);
  return v / peaks[key];
}

// Estado de detección
let bassAvg = 0;
let eFast = 0, eSlow = 0;
let hFast = 0, hSlow = 0;
let lastBeat = -1, lastDrop = -10, lastPeak = -1;
let playTime = 0;

audioEl.addEventListener('seeked', () => {
  // Evita falsos drops justo después de mover el slider
  eSlow = eFast;
  hSlow = hFast;
  playTime = 0;
});

function analyse(dt, t) {
  a.beat = false;
  a.drop = false;
  a.peak = false;

  const playing = !!analyser && !audioEl.paused && !audioEl.ended;
  let nb, nm, nh;

  if (playing) {
    analyser.getByteFrequencyData(freq);
    const B = PARAMS.audio.bands;
    nb = agc('bass', bandAvg(B.bass[0], B.bass[1]), dt);
    nm = agc('mid', bandAvg(B.mid[0], B.mid[1]), dt);
    nh = agc('high', bandAvg(B.high[0], B.high[1]), dt);

    // 64 bandas logarítmicas (40 Hz – 14 kHz) para animar edificios
    for (let i = 0; i < BINS; i++) {
      const f0 = 40 * Math.pow(350, i / BINS);
      const f1 = 40 * Math.pow(350, (i + 1) / BINS);
      const v = Math.min(1, bandAvg(f0, f1) * 1.4);
      a.bins[i] = a.bins[i] + (v - a.bins[i]) * 0.5;
    }
    playTime += dt;
  } else {
    // Sin música: respiración suave para que la escena no quede muerta
    nb = 0.18 + 0.08 * Math.sin(t * 1.3);
    nm = 0.15 + 0.06 * Math.sin(t * 0.9 + 1);
    nh = 0.10 + 0.05 * Math.sin(t * 1.7 + 2);
    for (let i = 0; i < BINS; i++) {
      a.bins[i] = 0.25 + 0.15 * Math.sin(t * 1.2 + i * 0.35);
    }
  }

  nb = Math.min(nb, 1.5); nm = Math.min(nm, 1.5); nh = Math.min(nh, 1.5);

  // Suavizado asimétrico: ataque rápido, caída lenta
  const sm = (prev, v) => prev + (v - prev) * (1 - Math.exp(-dt * (v > prev ? 30 : 7)));
  a.bass = sm(a.bass, nb);
  a.mid = sm(a.mid, nm);
  a.high = sm(a.high, nh);
  a.energy = a.bass * 0.5 + a.mid * 0.3 + a.high * 0.2;

  if (playing) {
    const A = PARAMS.audio;

    // Beat: el bajo supera su promedio reciente
    bassAvg = ema(bassAvg, nb, 0.9, dt);
    if (nb > bassAvg * A.beat.ratio && nb > A.beat.min && t - lastBeat > A.beat.cooldown) {
      a.beat = true;
      a.beatStrength = Math.min(1, Math.max(0.2, (nb - bassAvg) / 0.5));
      a.beatEnv = 1;
      lastBeat = t;
    }

    // Drop: la energía rápida se dispara sobre la lenta
    eFast = ema(eFast, a.energy, 0.12, dt);
    eSlow = ema(eSlow, a.energy, 3.0, dt);
    if (
      playTime > A.drop.warmup &&
      eFast - eSlow > A.drop.threshold &&
      nb > A.drop.minBass &&
      t - lastDrop > A.drop.cooldown
    ) {
      a.drop = true;
      a.dropStrength = Math.min(1, (eFast - eSlow) / 0.5);
      lastDrop = t;
    }

    // Pico de agudos
    hFast = ema(hFast, nh, 0.06, dt);
    hSlow = ema(hSlow, nh, 0.6, dt);
    if (playTime > 1 && hFast - hSlow > A.peak.threshold && t - lastPeak > A.peak.cooldown) {
      a.peak = true;
      lastPeak = t;
    }
  }

  a.beatEnv *= Math.exp(-dt * 7);
}

// ---------- Secuencia automática de escenas ----------
const timeline = [...PARAMS.scenes.timeline].sort((x, y) => x.start - y.start);
function sceneAt(fraction) {
  let idx = timeline[0].scene;
  for (const seg of timeline) if (fraction >= seg.start) idx = seg.scene;
  return idx;
}

let currentScene = 0;

// ---------- Bucle principal ----------
let last = performance.now();
let time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;

  analyse(dt, time);

  const dur = audioEl.duration;
  const cur = audioEl.currentTime || 0;
  panel.sync(cur, dur);

  const fraction = dur > 0 && isFinite(dur) ? cur / dur : cur / PARAMS.scenes.fallbackDuration;
  const idx = sceneAt(fraction);
  if (idx !== currentScene) {
    currentScene = idx;
    sim.setScene(idx);
  }

  sim.update(dt, time, a, cur);
  sim.render(time);
}
requestAnimationFrame(frame);