// ============================================================
//  labPanel.js
//  Panel de control tipo "laboratorio": transporte de audio,
//  medidores en vivo, presets y sliders agrupados.
//  No sabe nada del canvas: solo avisa con callbacks.
// ============================================================

function decimalsOf(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function createLabPanel({
  mount,
  params,
  definitions,
  presets = {},
  onParam,
  onPreset,
  onReset,
  onRegenerate,
  onTogglePlay,
  onNextPattern,
  onFullscreen,
  title = 'LAB // MATRIX CITY',
}) {
  const root = el('aside', 'lab-panel');
  root.innerHTML = `
    <header class="lab-head">
      <span class="lab-title">${title}</span>
      <button type="button" class="lab-icon" data-act="collapse" title="Plegar panel">_</button>
    </header>
    <div class="lab-body">
      <section class="lab-transport">
        <button type="button" class="lab-btn lab-btn--primary" data-act="play">▶ PLAY</button>
        <button type="button" class="lab-btn" data-act="regen" title="Regenerar edificios (R)">⟳ CIUDAD</button>
        <button type="button" class="lab-btn" data-act="pattern" title="Siguiente patrón láser (P)">✦ LÁSER</button>
        <button type="button" class="lab-btn" data-act="fs" title="Pantalla completa (F)">⛶</button>
      </section>
      <section class="lab-meters">
        <div class="lab-meter"><span>BAJO</span><i><b data-meter="bass"></b></i></div>
        <div class="lab-meter"><span>MEDIO</span><i><b data-meter="mid"></b></i></div>
        <div class="lab-meter"><span>AGUDO</span><i><b data-meter="treble"></b></i></div>
        <div class="lab-beat"><span class="lab-led" data-led></span><span data-bpm>-- BPM</span></div>
      </section>
      <section class="lab-presets"></section>
      <div class="lab-groups"></div>
      <footer class="lab-foot">
        <button type="button" class="lab-btn lab-btn--ghost" data-act="reset">RESTABLECER</button>
        <p>Espacio ▶/❚❚ · H panel · F pantalla completa · R ciudad · P láser</p>
      </footer>
    </div>
  `;

  const groupsEl = root.querySelector('.lab-groups');
  const presetsEl = root.querySelector('.lab-presets');
  const playBtn = root.querySelector('[data-act="play"]');
  const meters = {
    bass: root.querySelector('[data-meter="bass"]'),
    mid: root.querySelector('[data-meter="mid"]'),
    treble: root.querySelector('[data-meter="treble"]'),
  };
  const led = root.querySelector('[data-led]');
  const bpmEl = root.querySelector('[data-bpm]');

  // --- presets ---
  for (const name of Object.keys(presets)) {
    const b = el('button', 'lab-chip');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('click', () => {
      if (onPreset) onPreset(name, presets[name]);
      sync();
    });
    presetsEl.appendChild(b);
  }

  // --- controles agrupados ---
  const controls = []; // { def, input, output }
  const groups = new Map();
  for (const def of definitions) {
    if (!groups.has(def.group)) {
      const details = el('details', 'lab-group');
      details.open = def.group === 'Audio' || def.group === 'Láseres';
      details.appendChild(el('summary', '', def.group));
      groupsEl.appendChild(details);
      groups.set(def.group, details);
    }
    const holder = groups.get(def.group);
    const row = el('label', 'lab-row');
    const label = el('span', 'lab-label', def.label);
    row.appendChild(label);

    if (def.type === 'toggle') {
      row.classList.add('lab-row--toggle');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!params[def.key];
      input.addEventListener('change', () => {
        if (onParam) onParam(def.key, input.checked);
      });
      row.appendChild(input);
      row.appendChild(el('span', 'lab-switch'));
      controls.push({ def, input, output: null });
    } else {
      const output = el('output', 'lab-value');
      const input = el('input');
      input.type = 'range';
      input.min = def.min;
      input.max = def.max;
      input.step = def.step;
      input.value = params[def.key];
      const dec = decimalsOf(def.step);
      const fmt = (v) => Number(v).toFixed(dec);
      output.textContent = fmt(params[def.key]);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        output.textContent = fmt(v);
        if (onParam) onParam(def.key, v);
      });
      row.appendChild(output);
      row.appendChild(input);
      controls.push({ def, input, output, fmt });
    }
    holder.appendChild(row);
  }

  // Vuelve a leer los valores de `params` (tras un preset o un reset)
  function sync() {
    for (const c of controls) {
      const v = params[c.def.key];
      if (c.def.type === 'toggle') c.input.checked = !!v;
      else {
        c.input.value = v;
        c.output.textContent = c.fmt(v);
      }
    }
  }

  // --- botones ---
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'collapse': root.classList.toggle('is-collapsed'); break;
      case 'play': if (onTogglePlay) onTogglePlay(); break;
      case 'regen': if (onRegenerate) onRegenerate(); break;
      case 'pattern': if (onNextPattern) onNextPattern(); break;
      case 'fs': if (onFullscreen) onFullscreen(); break;
      case 'reset':
        if (onReset) onReset();
        sync();
        break;
      default: break;
    }
  });

  mount.appendChild(root);

  return {
    element: root,
    sync,
    toggleHidden() { root.classList.toggle('is-hidden'); },
    setPlaying(isPlaying) {
      playBtn.textContent = isPlaying ? '❚❚ PAUSA' : '▶ PLAY';
      playBtn.classList.toggle('is-on', isPlaying);
    },
    // se llama cada frame con los niveles de audio
    update(levels) {
      meters.bass.style.transform = `scaleX(${Math.min(1, levels.bass).toFixed(3)})`;
      meters.mid.style.transform = `scaleX(${Math.min(1, levels.mid).toFixed(3)})`;
      meters.treble.style.transform = `scaleX(${Math.min(1, levels.treble).toFixed(3)})`;
      led.style.opacity = (0.15 + levels.beat * 0.85).toFixed(2);
      bpmEl.textContent = levels.bpm ? `${Math.round(levels.bpm)} BPM` : '-- BPM';
    },
    destroy() { root.remove(); },
  };
}