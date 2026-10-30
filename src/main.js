// =====================================================================
//  main.js — Bucle de render, AudioContext + analizador de frecuencias,
//  detección de beats/drops y transición automática de escenas.
// =====================================================================
import { PARAMS, state, attachSourceFallback } from './simulation/parameters.js';
import { createLabPanel } from './ui/labPanel.js';
import { createSimulation } from './simulation/createSimulation.js';

const canvas = document.getElementById('stage');
const audioEl = document.getElementById('song');
const intro = document.getElementById('intro');
const introLabel = document.getElementById('intro-label');
const introText = document.getElementById('intro-text');
const loader = document.getElementById('loader');
const loaderLabel = document.getElementById('loader-label');
const loaderTime = document.getElementById('loader-time');
const loaderProgress = document.getElementById('loader-progress');
const subtitle = document.getElementById('subtitle');
const introPhrases = ['DATA', 'Tainy', 'Rauw Alejandro', 'Sci-Fi'];
const lyrics = [
  'Esta noche otra vez la veo, oh-oh',
  'Aguantarme las gana’ no puedo, bebé',
  'No sé cómo voy a pasar',
  'Pero sé cómo va a terminar',
  'Es que todavía no puedo explicar',
  'Lo rica, mami, que tú estás',
  'En un rato otra vez la veo, oh-oh',
  'Aguantarme las gana’ no puedo, bebé',
  'No sé cómo voy a pasar',
  'Pero sé cómo va a terminar',
  'Es que todavía no puedo explicar',
  'Lo rica, mami, que tú estás, yeah',
  'Ya estoy afuera',
  'La veo y todo se me acelera',
  'Mi lambo pega con tu cartera',
  'Algo mágico pasa cuando estamo’ tú y yo',
  'Esto es una movie, me siento en L.A., eh',
  'Hoy llegamo’ después de las 6:00, ey',
  'Yo te deseo y no te vo’a dar break',
  'Por ti yo rompo la ley, yeah',
  '¿A qué sabes tú?',
  'Te pienso to el día',
  'Yo me muero por tenerte',
  'Ven, ¿por qué te me resistes?',
  'Si tú me deseas, ma',
  'Se te nota en tu mirada',
  'Que no quieres que me vaya, baby',
  'En un rato otra vez la veo',
  'Aguantarme las gana’ no puedo, bebé',
  'No sé cómo voy a pasar',
  'Pero sé cómo va a terminar',
  'Es que todavía no puedo explicar',
  'Lo rica, mami, que tú estás, eh',
  'Mamichula, estoy al borde de la locura',
  'La más cara de toda’ las pinturas',
  'Tus besos toa’ las penas me curan',
  'Te tengo desnuda',
  'Quieres to, de eso no tengo duda',
  'Me estrellé en las curva’ de tu cintura',
  'Llegó el momento, se acabó la tortura',
  '¿A qué sabes tú?',
  'Te pienso to el día',
  'Yo me muero por tenerte',
  'Ven, ¿por qué te me resistes?',
  'Si tú me deseas, ma',
  'Se te nota en tu mirada',
  'Que no quieres que me vaya, baby',
  'En un rato otra vez la veo, oh',
  'Aguantarme las gana’ no puedo, bebé',
  'No sé cómo voy a pasar',
  'Pero sé cómo va a terminar',
  'Es que todavía no puedo explicar',
  'Lo rica, mami, que tú estás, eh',
  'Yeah',
  'Ra-Rauw, Rauw Alejandro',
  'Con Tainy',
  'Yeah, yeah, yeah',
  'Uh-uh',
];
const keys = new Map(
  [...document.querySelectorAll('.key')].map((key) => [key.dataset.key, key])
);

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
  let playbackStarted = false;
  try {
    await audioEl.play();
    playbackStarted = true;
  } catch (err) {
    console.warn('No se pudo reproducir el audio:', err);
  }
  if (!playbackStarted) {
    introLabel.textContent = 'NO SE PUDO INICIAR EL AUDIO';
    return;
  }
  state.started = true;
  intro.classList.add('is-started');
  introLabel.textContent = 'ESCRIBIENDO AL RITMO';
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

