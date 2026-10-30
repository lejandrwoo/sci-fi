// =====================================================================
//  labpanel.js — Enlace con el HTML: slider de audio, primer gesto del
//  usuario (para arrancar el audio) y modo presentación (tecla P).
// =====================================================================
import { PARAMS, state } from '../simulation/parameters.js';

export function createLabPanel({ canvas, audio, onStart }) {
  const seekWrap = document.getElementById('seekWrap');
  const seek = document.getElementById('seek');
  let dragging = false;

  // ---------- Pista de inicio (se elimina con ui.showStartHint = false) ----------
  let hint = null;
  if (PARAMS.ui.showStartHint) {
    hint = document.createElement('div');
    hint.id = 'hint';
    hint.textContent = PARAMS.ui.hintText;
    document.body.appendChild(hint);
  }

  // ---------- Primer gesto: los navegadores bloquean el audio hasta que hay uno ----------
  let startedOnce = false;
  const firstGesture = () => {
    if (startedOnce) return;
    startedOnce = true;
    if (hint) {
      hint.remove();
      hint = null;
    }
    window.removeEventListener('pointerdown', firstGesture, true);
    window.removeEventListener('keydown', firstGesture, true);
    window.removeEventListener('touchend', firstGesture, true);
    if (onStart) onStart();
  };
  window.addEventListener('pointerdown', firstGesture, true);
  window.addEventListener('keydown', firstGesture, true);
  window.addEventListener('touchend', firstGesture, true);

  canvas.addEventListener('click', async () => {
    if (!state.started) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch (err) {
      console.warn('No se pudo reanudar el audio:', err);
    }
  });

  // ---------- Slider ----------
  seek.addEventListener('pointerdown', () => { dragging = true; });
  seek.addEventListener('change', () => { dragging = false; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });

  seek.addEventListener('input', () => {
    const d = audio.duration;
    if (d > 0 && isFinite(d)) {
      audio.currentTime = (Number(seek.value) / Number(seek.max)) * d;
    }
  });

  // Llamado en cada frame desde main.js
  function sync(current, duration) {
    if (dragging || !(duration > 0) || !isFinite(duration)) return;
    seek.value = String((current / duration) * Number(seek.max));
  }

  // ---------- Modo presentación (tecla P) ----------
  function applyPresentation(on) {
    state.presentation = on;
    seekWrap.classList.toggle('hidden', on);
    if (hint) hint.classList.toggle('hidden', on);
    document.body.classList.toggle('no-cursor', on);
  }

  async function togglePresentation() {
    const entering = !state.presentation;
    const root = document.documentElement;
    try {
      if (entering) {
        if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      } else if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    } catch (err) {
      // Si el navegador no permite pantalla completa (p. ej. iPhone) igual ocultamos la UI
      console.warn('Fullscreen no disponible:', err);
    }
    applyPresentation(entering);
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      togglePresentation();
    }
  });

  // Si el usuario sale con ESC, restauramos mouse y slider
  const onFsChange = () => {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fs && state.presentation) applyPresentation(false);
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // En celulares no hay tecla P: doble toque sobre el canvas hace lo mismo
  canvas.addEventListener('dblclick', togglePresentation);

  return { sync, togglePresentation };
}