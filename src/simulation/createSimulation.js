// =====================================================================
//  createsimulation.js — Escenas 3D, VideoTexture + chroma key negro (GLSL),
//  postproceso de glitches y director de efectos aleatorios.
// =====================================================================
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { PARAMS, attachSourceFallback } from './parameters.js';

// ---------- Utilidades ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const deg = THREE.MathUtils.degToRad;

const MOBILE =
  (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ||
  Math.min(window.innerWidth, window.innerHeight) < 600;
const Q = MOBILE ? PARAMS.quality.mobileFactor : 1;
const N = (n) => Math.max(1, Math.round(n * Q));

// Pixel ratio compartido por todos los shaders de puntos
const SHARED = { px: { value: 1 } };

const FLOOR_Y = -2.6; // altura del "suelo" bajo los personajes

// =====================================================================
//  Texturas generadas por código
// =====================================================================
function makeDotTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Fachada blanca con ventanas finas (edificios de la escena 2)
function makeWhiteFacadeTexture() {
  const W = 128, H = 256, cols = 6, rows = 16;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const cw = W / cols, ch = H / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const r = Math.random();
      g.fillStyle = r < 0.2 ? '#8e96a3' : '#d3d8e0';
      g.fillRect(x * cw + cw * 0.22, y * ch + ch * 0.25, cw * 0.56, ch * 0.5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Ventanas de neón (emissiveMap) para la ciudad retro de la escena 3
function makeNeonWindowsTexture(palette) {
  const W = 128, H = 256, cols = 4, rows = 8;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const cw = W / cols, ch = H / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (Math.random() < 0.42) {
        g.fillStyle = palette[randInt(0, palette.length - 1)];
        g.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.22, cw * 0.6, ch * 0.5);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeDataHudTexture() {
  const width = 1024;
  const height = 576;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.strokeStyle = 'rgba(145,255,203,0.78)';
  ctx.fillStyle = 'rgba(145,255,203,0.78)';
  ctx.lineWidth = 2;
  ctx.font = 'bold 14px monospace';

  for (const x of [28, width - 28]) {
    for (const y of [28, height - 28]) {
      const sx = x < width / 2 ? 1 : -1;
      const sy = y < height / 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x, y + sy * 28);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * 28, y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 0.42;
  ctx.beginPath();
  ctx.moveTo(48, 66); ctx.lineTo(260, 66);
  ctx.moveTo(width - 250, 66); ctx.lineTo(width - 48, 66);
  ctx.moveTo(48, height - 66); ctx.lineTo(220, height - 66);
  ctx.moveTo(width - 220, height - 66); ctx.lineTo(width - 48, height - 66);
  ctx.stroke();
  for (let x = 48; x < width - 48; x += 8) {
    ctx.fillRect(x, 40, 1, 5);
    ctx.fillRect(x, height - 45, 1, 5);
  }

  ctx.globalAlpha = 0.78;
  ctx.fillText('NEURAL LINK  /  ONLINE', 50, 56);
  ctx.textAlign = 'right';
  ctx.fillText('SYS.04  //  DATA STREAM', width - 50, 56);
  ctx.textAlign = 'left';
  ctx.fillText('SIGNAL: STABLE', 50, height - 44);
  ctx.textAlign = 'right';
  ctx.fillText('ARCHIVE  //  199X', width - 50, height - 44);

  ctx.globalAlpha = 0.32;
  for (let i = 0; i < 9; i++) {
    const barHeight = 5 + ((i * 13) % 17);
    ctx.fillRect(50 + i * 8, height - 92 - barHeight, 3, barHeight);
    ctx.fillRect(width - 122 + i * 8, 84, 3, 5 + ((i * 7) % 15));
  }

  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Caja con UV escaladas para que las ventanas mantengan su tamaño
function makeBoxGeometry(uRepeat, vRepeat) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat);
  uv.needsUpdate = true;
  return geo;
}

// =====================================================================
//  VideoTexture + CHROMA KEY de fondo negro
// =====================================================================
function createVideoSource(file, onMeta) {
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  const src = { video, texture: null, aspect: 16 / 9, failed: false };
  video.addEventListener('loadedmetadata', () => {
    if (video.videoWidth && video.videoHeight) {
      src.aspect = video.videoWidth / video.videoHeight;
      if (onMeta) onMeta();
    }
  });
  attachSourceFallback(video, file, () => {
    src.failed = true;
    console.warn('No se pudo cargar el video:', file);
  });

  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  src.texture = tex;
  return src;
}

const CHROMA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CHROMA_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float uThreshold;
  uniform float uSoftness;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uGlitch;
  uniform float uBeat;
  uniform vec3 uTintGreen;
  uniform vec3 uTintOrange;
  uniform float uTintStrength;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    vec2 uv = vUv;

    // Glitch propio del personaje: tiras horizontales desplazadas + separación RGB
    float band = floor(uv.y * 24.0);
    float tick = floor(uTime * 14.0);
    float on = step(0.72, hash(band * 7.13 + tick));
    uv.x += (hash(band * 91.7 + tick * 13.3) - 0.5) * 0.07 * uGlitch * on;
    float s = 0.012 * uGlitch;

    vec3 col;
    col.r = texture2D(map, uv + vec2(s, 0.0)).r;
    col.g = texture2D(map, uv).g;
    col.b = texture2D(map, uv - vec2(s, 0.0)).b;

    // ---- CHROMA KEY NEGRO ----
    // El negro puro y los grises muy oscuros tienen max(r,g,b) ~ 0.
    float luma = max(col.r, max(col.g, col.b));
    float alpha = smoothstep(uThreshold, uThreshold + uSoftness, luma);
    if (alpha < 0.004) discard;

    float greenMask = smoothstep(0.035, 0.22, col.g - max(col.r, col.b));
    float orangeMask = smoothstep(0.025, 0.18, col.r - max(col.g, col.b))
      * smoothstep(0.0, 0.16, col.g - col.b);
    float brightness = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 greenTint = uTintGreen * (0.3 + brightness * 1.65);
    vec3 orangeTint = uTintOrange * (0.3 + brightness * 1.65);
    col = mix(col, greenTint, greenMask * uTintStrength);
    col = mix(col, orangeTint, orangeMask * uTintStrength);
    col *= 1.0 + uBeat * 0.35;
    gl_FragColor = vec4(col, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

function createChromaMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uThreshold: { value: PARAMS.chroma.threshold },
      uSoftness: { value: PARAMS.chroma.softness },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uBeat: { value: 0 },
      uTintGreen: { value: new THREE.Color(0xffffff) },
      uTintOrange: { value: new THREE.Color(0xffffff) },
      uTintStrength: { value: 0 },
    },
    vertexShader: CHROMA_VERT,
    fragmentShader: CHROMA_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createColorGradeMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uOpacity: { value: 1 },
      uTint: { value: new THREE.Color(0xffffff) },
      uTintStrength: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
    },
    vertexShader: CHROMA_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float uOpacity;
      uniform float uTintStrength;
      uniform float uBeat;
      uniform float uEnergy;
      uniform vec3 uTint;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(map, vUv).rgb;
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        vec3 tinted = mix(color, luminance * uTint, uTintStrength);
        tinted *= 1.0 + uBeat * 0.04 + uEnergy * 0.015;
        gl_FragColor = vec4(tinted, uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

class VideoLayer {
  constructor(file, height, fullscreen = false, chromaKey = true) {
    this.height = height;
    this.fullscreen = fullscreen;
    this.src = createVideoSource(file, () => this.fit());
    this.material = chromaKey
      ? createChromaMaterial(this.src.texture)
      : createColorGradeMaterial(this.src.texture);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 5;
    this._center = new THREE.Vector3();
    this._parentQuaternion = new THREE.Quaternion();
    this._cameraQuaternion = new THREE.Quaternion();
    this.fit();
  }
  fit() {
    this.mesh.scale.set(this.height * this.src.aspect, this.height, 1);
  }
  fitToCamera(camera, center, parent) {
    if (!this.fullscreen) return;

    camera.getWorldQuaternion(this._cameraQuaternion);
    parent.updateWorldMatrix(true, false);
    this._center.copy(center);
    this.mesh.position.copy(parent.worldToLocal(this._center));
    parent.getWorldQuaternion(this._parentQuaternion);
    this.mesh.quaternion.copy(this._parentQuaternion.invert()).multiply(this._cameraQuaternion);

    const distance = camera.position.distanceTo(center);
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const viewWidth = viewHeight * camera.aspect;
    const height = Math.max(viewHeight, viewWidth / this.src.aspect);
    this.mesh.scale.set(height * this.src.aspect, height, 1);
  }
  play() {
    const p = this.src.video.play();
    if (p && p.catch) p.catch(() => {});
  }
  pause() {
    this.src.video.pause();
  }
  // Se llama cada frame desde la escena
  tick(t, glitch, beatEnv, energy = 0) {
    const u = this.material.uniforms;
    if (u.uTime) u.uTime.value = t;
    if (u.uGlitch) u.uGlitch.value = glitch;
    if (u.uBeat) u.uBeat.value = beatEnv;
    if (u.uEnergy) u.uEnergy.value = energy;
    if (u.uThreshold) u.uThreshold.value = PARAMS.chroma.threshold;
    if (u.uSoftness) u.uSoftness.value = PARAMS.chroma.softness;
    this.mesh.visible = !this.src.failed;
  }
}

// =====================================================================
//  Puntos luminosos con tamaño/brillo por vértice (estrellas, cometas)
// =====================================================================
function createGlowPoints(count, { twinkle = 0 } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(count), 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uPx: SHARED.px,
      uTwinkle: { value: twinkle },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPx;
      uniform float uTwinkle;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vColor = aColor;
        float tw = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (1.5 + aPhase * 0.3) + aPhase * 6.2831));
        vTw = tw;
        gl_PointSize = aSize * uPx * (0.6 + 0.4 * tw);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vColor * vTw, a * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, material, geometry };
}

// =====================================================================
//  Anillos que se expanden por el suelo en cada beat
// =====================================================================
class RingPool {
  constructor(owner, y, n = 5) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.94, 1, 72);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.visible = false;
      mesh.renderOrder = 1;
      owner.group.add(mesh);
      this.items.push({ mesh, rec: owner.fade(mat, 0), life: 0, dur: 1.3, speed: 14, amp: 1, active: false });
    }
  }
  spawn(strength = 1, color = null) {
    const it = this.items.find((i) => !i.active) || this.items[0];
    it.active = true;
    it.life = 0;
    it.amp = strength;
    if (color !== null) it.mesh.material.color.set(color);
    it.mesh.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.life += dt;
      const p = it.life / it.dur;
      if (p >= 1) {
        it.active = false;
        it.mesh.visible = false;
        it.rec.base = 0;
        continue;
      }
      const s = 1 + p * it.speed;
      it.mesh.scale.set(s, s, s);
      it.rec.base = (1 - p) * (1 - p) * 0.9 * it.amp;
    }
  }
}