let currentScene = 0;
let visualsStarted = false;
let nextSceneChange = PARAMS.scenes.visualStart;
let currentPhrase = 0;
let typedCharacters = 0;
let lastTypedAt = 0;
let phrasePauseUntil = 0;
let subtitleCueIndex = -1;
let subtitlesEnabled = true;
const lyricSections = [
  { start: 34, end: 72, firstLine: 0, lineCount: 12 },
  { start: 72, end: 90, firstLine: 12, lineCount: 8 },
  { start: 90, end: 110, firstLine: 20, lineCount: 7 },
  { start: 110, end: 130, firstLine: 27, lineCount: 6 },
  { start: 130, end: 148, firstLine: 33, lineCount: 7 },
  { start: 148, end: 167, firstLine: 40, lineCount: 7 },
  { start: 167, end: 206, firstLine: 47, lineCount: 6 },
  { start: 206, end: 241, firstLine: 53, lineCount: 5 },
].map((section) => {
  const weights = lyrics
    .slice(section.firstLine, section.firstLine + section.lineCount)
    .map((line) => Math.max(1, line.replace(/[’'.,!?¿¡]/g, '').length) ** 0.7);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedWeight = 0;
  const cues = weights.map((weight, offset) => {
    const cue = {
      lineIndex: section.firstLine + offset,
      start: section.start + (elapsedWeight / totalWeight) * (section.end - section.start),
    };
    elapsedWeight += weight;
    return cue;
  });
  return { ...section, cues };
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target === document.getElementById('seek')) return;
  event.preventDefault();
  if (!state.started) return;

  subtitlesEnabled = !subtitlesEnabled;
  if (!subtitlesEnabled) {
    subtitle.textContent = '';
    subtitle.classList.remove('is-visible');
  }
});

function typeNextCharacter(songTime) {
  const phrase = introPhrases[currentPhrase];
  if (typedCharacters >= phrase.length) {
    if (currentPhrase === introPhrases.length - 1) return;
    phrasePauseUntil = songTime + 0.65;
    currentPhrase++;
    typedCharacters = 0;
    return;
  }

  const character = phrase[typedCharacters++];
  introText.textContent += character;
  lastTypedAt = songTime;
  for (const key of keys.values()) key.classList.remove('is-active');
  const activeKey = keys.get(character.toLowerCase());
  if (activeKey) {
    activeKey.classList.add('is-active');
    window.setTimeout(() => activeKey.classList.remove('is-active'), 150);
  }
  if (typedCharacters === phrase.length && currentPhrase === introPhrases.length - 1) {
    intro.classList.add('is-loading');
    introLabel.textContent = 'SECUENCIA LISTA';
    loader.classList.remove('hidden');
    loaderLabel.textContent = 'CARGANDO VISUALES';
  }
}

function updateIntro(songTime, beat) {
  const loadDuration = PARAMS.scenes.visualStart;
  const remaining = Math.max(0, Math.ceil(loadDuration - songTime));
  const seconds = String(remaining).padStart(2, '0');
  loaderTime.textContent = `00:${String(Math.min(loadDuration, Math.floor(songTime))).padStart(2, '0')} / 00:${String(loadDuration).padStart(2, '0')}`;
  loaderProgress.style.width = `${Math.max(0, Math.min(100, (songTime / loadDuration) * 100))}%`;

  if (songTime >= PARAMS.scenes.introDismissAt) {
    intro.classList.add('is-hidden');
    return;
  }

  intro.classList.remove('is-hidden');
  if (!state.started) return;

  if (phrasePauseUntil && songTime >= phrasePauseUntil) {
    introText.textContent = '';
    phrasePauseUntil = 0;
    lastTypedAt = songTime;
  }

  const phrase = introPhrases[currentPhrase];
  if (typedCharacters < phrase.length && !phrasePauseUntil && (
    beat || songTime - lastTypedAt >= 0.58
  )) {
    typeNextCharacter(songTime);
  } else if (typedCharacters === phrase.length && currentPhrase < introPhrases.length - 1 && !phrasePauseUntil) {
    typeNextCharacter(songTime);
  }
}

function updateSubtitle(songTime, duration) {
  if (
    !subtitlesEnabled ||
    !state.started ||
    !(duration > 0) ||
    !Number.isFinite(duration) ||
    songTime < lyricSections[0].start ||
    songTime >= duration
  ) {
    subtitle.textContent = '';
    subtitle.classList.remove('is-visible');
    subtitleCueIndex = -1;
    return;
  }

  const section = lyricSections.find((item) => songTime >= item.start && songTime < item.end);
  let cueIndex = lyrics.length - 1;
  if (section) {
    cueIndex = section.firstLine;
    for (let i = section.cues.length - 1; i >= 0; i--) {
      if (songTime >= section.cues[i].start) {
        cueIndex = section.cues[i].lineIndex;
        break;
      }
    }
  }

  if (cueIndex !== subtitleCueIndex) {
    subtitle.textContent = lyrics[cueIndex];
    subtitleCueIndex = cueIndex;
  }
  subtitle.classList.add('is-visible');
}

function pickNextScene(previous) {
  const choices = sim.scenes.map((_, index) => index).filter((index) => index !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

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
  updateIntro(cur, a.beat);
  updateSubtitle(cur, dur);

  const startAt = PARAMS.scenes.visualStart;
  if (cur >= startAt) {
    if (!visualsStarted || cur >= nextSceneChange) {
      currentScene = pickNextScene(currentScene);
      sim.setScene(currentScene);
      visualsStarted = true;
      const [min, max] = PARAMS.scenes.randomInterval;
      nextSceneChange = cur + min + Math.random() * (max - min);
    }
  } else if (visualsStarted) {
    visualsStarted = false;
    nextSceneChange = startAt;
  }

  sim.update(dt, time, a, cur);
  sim.render(time);
}
requestAnimationFrame(frame);