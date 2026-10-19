// ============================================================
//  parameters.js
//  Todo lo "ajustable" del proyecto vive aquí: valores por
//  defecto, definición de los sliders del panel y presets.
//  Si quieres cambiar el look, empieza por este archivo.
// ============================================================

// La canción está en /public/la cancion.mp3 → Vite la sirve en la raíz.
// El espacio del nombre se codifica como %20.
const BASE = import.meta.env?.BASE_URL ?? '/';
export const AUDIO_SRC = `${BASE}la%20cancion.mp3`;
export const AUDIO_NAME = 'la cancion.mp3';

// Configuración "fija" (no aparece en el panel)
export const config = {
  fftSize: 2048,          // resolución del análisis de audio
  bandsCount: 48,         // barras del ecualizador
  bands: {                // rangos de frecuencia (Hz)
    bass: [20, 150],
    mid: [150, 2000],
    treble: [2000, 9000],
  },
  baseHue: 135,           // tono HSL del verde matriz
  glyphs:
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789<>/\\|=+*:;',
  storageKey: 'sci-fi-matrix-city-v1',
};

// Valores iniciales de todos los parámetros
export const defaultParams = {
  // --- Audio ---
  volume: 0.85,
  sensitivity: 1.0,
  smoothing: 0.6,
  beatThreshold: 1.3,
  idleMotion: true,       // animación suave cuando no suena la canción

  // --- Ciudad cifrada ---
  showCity: true,
  buildingDensity: 1.0,
  buildingHeight: 1.0,
  glyphSize: 11,
  citySpeed: 0.25,
  buildingPulse: 0.6,

  // --- Lluvia matrix ---
  showRain: true,
  rainDensity: 0.75,
  rainSpeed: 1.0,
  rainTrail: 16,

  // --- Láseres de discoteca ---
  showLasers: true,
  autoPattern: true,      // cambia de coreografía cada 8 beats
  laserCount: 8,
  laserWidth: 1.0,
  laserSweep: 0.8,
  laserSpeed: 1.0,
  laserFog: 0.4,

  // --- Retro ---
  showSun: true,
  showGrid: true,
  showBars: true,
  horizon: 0.64,
  gridSpeed: 1.0,
  gridGlow: 0.9,

  // --- Postproceso ---
  bloom: 0.8,
  scanlines: 0.4,
  glitch: 0.5,
  shake: 0.4,
  hue: 0,
};

// Estos parámetros obligan a regenerar los edificios al cambiar
export const regenKeys = ['buildingDensity', 'buildingHeight', 'glyphSize'];