// =====================================================================
//  Escena base
// =====================================================================
class BaseScene {
  constructor(name) {
    this.name = name;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.fades = [];
    this.opacity = 0;
    this.playing = false;
    this.bg = new THREE.Color(0x000000);
    this.fogDensity = 0.02;
    this.cam = { pos: new THREE.Vector3(0, 0.8, 9.5), look: new THREE.Vector3(0, 0, 0) };
    this.accentColors = [new THREE.Color(0xffffff)];
    this.video = null;
  }
  // Registra un material para que respete el fundido entre escenas
  fade(material, base = 1) {
    const rec = { material, base };
    material.transparent = true;
    this.fades.push(rec);
    return rec;
  }
  setOpacity(o) {
    this.opacity = o;
    this.group.visible = o > 0.002;
  }
  applyFade() {
    for (const f of this.fades) {
      const m = f.material;
      const v = this.opacity * f.base;
      if (m.uniforms && m.uniforms.uOpacity) m.uniforms.uOpacity.value = v;
      else m.opacity = v;
    }
  }
  pickAccent() {
    return this.accentColors[Math.floor(Math.random() * this.accentColors.length)];
  }
  enter() { if (this.video) this.video.play(); }
  leave() { if (this.video) this.video.pause(); }
  onBeat() {}
  onDrop() {}
  onPeak() {}
  lights() {}
  update() {}
}

