// ============================================================
//  main.js
//  Punto de entrada: crea la simulación y el panel, los conecta
//  entre sí, maneja el overlay de inicio, el HUD y el teclado.
// ============================================================

import './styles.css';
import { createSimulation } from './simulation/createSimulation.js';
import { createLabPanel } from './ui/labPanel.js';
import { AUDIO_NAME, config, defaultParams, paramDefinitions, presets } from './simulation/parameters.js';

const $ = (id) => document.getElementById(id);

// ---------- parámetros guardados (localStorage) ----------
function loadSaved() {
  try {
    const raw = localStorage.getItem(config.storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let saveTimer = 0;
function scheduleSave(params) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(params));
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, 300);
}

// ---------- elementos de la página ----------
const canvas = $('scene');
const overlay = $('start-overlay');
const overlayMsg = $('overlay-msg');
const startBtn = $('start-btn');
const demoBtn = $('demo-btn');
const hudStatus = $('hud-status');
const hudBpm = $('hud-bpm');
const hudTime = $('hud-time');
$('track-name').textContent = AUDIO_NAME;

// ---------- simulación ----------
let panel = null;
let hudClock = 0;

const sim = createSimulation(canvas, {
  initialParams: loadSaved(),
  onState(e) {
    if (e.type === 'play') {
      hudStatus.textContent = '▶ SEÑAL ACTIVA';
      if (panel) panel.setPlaying(true);
    } else if (e.type === 'pause') {
      hudStatus.textContent = '❚❚ EN PAUSA';
      if (panel) panel.setPlaying(false);
    } else if (e.type === 'error') {
      hudStatus.textContent = '○ SIN SEÑAL';
      overlayMsg.textContent = e.message;
      overlayMsg.hidden = false;
    } else if (e.type === 'ready') {
      overlayMsg.hidden = true;
    }
  },
  onFrame(levels) {
    if (panel) panel.update(levels);
    // el HUD de texto se refresca ~8 veces por segundo
    const now = performance.now();
    if (now - hudClock > 120) {
      hudClock = now;
      hudBpm.textContent = levels.bpm ? `${Math.round(levels.bpm)} BPM` : '-- BPM';
      hudTime.textContent = formatTime(levels.time, levels.duration);
    }
  },
});

function formatTime(t, d) {
  const f = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return d ? `${f(t)} / ${f(d)}` : f(t);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}

// ---------- panel ----------
panel = createLabPanel({
  mount: $('panel-root'),
  params: sim.params,
  definitions: paramDefinitions,
  presets,
  onParam(key, value) {
    sim.setParam(key, value);
    scheduleSave(sim.params);
  },
  onPreset(_name, values) {
    sim.applyPreset(values);
    scheduleSave(sim.params);
  },
  onReset() {
    sim.resetParams();
    scheduleSave(sim.params);
  },
  onRegenerate: () => sim.regenerateCity(),
  onNextPattern: () => sim.nextPattern(),
  onTogglePlay: () => sim.toggle(),
  onFullscreen: toggleFullscreen,
});
panel.setPlaying(sim.isPlaying());

// ---------- overlay de inicio ----------
// Los navegadores solo dejan reproducir audio tras un gesto del usuario.
function closeOverlay() {
  overlay.classList.add('is-hidden');
  setTimeout(() => { overlay.hidden = true; }, 600);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  const ok = await sim.play();
  startBtn.disabled = false;
  if (ok) closeOverlay();
});
demoBtn.addEventListener('click', closeOverlay);

// ---------- teclado ----------
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.code) {
    case 'Space':
      if (!overlay.hidden) return;
      e.preventDefault();
      sim.toggle();
      break;
    case 'KeyH': panel.toggleHidden(); break;
    case 'KeyF': toggleFullscreen(); break;
    case 'KeyR': sim.regenerateCity(); break;
    case 'KeyP': sim.nextPattern(); break;
    default: break;
  }
});

sim.start();

// Ayuda para depurar desde la consola del navegador
window.__sim = sim;
window.__defaults = defaultParams;