// Definición de controles para el panel (labPanel.js)
export const paramDefinitions = [
  // Audio
  { group: 'Audio', key: 'volume', label: 'Volumen', min: 0, max: 1, step: 0.01 },
  { group: 'Audio', key: 'sensitivity', label: 'Sensibilidad', min: 0.4, max: 2.5, step: 0.05 },
  { group: 'Audio', key: 'smoothing', label: 'Suavizado', min: 0.2, max: 0.95, step: 0.01 },
  { group: 'Audio', key: 'beatThreshold', label: 'Umbral de beat', min: 1.1, max: 2, step: 0.01 },
  { group: 'Audio', key: 'idleMotion', label: 'Movimiento en reposo', type: 'toggle' },

  // Ciudad
  { group: 'Ciudad', key: 'showCity', label: 'Mostrar edificios', type: 'toggle' },
  { group: 'Ciudad', key: 'buildingDensity', label: 'Densidad', min: 0.5, max: 1.8, step: 0.05 },
  { group: 'Ciudad', key: 'buildingHeight', label: 'Altura', min: 0.5, max: 1.5, step: 0.05 },
  { group: 'Ciudad', key: 'glyphSize', label: 'Tamaño de glifo', min: 8, max: 20, step: 1 },
  { group: 'Ciudad', key: 'citySpeed', label: 'Velocidad de cámara', min: 0, max: 1.5, step: 0.01 },
  { group: 'Ciudad', key: 'buildingPulse', label: 'Pulso con el bajo', min: 0, max: 1.5, step: 0.01 },

  // Lluvia
  { group: 'Lluvia', key: 'showRain', label: 'Mostrar lluvia', type: 'toggle' },
  { group: 'Lluvia', key: 'rainDensity', label: 'Densidad', min: 0, max: 1, step: 0.01 },
  { group: 'Lluvia', key: 'rainSpeed', label: 'Velocidad', min: 0.3, max: 3, step: 0.05 },
  { group: 'Lluvia', key: 'rainTrail', label: 'Largo de estela', min: 6, max: 30, step: 1 },

  // Láseres
  { group: 'Láseres', key: 'showLasers', label: 'Mostrar láseres', type: 'toggle' },
  { group: 'Láseres', key: 'autoPattern', label: 'Cambio auto de patrón', type: 'toggle' },
  { group: 'Láseres', key: 'laserCount', label: 'Cantidad', min: 2, max: 12, step: 1 },
  { group: 'Láseres', key: 'laserWidth', label: 'Grosor', min: 0.3, max: 3, step: 0.05 },
  { group: 'Láseres', key: 'laserSweep', label: 'Barrido', min: 0.2, max: 1.4, step: 0.01 },
  { group: 'Láseres', key: 'laserSpeed', label: 'Velocidad', min: 0.2, max: 3, step: 0.05 },
  { group: 'Láseres', key: 'laserFog', label: 'Niebla de luz', min: 0, max: 1, step: 0.01 },

  // Retro
  { group: 'Retro', key: 'showSun', label: 'Sol retro', type: 'toggle' },
  { group: 'Retro', key: 'showGrid', label: 'Grilla del piso', type: 'toggle' },
  { group: 'Retro', key: 'showBars', label: 'Ecualizador LED', type: 'toggle' },
  { group: 'Retro', key: 'horizon', label: 'Horizonte', min: 0.5, max: 0.8, step: 0.01 },
  { group: 'Retro', key: 'gridSpeed', label: 'Velocidad de grilla', min: 0, max: 3, step: 0.05 },
  { group: 'Retro', key: 'gridGlow', label: 'Brillo de grilla', min: 0, max: 1.5, step: 0.01 },

  // Postproceso
  { group: 'Postproceso', key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.01 },
  { group: 'Postproceso', key: 'scanlines', label: 'Scanlines CRT', min: 0, max: 1, step: 0.01 },
  { group: 'Postproceso', key: 'glitch', label: 'Glitch en beat', min: 0, max: 1, step: 0.01 },
  { group: 'Postproceso', key: 'shake', label: 'Temblor de cámara', min: 0, max: 1, step: 0.01 },
  { group: 'Postproceso', key: 'hue', label: 'Giro de color (°)', min: -60, max: 90, step: 1 },
];

// Presets: se aplican sobre los valores por defecto
export const presets = {
  'Matrix clásico': {
    rainDensity: 1, rainSpeed: 1.2, rainTrail: 22, laserCount: 4, laserFog: 0.2,
    showSun: false, glitch: 0.3, bloom: 0.7,
  },
  'Discoteca': {
    laserCount: 12, laserSweep: 1.1, laserSpeed: 1.6, laserFog: 0.75, laserWidth: 1.3,
    bloom: 1.1, glitch: 0.7, hue: 18, rainDensity: 0.5, shake: 0.6,
  },
  'Ciber-calma': {
    citySpeed: 0.1, laserCount: 4, laserSpeed: 0.5, laserFog: 0.25, bloom: 0.6,
    rainDensity: 0.5, rainSpeed: 0.7, glitch: 0.15, shake: 0.1, gridSpeed: 0.6,
  },
  'Overdrive': {
    laserCount: 12, laserSweep: 1.3, laserSpeed: 2.2, laserFog: 0.9, laserWidth: 1.6,
    rainDensity: 1, rainSpeed: 2, bloom: 1.4, glitch: 1, shake: 1,
    citySpeed: 0.6, gridSpeed: 2.2, buildingPulse: 1.2, sensitivity: 1.4,
  },
};