// =====================================================================
//  ESCENA 1 — Discoteca (anim1: personaje verde entre gente naranja)
// =====================================================================
class ClubScene extends BaseScene {
  constructor() {
    super('club');
    const C = PARAMS.colors.club;
    this.bg.set(C.bg);
    this.fogDensity = 0.03;
    this.palettes = C.palettes.map(({ green, orange }) => ({
      green: new THREE.Color(green),
      orange: new THREE.Color(orange),
    }));
    this.green = this.palettes[0].green.clone();
    this.orange = this.palettes[0].orange.clone();
    this.variantIndex = 0;
    this.accentColors = [this.green, this.orange];
    this.flip = false;
    this.boost = 0;

    // Video con chroma key
    this.video = new VideoLayer(PARAMS.assets.videos[0], PARAMS.video.featuredHeight, true);
    this.video.material.uniforms.uTintGreen.value.copy(this.green);
    this.video.material.uniforms.uTintOrange.value.copy(this.orange);
    this.video.material.uniforms.uTintStrength.value = 0.88;
    this.group.add(this.video.mesh);
    this.fade(this.video.material);

    // Halo detrás del personaje
    this.dot = makeDotTexture();
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.dot, color: C.green, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.halo.position.set(0, 0, -0.4);
    this.halo.scale.set(9, 9, 1);
    this.halo.renderOrder = 2;
    this.haloFade = this.fade(this.halo.material, 0.4);
    this.group.add(this.halo);

    // Pista de baile: tablero de neón verde/naranja
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uOpacity: { value: 1 },
        uA: { value: this.green },
        uB: { value: this.orange },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uBass; uniform float uOpacity;
        uniform vec3 uA; uniform vec3 uB;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 40.0;
          vec2 id = floor(p);
          float chk = mod(id.x + id.y, 2.0);
          float d = length(p);
          float wave = 0.5 + 0.5 * sin(d * 0.8 - uTime * 3.0);
          float lit = step(0.5, fract(sin(dot(id, vec2(12.9898, 78.233)) + floor(uTime * 2.0)) * 43758.5453));
          vec3 col = mix(uA, uB, chk);
          float inten = (0.05 + 0.6 * uBass * wave) * (0.4 + 0.6 * lit);
          vec2 f = abs(fract(p) - 0.5);
          float line = smoothstep(0.46, 0.5, max(f.x, f.y));
          vec3 c = col * inten + col * line * (0.25 + 0.5 * uBass);
          float mask = smoothstep(20.0, 4.0, d);
          gl_FragColor = vec4(c, mask * uOpacity * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.renderOrder = 0;
    this.group.add(floor);
    this.fade(this.floorMat);

    // Láseres de discoteca
    const beamGeo = new THREE.CylinderGeometry(0.015, 0.06, 1, 8, 1, true);
    beamGeo.translate(0, -0.5, 0);
    this.beams = [];
    const nb = N(28);
    for (let i = 0; i < nb; i++) {
      const pivot = new THREE.Group();
      const ang = (i / nb) * Math.PI * 2;
      pivot.position.set(Math.cos(ang) * 4.5, 6.5, -2 + Math.sin(ang) * 3);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? this.orange : this.green,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const beam = new THREE.Mesh(beamGeo, mat);
      beam.scale.set(1, 18, 1);
      beam.renderOrder = 1;
      pivot.add(beam);
      this.group.add(pivot);
      this.beams.push({ pivot, beam, phase: rand(0, 6.28), speed: rand(0.5, 1.4) });
      this.fade(mat, 0.55);
    }

    // Bola disco
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2, flatShading: true });
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 2), ballMat);
    this.ball.position.set(0, 6.0, -2);
    this.group.add(this.ball);
    this.fade(ballMat);
    const wireMat = new THREE.MeshBasicMaterial({
      color: this.green, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.ballWire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.83, 2), wireMat);
    this.ballWire.position.copy(this.ball.position);
    this.group.add(this.ballWire);
    this.fade(wireMat, 0.35);

    // Partículas (confeti / polvo de club)
    const n = N(1400);
    this.pCount = n;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    this.pColorGroup = new Uint8Array(n);
    this.pSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-12, 12);
      pos[i * 3 + 1] = rand(-3, 9);
      pos[i * 3 + 2] = rand(-10, 6);
      this.pColorGroup[i] = Math.random() < 0.5 ? 0 : 1;
      const c = this.pColorGroup[i] === 0 ? this.green : this.orange;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      this.pSpeed[i] = rand(0.2, 0.9);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.pMat = new THREE.PointsMaterial({
      size: 0.12, map: this.dot, vertexColors: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.particles = new THREE.Points(pg, this.pMat);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 6;
    this.group.add(this.particles);
    this.fade(this.pMat, 0.9);

    this.rings = new RingPool(this, FLOOR_Y + 0.02);
  }

  randomizeVariant() {
    let index = this.variantIndex;
    while (this.palettes.length > 1 && index === this.variantIndex) {
      index = randInt(0, this.palettes.length - 1);
    }
    this.variantIndex = index;
    const palette = this.palettes[index];
    this.green.copy(palette.green);
    this.orange.copy(palette.orange);
  }

  onBeat(s) {
    this.flip = !this.flip;
    this.rings.spawn(s, this.flip ? this.green : this.orange);
  }
  onDrop() {
    this.boost = 1;
    this.rings.spawn(1, this.green);
    this.rings.spawn(1, this.orange);
  }

  lights(rig, t, a, k) {
    rig.key.color.lerp(this.green, k);
    rig.fill.color.lerp(this.orange, k);
    rig.hemi.color.lerp(this.green, k);
    rig.key.position.set(Math.sin(t * 0.9) * 6, 3, 5 + Math.cos(t * 0.9) * 2);
    rig.fill.position.set(Math.sin(t * 0.9 + Math.PI) * 6, 2, 5 + Math.cos(t * 0.9 + Math.PI) * 2);
    rig.key.intensity = 60 + a.bass * 260;
    rig.fill.intensity = 60 + a.mid * 220;
    rig.hemi.intensity = 0.25;
    rig.dir.intensity = 0;
  }

  update(c) {
    const { t, mt, dt, a, motionSpeed } = c;
    this.boost *= Math.exp(-dt * 2.5);

    this.video.material.uniforms.uTintGreen.value.copy(this.green);
    this.video.material.uniforms.uTintOrange.value.copy(this.orange);

    this.cam.pos.set(Math.sin(mt * 0.25) * 1.8, 0.8 + Math.sin(mt * 0.4) * 0.25, 9.5 + Math.sin(mt * 0.17) * 0.8);
    this.cam.look.set(0, 0.2, 0);

    this.video.tick(t, c.glitch, a.beatEnv, a.energy);

    this.halo.material.color.copy(this.green).lerp(this.orange, 0.5 + 0.5 * Math.sin(mt * 0.6));
    const hs = 8 + a.bass * 3 + this.boost * 3;
    this.halo.scale.set(hs, hs, 1);
    this.haloFade.base = 0.3 + a.bass * 0.4;

    this.floorMat.uniforms.uTime.value = mt;
    this.floorMat.uniforms.uBass.value = a.bass;

    for (const b of this.beams) {
      b.pivot.rotation.z = Math.sin(mt * b.speed + b.phase) * 0.9;
      b.pivot.rotation.x = Math.cos(mt * b.speed * 0.8 + b.phase * 1.3) * 0.7;
      const w = 1 + a.beatEnv * 3 + this.boost * 5;
      b.beam.scale.set(w, 14 + a.bass * 8 + this.boost * 6, w);
    }

    this.ball.rotation.y += dt * motionSpeed * 0.5;
    this.ballWire.rotation.copy(this.ball.rotation);
    const bs = 1 + a.beatEnv * 0.12;
    this.ball.scale.setScalar(bs);
    this.ballWire.scale.setScalar(bs);

    const pos = this.particles.geometry.attributes.position.array;
    for (let i = 0; i < this.pCount; i++) {
      let y = pos[i * 3 + 1] + this.pSpeed[i] * dt * motionSpeed * (1 + a.bass * 2.5);
      if (y > 9) { y = -3; pos[i * 3] = rand(-12, 12); }
      pos[i * 3 + 1] = y;
      pos[i * 3] += Math.sin(mt * 0.7 + i) * dt * motionSpeed * 0.15;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    const colors = this.particles.geometry.attributes.color;
    for (let i = 0; i < this.pCount; i++) {
      const color = this.pColorGroup[i] === 0 ? this.green : this.orange;
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    this.pMat.size = 0.1 + a.bass * 0.12 + this.boost * 0.1;
    this.ballWire.material.color.copy(this.green);
    for (let i = 0; i < this.beams.length; i++) {
      this.beams[i].beam.material.color.copy(i % 2 ? this.orange : this.green);
    }

    this.rings.update(dt);
    this.applyFade();
  }
}

class DataScene extends BaseScene {
  constructor() {
    super('data');
    this.bg.set(0x000000);
    this.fogDensity = 0;
    this.video = new VideoLayer(PARAMS.assets.dataVideo, PARAMS.video.featuredHeight, true, false);
    this.video.material.depthTest = false;
    this.video.mesh.renderOrder = 10;
    this.group.add(this.video.mesh);
    this.fade(this.video.material);

    this.hudTexture = makeDataHudTexture();
    this.hudMaterial = new THREE.SpriteMaterial({
      map: this.hudTexture,
      color: 0x9dffd0,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.hud = new THREE.Sprite(this.hudMaterial);
    this.hud.renderOrder = 11;
    this.group.add(this.hud);
    this.hudFade = this.fade(this.hudMaterial, 0.28);

    this.tint = new THREE.Color(0xffffff);
    this.tintStart = new THREE.Color(0xffffff);
    this.tintTarget = new THREE.Color(0xffffff);
    this.tintStrength = 0;
    this.tintStrengthStart = 0;
    this.tintStrengthTarget = 0;
    this.tintElapsed = 0;
    this.tintDelay = rand(24, 42);
    this.tintDuration = 4;
    this.activeTime = 0;
    this.tintColors = [0x48bfff, 0xff5c9a, 0xb56cff, 0x43e0b1, 0xffbd52]
      .map((color) => new THREE.Color(color));
    this.accentColors = this.tintColors;
  }

  update(c) {
    const { dt, t } = c;
    this.activeTime += dt;
    this.video.tick(t, 0, c.a.beatEnv, c.a.energy);

    if (this.activeTime >= this.tintDelay) {
      this.tintDelay = this.activeTime + rand(48, 78);
      this.tintStart.copy(this.tint);
      this.tintStrengthStart = this.tintStrength;
      this.tintTarget.copy(this.tintColors[randInt(0, this.tintColors.length - 1)]);
      this.tintStrengthTarget = 0.42;
      this.tintElapsed = 0;
    }

    if (this.tintElapsed < this.tintDuration) {
      this.tintElapsed = Math.min(this.tintDuration, this.tintElapsed + dt);
      const blend = smooth(this.tintElapsed / this.tintDuration);
      this.tint.lerpColors(this.tintStart, this.tintTarget, blend);
      this.tintStrength = this.tintStrengthStart
        + (this.tintStrengthTarget - this.tintStrengthStart) * blend;
    }

    this.video.material.uniforms.uTint.value.copy(this.tint);
    this.video.material.uniforms.uTintStrength.value = this.tintStrength;
    const flicker = Math.sin(this.activeTime * 1.6) * 0.025
      + (this.activeTime % 23 < 0.09 ? -0.12 : 0);
    this.hudFade.base = clamp(0.28 + flicker + c.a.beatEnv * 0.08, 0.12, 0.4);
    this.applyFade();
  }

  fitHudToCamera(camera, center) {
    this.group.updateWorldMatrix(true, false);
    this.hud.position.copy(this.group.worldToLocal(center.clone()));
    const distance = camera.position.distanceTo(center);
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const viewWidth = viewHeight * camera.aspect;
    const height = Math.max(viewHeight, viewWidth / this.video.src.aspect);
    this.hud.scale.set(height * this.video.src.aspect, height, 1);
  }
}

// =====================================================================
//  ESCENA 2 — Edificios retro-futuristas blancos orbitando (anim2)
// =====================================================================
class MatrixScene extends BaseScene {
  constructor() {
    super('matrix');
    const C = PARAMS.colors.matrix;
    this.bg.set(C.bg);
    this.fogDensity = 0.02;
    this.white = new THREE.Color(C.white);
    this.ice = new THREE.Color(C.ice);
    this.accentColors = [this.white, this.ice];

    this.video = new VideoLayer(PARAMS.assets.videos[1], PARAMS.video.featuredHeight, true);
    this.group.add(this.video.mesh);
    this.fade(this.video.material);

    this.dot = makeDotTexture();
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.dot, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.halo.position.set(0, 0, -0.5);
    this.halo.scale.set(10, 10, 1);
    this.halo.renderOrder = 2;
    this.haloFade = this.fade(this.halo.material, 0.25);
    this.group.add(this.halo);

    // Edificios blancos (InstancedMesh) en 3 anillos concéntricos
    const rings = [
      { n: N(12), radius: 8.5, hMax: 3.5, speed: 0.12, wMul: 0.7 },
      { n: N(72), radius: 11.5, hMax: 8, speed: -0.08, wMul: 1.25 },
      { n: N(92), radius: 16.5, hMax: 12, speed: 0.05, wMul: 1.5 },
    ];
    this.ringDefs = rings;
    this.inst = [];
    rings.forEach((r, ri) => {
      for (let k = 0; k < r.n; k++) {
        this.inst.push({
          ring: ri,
          a0: (k / r.n) * Math.PI * 2 + rand(-0.03, 0.03),
          rad: r.radius + rand(-1.1, 1.1),
          phase: rand(0, Math.PI * 2),
          w: rand(0.7, 1.6) * r.wMul,
          d: rand(0.7, 1.6) * r.wMul,
          h: rand(1.5, r.hMax),
          bin: (k * 3 + ri * 17) % 64,
        });
      }
    });
    this.facade = makeWhiteFacadeTexture();
    this.bMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: this.facade, emissive: 0xffffff, emissiveIntensity: 0.15,
      roughness: 0.55, metalness: 0, depthWrite: false,
    });
    this.buildingMeshes = rings.map((ring, ringIndex) => {
      const items = this.inst.filter((building) => building.ring === ringIndex);
      const mesh = new THREE.InstancedMesh(makeBoxGeometry(1, 1), this.bMat, items.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      return { mesh, items };
    });
    this.fade(this.bMat, 0.72);
    this.dummy = new THREE.Object3D();

    // Lluvia digital blanca estilo "Matrix"
    const ns = N(500);
    this.ns = ns;
    const rp = new Float32Array(ns * 6);
    const rc = new Float32Array(ns * 6);
    this.rain = [];
    for (let i = 0; i < ns; i++) {
      this.rain.push({ x: rand(-18, 18), y: rand(FLOOR_Y, 14), z: rand(-18, 8), speed: rand(4, 12), len: rand(0.6, 2.5) });
      rc[i * 6] = 1; rc[i * 6 + 1] = 1; rc[i * 6 + 2] = 1; // cabeza brillante
      rc[i * 6 + 3] = 0; rc[i * 6 + 4] = 0; rc[i * 6 + 5] = 0; // cola se apaga
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    this.rainMat = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.rainLines = new THREE.LineSegments(rg, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.renderOrder = 3;
    this.group.add(this.rainLines);
    this.fade(this.rainMat, 0.8);

    // Piso de neón sutil con líneas de perspectiva y pulso de audio
    this.gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uColor: { value: new THREE.Color(0x9db7c9) },
        uAccent: { value: new THREE.Color(0xe2f4ff) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; uniform float uTime; uniform float uBass;
        uniform vec3 uColor; uniform vec3 uAccent;
        varying vec3 vWorld;
        void main() {
          vec2 fine = abs(fract(vWorld.xz / 2.5 + 0.5) - 0.5) / fwidth(vWorld.xz / 2.5);
          vec2 major = abs(fract(vWorld.xz / 10.0 + 0.5) - 0.5) / fwidth(vWorld.xz / 10.0);
          float fineLine = 1.0 - min(min(fine.x, fine.y), 1.0);
          float majorLine = 1.0 - min(min(major.x, major.y), 1.0);
          float fade = smoothstep(-75.0, -5.0, vWorld.z);
          float pulse = 0.88 + 0.12 * sin(vWorld.x * 0.08 - uTime * 0.35);
          vec3 color = mix(uColor, uAccent, majorLine * 0.55);
          float alpha = (0.025 + fineLine * 0.16 + majorLine * 0.22) * fade * pulse * (1.0 + uBass * 0.3);
          gl_FragColor = vec4(color, alpha * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), this.gridMat);
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.position.set(0, FLOOR_Y, -12);
    this.grid.renderOrder = 0;
    this.group.add(this.grid);
    this.fade(this.gridMat);

    this.rings = new RingPool(this, FLOOR_Y + 0.02);
  }

  onBeat(s) { this.rings.spawn(s, 0xffffff); }
  onDrop() { this.rings.spawn(1, 0xffffff); this.rings.spawn(0.8, 0xdfe9ff); }

  lights(rig, t, a, k) {
    const white = this.white;
    rig.key.color.lerp(white, k);
    rig.fill.color.lerp(this.ice, k);
    rig.hemi.color.lerp(white, k);
    rig.key.position.set(4, 6, 8);
    rig.fill.position.set(-6, 3, 4);
    rig.key.intensity = 150 + a.bass * 220;
    rig.fill.intensity = 80 + a.mid * 150;
    rig.hemi.intensity = 0.8;
    rig.dir.intensity = 1.1;
  }

  update(c) {
    const { t, mt, dt, a, motionSpeed } = c;
    const grow = smooth(this.opacity);

    this.cam.pos.set(Math.sin(mt * 0.18) * 2.5, 1.4 + Math.sin(mt * 0.23) * 0.5, 10.5 + Math.cos(mt * 0.13));
    this.cam.look.set(0, 0.8, 0);

    this.video.tick(t, c.glitch, a.beatEnv, a.energy);
    this.haloFade.base = 0.2 + a.energy * 0.35;
    this.gridMat.uniforms.uTime.value = mt;
    this.gridMat.uniforms.uBass.value = a.bass;

    // Edificios: giran en torno al plano del video y "respiran" con el espectro
    const d = this.dummy;
    for (const { mesh, items } of this.buildingMeshes) {
      for (let i = 0; i < items.length; i++) {
        const b = items[i];
        const R = this.ringDefs[b.ring];
        const drift = Math.sin(mt * 0.12 + b.phase) * 0.06;
        const ang = b.a0 + mt * (R.speed + Math.sign(R.speed) * a.mid * 0.015) + drift;
        const breath = 0.96 + Math.sin(mt * 0.2 + b.phase) * 0.04;
        const h = Math.max(0.01, b.h * (0.82 + a.bins[b.bin] * 0.55) * breath * grow);
        const radius = b.rad + Math.sin(mt * 0.1 + b.phase) * 0.12;
        d.position.set(Math.cos(ang) * radius, FLOOR_Y + h / 2, Math.sin(ang) * radius);
        d.rotation.set(0, -ang, 0);
        d.scale.set(b.w, h, b.d);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.bMat.emissiveIntensity = 0.12 + a.energy * 0.4 + a.beatEnv * 0.3;

    // Lluvia
    const rp = this.rainLines.geometry.attributes.position.array;
    const spd = 1 + a.energy * 2;
    for (let i = 0; i < this.ns; i++) {
      const r = this.rain[i];
      r.y -= r.speed * dt * motionSpeed * spd;
      if (r.y < FLOOR_Y) { r.y = 14; r.x = rand(-18, 18); r.z = rand(-18, 8); }
      rp[i * 6] = r.x; rp[i * 6 + 1] = r.y; rp[i * 6 + 2] = r.z;
      rp[i * 6 + 3] = r.x; rp[i * 6 + 4] = r.y + r.len; rp[i * 6 + 5] = r.z;
    }
    this.rainLines.geometry.attributes.position.needsUpdate = true;

    this.group.rotation.z = Math.sin(mt * 0.2) * 0.03;
    this.rings.update(dt);
    this.applyFade();
  }
}

// =====================================================================
//  Cometa / estrella fugaz (cabeza + estela hecha de puntos)
// =====================================================================
class Comet {
  constructor(owner, parent) {
    this.N = 44;
    const gp = createGlowPoints(this.N, { twinkle: 0 });
    this.points = gp.points;
    this.geo = gp.geometry;
    owner.fade(gp.material, 1);
    this.points.visible = false;
    this.points.renderOrder = 6;
    parent.add(this.points);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.hist = Array.from({ length: this.N }, () => new THREE.Vector3());
    this.color = new THREE.Color();
    this.active = false;
    this.life = 0;
    this.maxLife = 2;
    this.power = 1;
  }
  spawn(power, hex) {
    const r = 220;
    const az = deg(rand(-55, 55));
    const el = deg(rand(22, 58));
    this.pos.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), -r * Math.cos(el) * Math.cos(az));
    const dir = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * rand(0.7, 1), -rand(0.25, 0.6), rand(-0.1, 0.1)).normalize();
    this.vel.copy(dir).multiplyScalar(rand(130, 210));
    this.maxLife = rand(1.5, 2.4);
    this.life = 0;
    this.power = power;
    this.color.set(hex);
    for (const h of this.hist) h.copy(this.pos);
    this.active = true;
    this.points.visible = true;
  }
  update(dt) {
    if (!this.active) return;
    this.life += dt;
    if (this.life >= this.maxLife) {
      this.active = false;
      this.points.visible = false;
      return;
    }
    this.pos.addScaledVector(this.vel, dt);
    for (let i = this.N - 1; i > 0; i--) this.hist[i].copy(this.hist[i - 1]);
    this.hist[0].copy(this.pos);

    const p = this.life / this.maxLife;
    const env = Math.min(1, this.life / 0.15) * Math.min(1, (1 - p) / 0.35);
    const P = this.geo.attributes.position.array;
    const C = this.geo.attributes.aColor.array;
    const S = this.geo.attributes.aSize.array;
    for (let i = 0; i < this.N; i++) {
      const h = this.hist[i];
      P[i * 3] = h.x; P[i * 3 + 1] = h.y; P[i * 3 + 2] = h.z;
      const k = 1 - i / (this.N - 1);
      const f = k * k * env * this.power;
      C[i * 3] = this.color.r * f; C[i * 3 + 1] = this.color.g * f; C[i * 3 + 2] = this.color.b * f;
      S[i] = 2 + (i === 0 ? 26 : 20 * k) * this.power;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

// =====================================================================
//  ESCENA 3 — Ciudad retro sci-fi + cielo inmenso (anim3)
// =====================================================================
const CITY_VARIANTS = [
  {
    bg: 0x020b05, skyTop: 0x010905, skyMid: 0x073b1b, skyHorizon: 0x20b45a,
    neonA: 0x39ff14, neonB: 0x00d878, amber: 0xa6ff70, building: 0x071b10,
    grid: 0x22ff66, star: 0x9cffb0, sunTop: 0x59ff52, sunBottom: 0x007a36,
    windows: ['#39ff14', '#00e676', '#a6ff00', '#00c853'],
    comets: [0x9cffb0, 0x39ff14, 0x00d878], scale: [1, 1, 1], shift: 0,
  },
  {
    bg: 0x080414, skyTop: 0x04020f, skyMid: 0x25104a, skyHorizon: 0xff4d9d,
    neonA: 0xff4fd8, neonB: 0x41d9ff, amber: 0xffe37c, building: 0x100b22,
    grid: 0xb657ff, star: 0xf5c5ff, sunTop: 0xff8acb, sunBottom: 0x7d1b72,
    windows: ['#ff4fd8', '#41d9ff', '#ffe37c', '#9c55ff'],
    comets: [0xffb4ed, 0x41d9ff, 0xff4fd8], scale: [0.9, 1.12, 0.88], shift: -7,
  },
  {
    bg: 0x02131c, skyTop: 0x001016, skyMid: 0x064556, skyHorizon: 0x31f3df,
    neonA: 0x00f0ff, neonB: 0x3b82f6, amber: 0xffce74, building: 0x06151e,
    grid: 0x16d9d2, star: 0xb8ffff, sunTop: 0x71fff0, sunBottom: 0x08788b,
    windows: ['#00f0ff', '#3b82f6', '#ffce74', '#45ffd2'],
    comets: [0xb8ffff, 0x00f0ff, 0xffce74], scale: [1.12, 0.9, 1.05], shift: 8,
  },
  {
    bg: 0x120704, skyTop: 0x10040a, skyMid: 0x4a190b, skyHorizon: 0xff7b36,
    neonA: 0xff5b35, neonB: 0xffc247, amber: 0xffe4a3, building: 0x21100b,
    grid: 0xff673a, star: 0xffd9a1, sunTop: 0xffe277, sunBottom: 0xb53523,
    windows: ['#ff5b35', '#ffc247', '#ff9d4d', '#fff09a'],
    comets: [0xffd9a1, 0xff673a, 0xfff09a], scale: [1.04, 1.08, 0.94], shift: -2,
  },
];

class CityScene extends BaseScene {
  constructor() {
    super('city');
    const C = PARAMS.colors.city;
    this.C = C;
    this.bg.set(C.bg);
    this.fogDensity = 0.004;
    this.neonA = new THREE.Color(C.neonA);
    this.neonB = new THREE.Color(C.neonB);
    this.accentColors = [this.neonA, this.neonB, new THREE.Color(C.amber)];
    this.cometColors = C.comets;
    this.variantIndex = 0;
    this.spawnQueue = [];
    this.idle = rand(2, 4);
    this.nodeBoost = 0;

    this.video = new VideoLayer(PARAMS.assets.videos[2], PARAMS.video.featuredHeight, true);
    this.video.material.depthTest = false;
    this.group.add(this.video.mesh);
    this.fade(this.video.material);

    // ---- Cielo (gradiente + nebulosa + resplandor de horizonte) ----
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1 }, uTime: { value: 0 }, uBass: { value: 0 },
        uTop: { value: new THREE.Color(C.skyTop) },
        uMid: { value: new THREE.Color(C.skyMid) },
        uHor: { value: new THREE.Color(C.skyHorizon) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; uniform float uTime; uniform float uBass;
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.28, h));
          col = mix(col, uTop, smoothstep(0.2, 0.9, h));
          col += uHor * exp(-abs(vDir.y) * 6.0) * (0.25 + uBass * 0.6);
          float n = sin(vDir.x * 6.0 + uTime * 0.05) * sin(vDir.z * 5.0 - uTime * 0.04) * sin(vDir.y * 9.0);
          col += uMid * max(n, 0.0) * 0.35 * smoothstep(0.05, 0.5, h);
          gl_FragColor = vec4(col, uOpacity);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 32), this.skyMat);
    sky.renderOrder = -10;
    this.group.add(sky);
    this.fade(this.skyMat);

    this.skyGroup = new THREE.Group();
    this.group.add(this.skyGroup);

    // ---- Estrellas ----
    const ns = N(2600);
    const stars = createGlowPoints(ns, { twinkle: 0.6 });
    this.starMat = stars.material;
    this.starColorAttribute = stars.geometry.attributes.aColor;
    this.starBrightness = new Float32Array(ns);
    {
      const P = stars.geometry.attributes.position.array;
      const Cc = stars.geometry.attributes.aColor.array;
      const S = stars.geometry.attributes.aSize.array;
      const Ph = stars.geometry.attributes.aPhase.array;
      const starColor = new THREE.Color(C.star);
      for (let i = 0; i < ns; i++) {
        let v;
        do { v = new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1)); } while (v.lengthSq() > 1 || v.lengthSq() < 0.01 || v.y / v.length() < 0.02);
        v.normalize().multiplyScalar(250);
        P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
        const b = rand(0.5, 1);
        this.starBrightness[i] = b;
        Cc[i * 3] = starColor.r * b; Cc[i * 3 + 1] = starColor.g * b; Cc[i * 3 + 2] = starColor.b * b;
        S[i] = Math.random() < 0.06 ? rand(5, 8) : rand(1.5, 3.5);
        Ph[i] = Math.random();
      }
    }
    stars.points.renderOrder = -5;
    this.skyGroup.add(stars.points);
    this.fade(stars.material, 1);

    // ---- Constelaciones generadas por código ----
    this.buildConstellations();

    // ---- Cometas / estrellas fugaces ----
    this.comets = [];
    for (let i = 0; i < 8; i++) this.comets.push(new Comet(this, this.group));

    // ---- Sol retro con franjas ----
    this.sunMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1 }, uTime: { value: 0 }, uBass: { value: 0 },
        uSunTop: { value: new THREE.Color(0x59ff52) },
        uSunBottom: { value: new THREE.Color(0x007a36) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; uniform float uTime; uniform float uBass;
        uniform vec3 uSunTop; uniform vec3 uSunBottom;
        varying vec2 vUv;
        void main() {
          float y = vUv.y;
          vec3 col = mix(uSunBottom, uSunTop, y) * (0.9 + uBass * 0.6);
          float stripe = step(0.5, fract(y * 14.0 - uTime * 0.15));
          float cut = smoothstep(0.55, 0.35, y);
          float a = mix(1.0, stripe, cut);
          gl_FragColor = vec4(col, a * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const sun = new THREE.Mesh(new THREE.CircleGeometry(38, 64), this.sunMat);
    sun.position.set(0, 14, -190);
    sun.renderOrder = -3;
    this.group.add(sun);
    this.fade(this.sunMat);

    // ---- Suelo retro: cuadrícula que avanza hacia la cámara ----
    this.gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 1 }, uTime: { value: 0 }, uBass: { value: 0 },
        uColor: { value: new THREE.Color(C.grid) },
        uColor2: { value: new THREE.Color(C.neonA) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vWorld;
        void main() {
          vUv = uv;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; uniform float uTime; uniform float uBass;
        uniform vec3 uColor; uniform vec3 uColor2;
        varying vec2 vUv; varying vec3 vWorld;
        void main() {
          vec2 p = vUv * 400.0;
          p.y += uTime * 8.0;
          vec2 q = p / 4.0;
          vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float fadeFar = smoothstep(-280.0, -30.0, vWorld.z);
          vec3 col = mix(uColor, uColor2, step(0.5, fract(q.x / 6.0)));
          float glow = 0.55 + uBass * 0.9;
          gl_FragColor = vec4(col * glow, line * fadeFar * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.gridMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, FLOOR_Y, -100);
    ground.renderOrder = -2;
    this.group.add(ground);
    this.fade(this.gridMat);

    // ---- Ciudad retro sci-fi (edificios agrupados por altura) ----
    this.buildCity();
  }

  randomizeVariant() {
    let index = this.variantIndex;
    while (CITY_VARIANTS.length > 1 && index === this.variantIndex) {
      index = randInt(0, CITY_VARIANTS.length - 1);
    }
    this.variantIndex = index;
    const variant = CITY_VARIANTS[index];
    this.bg.set(variant.bg);
    this.neonA.set(variant.neonA);
    this.neonB.set(variant.neonB);
    this.accentColors[2].set(variant.amber);
    this.cometColors = variant.comets;

    this.skyMat.uniforms.uTop.value.set(variant.skyTop);
    this.skyMat.uniforms.uMid.value.set(variant.skyMid);
    this.skyMat.uniforms.uHor.value.set(variant.skyHorizon);
    this.gridMat.uniforms.uColor.value.set(variant.grid);
    this.gridMat.uniforms.uColor2.value.copy(this.neonA);
    this.sunMat.uniforms.uSunTop.value.set(variant.sunTop);
    this.sunMat.uniforms.uSunBottom.value.set(variant.sunBottom);
    this.cityTex.dispose();
    this.cityTex = makeNeonWindowsTexture(variant.windows);
    this.cityMat.emissiveMap = this.cityTex;
    this.cityMat.color.set(variant.building);
    this.cityMat.needsUpdate = true;
    this.cityBuildingGroup.scale.set(...variant.scale);
    this.cityBuildingGroup.position.set(variant.shift, FLOOR_Y * (1 - variant.scale[1]), 0);

    const starColor = new THREE.Color(variant.star);
    const starColors = this.starColorAttribute.array;
    for (let i = 0; i < this.starBrightness.length; i++) {
      const b = this.starBrightness[i];
      starColors[i * 3] = starColor.r * b;
      starColors[i * 3 + 1] = starColor.g * b;
      starColors[i * 3 + 2] = starColor.b * b;
    }
    this.starColorAttribute.needsUpdate = true;
    this.constMat.color.copy(this.neonA);
    const nodeColors = this.nodeGeo.attributes.aColor.array;
    const nodeCount = nodeColors.length / 3;
    for (let i = 0; i < nodeCount; i++) {
      nodeColors[i * 3] = this.neonA.r;
      nodeColors[i * 3 + 1] = this.neonA.g;
      nodeColors[i * 3 + 2] = this.neonA.b;
    }
    this.nodeGeo.attributes.aColor.needsUpdate = true;
  }

  buildConstellations() {
    const R = 240;
    const linePos = [];
    const nodePos = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let c = 0; c < 8; c++) {
      const az = deg(lerp(-52, 52, c / 7) + rand(-5, 5));
      const el = deg(rand(12, 50));
      const center = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).multiplyScalar(R);
      const nrm = center.clone().normalize();
      const u = new THREE.Vector3().crossVectors(up, nrm).normalize();
      const v = new THREE.Vector3().crossVectors(nrm, u).normalize();
      const k = randInt(6, 9);
      const pts = [];
      let cx = 0, cy = 0;
      for (let j = 0; j < k; j++) {
        cx += rand(-16, 16);
        cy += rand(-12, 12);
        pts.push(center.clone().addScaledVector(u, cx).addScaledVector(v, cy).normalize().multiplyScalar(R));
      }
      for (let j = 0; j < k - 1; j++) {
        linePos.push(pts[j].x, pts[j].y, pts[j].z, pts[j + 1].x, pts[j + 1].y, pts[j + 1].z);
      }
      if (Math.random() < 0.6 && k > 4) {
        const j = randInt(0, k - 3);
        linePos.push(pts[j].x, pts[j].y, pts[j].z, pts[j + 2].x, pts[j + 2].y, pts[j + 2].z);
      }
      for (const p of pts) nodePos.push(p.x, p.y, p.z);
    }

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePos), 3));
    this.constMat = new THREE.LineBasicMaterial({
      color: 0x7dff9b, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const lines = new THREE.LineSegments(lg, this.constMat);
    lines.frustumCulled = false;
    lines.renderOrder = -4;
    this.skyGroup.add(lines);
    this.constFade = this.fade(this.constMat, 0.4);

    const nCount = nodePos.length / 3;
    const nodes = createGlowPoints(nCount, { twinkle: 0.5 });
    this.nodeGeo = nodes.geometry;
    this.nodeBase = new Float32Array(nCount);
    {
      const P = nodes.geometry.attributes.position.array;
      const Cc = nodes.geometry.attributes.aColor.array;
      const S = nodes.geometry.attributes.aSize.array;
      const Ph = nodes.geometry.attributes.aPhase.array;
      for (let i = 0; i < nCount; i++) {
        P[i * 3] = nodePos[i * 3]; P[i * 3 + 1] = nodePos[i * 3 + 1]; P[i * 3 + 2] = nodePos[i * 3 + 2];
        Cc[i * 3] = 0.45; Cc[i * 3 + 1] = 1.0; Cc[i * 3 + 2] = 0.58;
        this.nodeBase[i] = rand(6, 11);
        S[i] = this.nodeBase[i];
        Ph[i] = Math.random();
      }
    }
    nodes.points.renderOrder = -4;
    this.nodeMat = nodes.material;
    this.skyGroup.add(nodes.points);
    this.fade(nodes.material, 1);
  }

  buildCity() {
    const C = this.C;
    this.cityBuildingGroup = new THREE.Group();
    const palette = ['#39ff14', '#00e676', '#a6ff00', '#00c853'];
    this.cityTex = makeNeonWindowsTexture(palette);
    this.cityMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveMap: this.cityTex, emissiveIntensity: 0.7,
      roughness: 0.85, metalness: 0.1,
    });
    this.fade(this.cityMat);

    const buckets = [8, 14, 22, 34, 52, 70].map((h) => ({ h, items: [] }));
    const total = N(260);
    for (let i = 0; i < total; i++) {
      const x = rand(-130, 130);
      let bi = Math.min(buckets.length - 1, Math.floor(Math.pow(Math.random(), 1.7) * buckets.length));
      if (Math.abs(x) < 30) bi = Math.min(bi, 2); // no tapar la zona central del cielo
      buckets[bi].items.push({
        x, z: rand(-120, -30),
        w: bi >= 4 ? rand(2.5, 4) : rand(3, 9),
        d: rand(3, 8),
        hMul: rand(0.88, 1.12),
      });
    }

    const base = new THREE.Color(C.building);
    const tmp = new THREE.Color();
    const dummy = new THREE.Object3D();
    this.cityMeshes = [];
    for (const b of buckets) {
      if (!b.items.length) continue;
      const geo = makeBoxGeometry(1, b.h / 12);
      const mesh = new THREE.InstancedMesh(geo, this.cityMat, b.items.length);
      b.items.forEach((it, i) => {
        const h = b.h * it.hMul;
        dummy.position.set(it.x, FLOOR_Y + h / 2, it.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(it.w, h, it.d);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tmp.copy(base).offsetHSL(rand(-0.03, 0.05), 0, rand(-0.02, 0.05));
        mesh.setColorAt(i, tmp);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      this.cityBuildingGroup.add(mesh);
      this.cityMeshes.push(mesh);
    }
    this.group.add(this.cityBuildingGroup);
  }

  spawnComets(count, power = 1) {
    for (let i = 0; i < count; i++) this.spawnQueue.push({ delay: i * 0.12, power });
  }
  spawnOne(power) {
    const c = this.comets.find((x) => !x.active);
    if (!c) return;
    const list = this.cometColors;
    c.spawn(power, list[randInt(0, list.length - 1)]);
  }

  onBeat(strength) {
    this.nodeBoost = Math.max(this.nodeBoost, 0.2 + strength * 0.25);
  }
  onPeak() { this.spawnComets(1, 0.8); }
  onDrop(s) {
    this.nodeBoost = 1;
    this.spawnComets(randInt(4, 6), 1.1);
  }

  lights(rig, t, a, k) {
    rig.key.color.lerp(this.neonB, k);
    rig.fill.color.lerp(this.neonA, k);
    rig.hemi.color.lerp(this.neonA, k);
    rig.key.position.set(-6, 3, 6);
    rig.fill.position.set(6, 2, 6);
    rig.key.intensity = 90 + a.bass * 200;
    rig.fill.intensity = 90 + a.mid * 180;
    rig.hemi.intensity = 0.5;
    rig.dir.intensity = 0.35;
  }

  update(c) {
    const { t, mt, dt, a } = c;
    this.nodeBoost *= Math.exp(-dt * 1.8);

    this.cam.pos.set(Math.sin(mt * 0.12) * 2, 0.8 + Math.sin(mt * 0.2) * 0.3, 9);
    this.cam.look.set(0, 3.2 + Math.sin(mt * 0.1) * 0.6, -40);

    this.video.tick(t, c.glitch, a.beatEnv);

    this.skyMat.uniforms.uTime.value = mt;
    this.skyMat.uniforms.uBass.value = a.bass;
    this.starMat.uniforms.uTime.value = mt;
    this.nodeMat.uniforms.uTime.value = mt;
    this.sunMat.uniforms.uTime.value = mt;
    this.sunMat.uniforms.uBass.value = a.bass;
    this.gridMat.uniforms.uTime.value = mt;
    this.gridMat.uniforms.uBass.value = a.bass;

    // Constelaciones: respiran con los agudos y destellan en los drops
    this.constFade.base = 0.3 + a.high * 0.5 + this.nodeBoost * 0.4;
    const S = this.nodeGeo.attributes.aSize.array;
    for (let i = 0; i < S.length; i++) S[i] = this.nodeBase[i] * (1 + a.high * 0.6 + this.nodeBoost * 1.2);
    this.nodeGeo.attributes.aSize.needsUpdate = true;
    this.skyGroup.rotation.y = Math.sin(mt * 0.04) * 0.12;
    this.skyGroup.rotation.x = Math.sin(mt * 0.03) * 0.03;

    this.cityMat.emissiveIntensity = 0.55 + a.energy * 0.6 + a.beatEnv * 0.4;

    // Cometas
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const q = this.spawnQueue[i];
      q.delay -= dt * c.motionSpeed;
      if (q.delay <= 0) { this.spawnOne(q.power); this.spawnQueue.splice(i, 1); }
    }
    this.idle -= dt * c.motionSpeed;
    if (this.idle <= 0) { this.idle = rand(5, 9); this.spawnOne(0.7); }
    for (const cm of this.comets) cm.update(dt * c.motionSpeed);

    this.applyFade();
  }
}

// =====================================================================
//  Postproceso: render a textura + pase con glitches
// =====================================================================
function createPost(renderer) {
  const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: MOBILE ? 2 : 4,
  });

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: rt.texture },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uRgb: { value: 0 },
      uSlice: { value: 0 },
      uWarp: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uPixel: { value: 0 },
      uInvert: { value: 0 },
      uNoise: { value: 0.02 },
      uVignette: { value: 0.45 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime; uniform vec2 uRes;
      uniform float uRgb; uniform float uSlice; uniform float uWarp;
      uniform float uFlash; uniform vec3 uFlashColor;
      uniform float uPixel; uniform float uInvert;
      uniform float uNoise; uniform float uVignette;
      varying vec2 vUv;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      void main() {
        vec2 uv = vUv;
        vec2 c = uv - 0.5;

        // Distorsión de lente + ondulación (salto hiperespacial)
        uv += c * dot(c, c) * uWarp * 1.5;
        uv.x += sin(uv.y * 20.0 + uTime * 10.0) * 0.01 * uWarp;

        // Tiras horizontales desplazadas (señal interferida)
        float row = floor(uv.y * 18.0);
        float tk = floor(uTime * 20.0);
        float on = step(0.82, hash(vec2(row, tk)));
        uv.x += (hash(vec2(row, tk + 3.0)) - 0.5) * 0.25 * uSlice * on;

        // Mosaico (datos corruptos)
        if (uPixel > 0.0) {
          vec2 g = uRes / uPixel;
          uv = floor(uv * g) / g + 0.5 / g;
        }
        uv = clamp(uv, 0.001, 0.999);

        // Aberración cromática
        vec2 off = vec2(uRgb, 0.0) * (0.6 + c.x * 0.8);
        vec3 col;
        col.r = texture2D(tDiffuse, uv + off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - off).b;

        // Scanlines, ruido, negativo, destello, viñeta
        col *= 1.0 - 0.05 * sin(vUv.y * uRes.y * 1.5);
        col += (hash(uv * uRes + uTime) - 0.5) * uNoise;
        col = mix(col, vec3(1.0) - col, uInvert);
        col = mix(col, uFlashColor, uFlash);
        col *= 1.0 - uVignette * smoothstep(0.35, 0.95, length(c) * 1.4);

        gl_FragColor = vec4(max(col, 0.0), 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scn = new THREE.Scene();
  scn.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    setSize(w, h) {
      rt.setSize(w, h);
      mat.uniforms.uRes.value.set(w, h);
    },
    render(renderer, scene, camera, v, time) {
      const u = mat.uniforms;
      u.uTime.value = time;
      u.uRgb.value = v.rgb;
      u.uSlice.value = v.slice;
      u.uWarp.value = v.warp;
      u.uFlash.value = v.flash;
      u.uFlashColor.value.copy(v.flashColor);
      u.uPixel.value = v.pixel * SHARED.px.value;
      u.uInvert.value = v.invert;
      u.uNoise.value = v.noise;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(scn, cam);
    },
  };
}

// =====================================================================
//  Director de glitches: aleatorios + beats + drops + cues + transiciones
// =====================================================================
const FX_DURATION = { rgb: 0.3, signal: 0.4, warp: 0.7, flash: 0.35, pixel: 0.2, invert: 0.1, shake: 0.5, zoom: 0.45 };

class GlitchDirector {
  constructor() {
    this.fx = [];
    this.next = rand(...PARAMS.glitch.randomInterval);
    this.cues = [...PARAMS.glitch.cues].sort((a, b) => a.at - b.at);
    this.lastSong = 0;
    this.v = {
      rgb: 0, slice: 0, warp: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1),
      pixel: 0, invert: 0, noise: 0.02, shake: 0, fov: 0, roll: 0, video: 0,
    };
  }

  trigger(type, amp = 1, color = null, dur = null) {
    this.fx.push({ type, amp, t: 0, dur: dur || FX_DURATION[type] || 0.4, color: color ? color.clone() : null });
    if (this.fx.length > 24) this.fx.shift();
  }

  pick() {
    const w = PARAMS.glitch.weights;
    const keys = Object.keys(w);
    let sum = 0;
    for (const k of keys) sum += w[k];
    let r = Math.random() * sum;
    for (const k of keys) { r -= w[k]; if (r <= 0) return k; }
    return keys[0];
  }

  onBeat(strength, accent) {
    if (strength > 0.6 && Math.random() < PARAMS.glitch.beatChance) this.trigger('rgb', 0.6, accent);
  }
  onDrop(accent) {
    this.trigger('flash', 1, accent);
    this.trigger('warp', 1, accent);
    this.trigger('signal', 0.8, accent);
    this.trigger('shake', 1, accent);
  }
  onTransition(accent) {
    this.trigger('warp', 1, accent);
    this.trigger('signal', 1, accent);
    this.trigger('flash', 0.8, accent, 0.5);
  }

  update(dt, a, songTime, accent) {
    // Cues anclados a la canción (se ignoran si el usuario movió el slider)
    if (songTime >= this.lastSong && songTime - this.lastSong < 1.5) {
      for (const cue of this.cues) {
        if (cue.at > this.lastSong && cue.at <= songTime) this.trigger(cue.fx, cue.amp ?? 1, accent);
      }
    }
    this.lastSong = songTime;

    // Glitches aleatorios (más frecuentes cuando hay más energía)
    this.next -= dt * (1 + a.energy * 1.5);
    if (this.next <= 0) {
      this.next = rand(...PARAMS.glitch.randomInterval);
      this.trigger(this.pick(), rand(0.5, 1), accent);
    }

    const v = this.v;
    v.rgb = 0.0007 + a.bass * 0.0012;
    v.slice = 0; v.warp = 0; v.flash = 0; v.pixel = 0; v.invert = 0;
    v.noise = 0.02; v.shake = 0; v.fov = 0; v.roll = 0; v.video = 0;

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const p = f.t / f.dur;
      if (p >= 1) { this.fx.splice(i, 1); continue; }
      const e = (1 - p) * (1 - p) * f.amp;
      switch (f.type) {
        case 'rgb': v.rgb += 0.014 * e; v.video = Math.max(v.video, e); break;
        case 'signal': v.slice += e; v.rgb += 0.008 * e; v.noise += 0.14 * e; v.video = Math.max(v.video, e); break;
        case 'warp': v.warp += e * 0.9; v.fov += 16 * e; v.rgb += 0.006 * e; v.roll += Math.sin(f.t * 30) * 0.02 * e; break;
        case 'flash':
          if (e > v.flash) { v.flash = Math.min(1, e * 0.9); if (f.color) v.flashColor.copy(f.color); }
          break;
        case 'pixel': v.pixel = Math.max(v.pixel, 10 + 10 * f.amp); v.video = Math.max(v.video, 0.6); break;
        case 'invert': v.invert = Math.floor(f.t * 45) % 2 === 0 ? 1 : 0; break;
        case 'shake': v.shake += 0.4 * e; break;
        case 'zoom': v.fov -= 12 * e; break;
        default: break;
      }
    }
  }
}

