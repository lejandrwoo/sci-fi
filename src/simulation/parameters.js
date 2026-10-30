// =====================================================================
//  parameters.js — Todo lo ajustable del visualizador vive aquí.
// =====================================================================

export const PARAMS = {
  // ---------- Archivos ----------
  // Se prueban en orden hasta que uno responda:
  //  '/'          -> Vite (la carpeta public/ se sirve en la raíz)
  //  './public/'  -> servidor estático abierto en la raíz del proyecto
  //  './'         -> archivos junto al index.html
  assets: {
    bases: ['/', './public/', './'],
    audio: 'la%20cancion.mp3',
    videos: ['anim1.mp4', 'anim2.mp4', 'anim3.mp4'],
    dataVideo: 'DATA.mp4',
  },

  // ---------- Chroma key de fondo negro ----------
  // Se compara el canal más brillante (max(r,g,b)) de cada píxel:
  //  luma <= threshold              -> alfa 0 (transparente)
  //  threshold < luma < +softness   -> degradado suave (borde sin "halo" negro)
  //  luma >= threshold + softness   -> opaco
  // Sube threshold si ves un recuadro gris; bájalo si se comen los tonos oscuros.
  chroma: {
    threshold: 0.10,
    softness: 0.08,
  },

  // Altura (en unidades 3D) del plano que muestra cada video
  video: { height: 5.4, featuredHeight: 6.1 },

  // ---------- Colores ----------
  colors: {
    club: {
      bg: 0x05020a,
      green: 0x39ff14,
      orange: 0xff7a00,
      palettes: [
        { green: 0x39ff14, orange: 0xff7a00 },
        { green: 0x00e5ff, orange: 0xff38b8 },
        { green: 0x9b5cff, orange: 0xffcf4a },
        { green: 0x45ffb0, orange: 0xff5068 },
      ],
    },
    matrix: { bg: 0x06070a, white: 0xffffff, ice: 0xdfe9ff },
    city: {
      bg: 0x020b05,
      skyTop: 0x010905,
      skyMid: 0x073b1b,
      skyHorizon: 0x20b45a,
      neonA: 0x39ff14,
      neonB: 0x00d878,
      amber: 0xa6ff70,
      building: 0x071b10,
      grid: 0x22ff66,
      star: 0x9cffb0,
      comets: [0x9cffb0, 0x39ff14, 0x00d878],
    },
  },

  // ---------- Audio ----------
  audio: {
    fftSize: 2048,
    smoothing: 0.75,
    loop: true,
    bands: { bass: [30, 150], mid: [150, 2000], high: [2500, 12000] }, // Hz
    agcFloor: 0.25,            // piso de la normalización automática de nivel
    beat: { ratio: 1.3, min: 0.35, cooldown: 0.22 },
    // "Drop": la energía rápida supera a la lenta por este margen
    drop: { threshold: 0.22, minBass: 0.6, cooldown: 2.0, warmup: 3.0 },
    // "Pico" de agudos (dispara cometas)
    peak: { threshold: 0.22, cooldown: 0.35 },
  },

  // ---------- Secuencia de escenas ----------
  // start = fracción (0..1) de la duración total de la canción.
  // scene: 0 = discoteca (anim1), 1 = edificios blancos (anim2), 2 = ciudad/cielo (anim3), 3 = DATA
  // Ajusta estas fracciones cuando conozcas los momentos exactos de la canción.
  scenes: {
    crossfade: 2.6,        // segundos de fundido entre escenas
    visualStart: 25,      // segundos de canción antes de mostrar los visuales
    introDismissAt: 24,    // la intro desaparece un segundo antes de los visuales
    randomInterval: [4.5, 7.5], // tiempo entre cambios de escena
  },

  // ---------- Glitches / destellos / distorsiones ----------
  glitch: {
    randomInterval: [6.0, 13.0], // segundos entre glitches aleatorios (se acorta con la energía)
    beatChance: 0.035,           // probabilidad de micro-glitch en cada beat fuerte
    // Pesos de los efectos aleatorios:
    //  signal = señal interferida · warp = salto hiperespacial · flash = destello
    //  pixel = datos corruptos · invert = parpadeo negativo · rgb = aberración cromática
    //  shake = sacudida de cámara · zoom = golpe de zoom
    weights: { signal: 3, warp: 2, flash: 2, pixel: 1.5, invert: 0.6, rgb: 3, shake: 1.5, zoom: 1.5 },
    // Efectos fijos en un segundo exacto de la canción (para acompañar la letra):
    // { at: 42.5, fx: 'warp', amp: 1 }
    cues: [],
  },

  // ---------- Cámara / render ----------
  camera: {
    fovDesktop: 55,
    fovPortrait: 78,           // celulares en vertical
    portraitDistanceScale: 1.25,
    near: 0.1,
    far: 1200,
    maxPixelRatioDesktop: 2,
    maxPixelRatioMobile: 1.5,
  },

  // Factor de partículas/edificios en pantallas táctiles o pequeñas
  quality: { mobileFactor: 0.5 },

  ui: {
    showStartHint: false, // la pantalla de teclado ya muestra la instrucción para iniciar
    hintText: 'toca la pantalla o pulsa una tecla para iniciar',
  },
};

// Estado compartido
export const state = {
  started: false,
  presentation: false,
};

// Carga un <audio>/<video> probando cada base de PARAMS.assets.bases
export function attachSourceFallback(el, file, onFail) {
  const urls = PARAMS.assets.bases.map((b) => b + file);
  let i = 0;
  const next = () => {
    if (i >= urls.length) {
      el.removeEventListener('error', next);
      if (onFail) onFail();
      return;
    }
    el.src = urls[i++];
    el.load();
  };
  el.addEventListener('error', next);
  el.addEventListener('loadeddata', () => el.removeEventListener('error', next), { once: true });
  next();
}