// =====================================================================
//  API pública
// =====================================================================
export function createSimulation(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.02);

  const camera = new THREE.PerspectiveCamera(PARAMS.camera.fovDesktop, 1, PARAMS.camera.near, PARAMS.camera.far);

  // Rig de luces compartido (evita recompilar shaders al cambiar de escena)
  const rig = {
    hemi: new THREE.HemisphereLight(0xffffff, 0x111122, 0.4),
    key: new THREE.PointLight(0xffffff, 100, 0, 2),
    fill: new THREE.PointLight(0xffffff, 100, 0, 2),
    dir: new THREE.DirectionalLight(0xffffff, 0),
  };
  rig.dir.position.set(3, 8, 5);
  rig.key.position.set(4, 4, 6);
  rig.fill.position.set(-4, 2, 5);
  scene.add(rig.hemi, rig.key, rig.fill, rig.dir);

  const scenes = [new ClubScene(), new MatrixScene(), new CityScene(), new DataScene()];
  scenes.forEach((s) => scene.add(s.group));

  const post = createPost(renderer);
  const glitch = new GlitchDirector();

  const sim = {
    target: 0,
    baseFov: PARAMS.camera.fovDesktop,
    distScale: 1,
    motionTime: 0,
    motionSpeed: 1,
    scenes,
    glitch,
  };

  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const bg = new THREE.Color();

  sim.resize = (w, h) => {
    const maxPR = MOBILE ? PARAMS.camera.maxPixelRatioMobile : PARAMS.camera.maxPixelRatioDesktop;
    const pr = Math.min(window.devicePixelRatio || 1, maxPR);
    SHARED.px.value = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize(Math.floor(w * pr), Math.floor(h * pr));
    camera.aspect = w / h;
    const portrait = camera.aspect < 1;
    sim.baseFov = portrait ? PARAMS.camera.fovPortrait : PARAMS.camera.fovDesktop;
    sim.distScale = portrait ? PARAMS.camera.portraitDistanceScale : 1;
    camera.fov = sim.baseFov;
    camera.updateProjectionMatrix();
  };

  // Cambia de escena con fundido (también funciona al mover el slider)
  sim.setScene = (idx, instant = false) => {
    if (idx === sim.target && !instant) return;
    const changed = idx !== sim.target;
    sim.target = idx;
    if (changed) scenes[idx].randomizeVariant?.();
    if (instant) {
      scenes.forEach((s, i) => {
        s.setOpacity(i === idx ? 1 : 0);
        if (i === idx && !s.playing) { s.playing = true; s.enter(); }
        if (i !== idx && s.playing) { s.playing = false; s.leave(); }
      });
    } else if (changed) {
      glitch.onTransition(scenes[idx].pickAccent());
    }
  };

  // Reintenta reproducir los videos activos tras el primer gesto del usuario
  sim.kick = () => {
    scenes.forEach((s) => { if (s.playing) s.enter(); });
  };

  sim.triggerGlitch = (type, amp = 1) => glitch.trigger(type, amp, scenes[sim.target].pickAccent());

  sim.update = (dt, t, a, songTime) => {
    const step = dt / PARAMS.scenes.crossfade;
    const active = scenes[sim.target];
    const motionTarget = clamp(
      0.82 + Math.min(a.energy, 1.5) * 0.25 + a.beatEnv * 0.22 + (a.drop ? 0.2 : 0),
      0.82,
      1.48
    );
    sim.motionSpeed += (motionTarget - sim.motionSpeed) * (1 - Math.exp(-dt * 0.9));
    sim.motionTime += dt * sim.motionSpeed;

    // Opacidades (fundido independiente por escena: robusto al mover el slider)
    scenes.forEach((s, i) => {
      const goal = i === sim.target ? 1 : 0;
      let o = s.opacity;
      if (o < goal) o = Math.min(goal, o + step);
      else if (o > goal) o = Math.max(goal, o - step);
      s.setOpacity(o);
      if (o > 0 && !s.playing) { s.playing = true; s.enter(); }
      if (o === 0 && s.playing) { s.playing = false; s.leave(); }
    });

    // Eventos de audio
    const accent = active.pickAccent();
    if (a.beat) { active.onBeat(a.beatStrength); glitch.onBeat(a.beatStrength, accent); }
    if (a.drop) { active.onDrop(a.dropStrength); glitch.onDrop(accent); }
    if (a.peak) active.onPeak();

    glitch.update(dt, a, songTime, accent);

    // Actualizar escenas visibles
    const ctx = {
      t,
      mt: sim.motionTime,
      dt,
      a,
      glitch: glitch.v.video,
      motionSpeed: sim.motionSpeed,
    };
    scenes.forEach((s) => { if (s.opacity > 0) s.update(ctx); });

    // Mezcla de cámara / fondo / niebla entre escenas
    camPos.set(0, 0, 0);
    camLook.set(0, 0, 0);
    bg.setRGB(0, 0, 0);
    let fog = 0;
    let sum = 0;
    scenes.forEach((s) => {
      const w = smooth(s.opacity);
      if (w <= 0) return;
      camPos.addScaledVector(s.cam.pos, w);
      camLook.addScaledVector(s.cam.look, w);
      bg.r += s.bg.r * w; bg.g += s.bg.g * w; bg.b += s.bg.b * w;
      fog += s.fogDensity * w;
      sum += w;
    });
    if (sum > 0) {
      camPos.multiplyScalar(1 / sum);
      camLook.multiplyScalar(1 / sum);
      bg.r /= sum; bg.g /= sum; bg.b /= sum;
      fog /= sum;
    }
    scene.background.copy(bg);
    scene.fog.color.copy(bg);
    scene.fog.density = fog;

    // Luces según la escena dominante
    active.lights(rig, sim.motionTime, a, 1 - Math.exp(-dt * 3));

    // Cámara: escala de distancia (móvil vertical), sacudida, golpes de FOV y giro
    tmpV.copy(camPos).sub(camLook).multiplyScalar(sim.distScale);
    camera.position.copy(camLook).add(tmpV);
    const sh = glitch.v.shake;
    if (sh > 0) {
      camera.position.x += (Math.random() - 0.5) * sh;
      camera.position.y += (Math.random() - 0.5) * sh;
    }
    camera.lookAt(camLook);
    if (glitch.v.roll) camera.rotateZ(glitch.v.roll);
    camera.fov = sim.baseFov + glitch.v.fov + a.bass * 1.5;
    camera.updateProjectionMatrix();
    scenes.forEach((s) => s.video?.fitToCamera(camera, camLook, s.group));
    scenes.forEach((s) => s.fitHudToCamera?.(camera, camLook));
  };

  sim.render = (t) => post.render(renderer, scene, camera, glitch.v, t);

  return sim;
}