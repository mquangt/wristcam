// Builds the settings sheet from the settings object. Every control carries data-path="a.b.c".

import { POSITIONS, METRICS, PRESETS, presetPositions, defaultSettings } from './settings.js';

const get = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
function set(o, path, val) {
  const ks = path.split('.');
  const last = ks.pop();
  ks.reduce((x, k) => x[k], o)[last] = val;
}

const sel = (path, opts, label, hint = '') => `<div class="row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span>
  <select data-path="${path}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`;
const chk = (path, label, hint = '') => `<div class="row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" data-path="${path}"></div>`;
const num = (path, label, hint = '', step = 1) => `<div class="row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="number" step="${step}" data-path="${path}"></div>`;
const rng = (path, label, min, max, step) => `<div class="row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-path="${path}" style="max-width:50%"></div>`;

function positionsHtml() {
  return POSITIONS.map((p) => `<div class="pos" data-pos="${p.id}">
    <div class="pos-head"><label><input type="checkbox" data-path="positions.${p.id}.alert"> ${p.name}</label></div>
    <div class="pos-grid">
      ${METRICS.map((m) => `<input type="checkbox" data-path="positions.${p.id}.${m.id}.on" aria-label="${m.name}">
        <span>${m.short}</span>
        <input type="number" data-path="positions.${p.id}.${m.id}.min" aria-label="${m.short} min">
        <input type="number" data-path="positions.${p.id}.${m.id}.max" aria-label="${m.short} max">`).join('')}
    </div></div>`).join('');
}

export function renderSettings(root, S, hooks) {
  root.innerHTML = `
  <fieldset><legend>Golfer & camera</legend>
    ${sel('golfer.handed', [['right', 'Right-handed'], ['left', 'Left-handed']], 'Golfer')}
    ${sel('view', [['dtl', 'Down the line'], ['faceon', 'Face on']], 'Camera view', 'Used for setup tips and logged with swings')}
    ${sel('camera.facing', [['environment', 'Back camera'], ['user', 'Front (selfie) camera']], 'Camera', 'Front camera lets you see the screen')}
    ${sel('camera.fps', [['30', '30 fps'], ['60', '60 fps (if supported)']], 'Frame rate')}
    ${sel('tracking.wrist', [['lead', 'Lead wrist'], ['trail', 'Trail wrist']], 'Wrist measured')}
  </fieldset>

  <fieldset><legend>Sound</legend>
    ${chk('sound.enabled', 'Sound on')}
    ${rng('sound.volume', 'Volume', 0, 1, 0.05)}
    ${sel('sound.style', [['out', 'Beep when OUT of range'], ['in', 'Beep when IN range']], 'Beep when')}
    ${chk('sound.directional', 'Directional pitch', 'High double-beep = too cupped/too much · low beep = too bowed/too little')}
    ${chk('sound.successChime', 'Chime on good positions', 'Swing mode')}
    ${chk('sound.voice', 'Speak each fault as it happens', 'Swing mode')}
    ${chk('sound.voiceSummary', 'Speak a summary after each swing')}
    ${num('sound.repeatMs', 'Drill beep interval (ms)', '', 50)}
    ${num('sound.holdMs', 'Drill: out of range for (ms) before beeping', '', 50)}
    <div class="btnrow">
      <button type="button" data-test="fe+">Test: too cupped</button>
      <button type="button" data-test="fe-">Test: too bowed</button>
      <button type="button" data-test="dev+">Test: hinge</button>
      <button type="button" data-test="good">Test: good</button>
      <button type="button" data-test="voice">Test: voice</button>
    </div>
  </fieldset>

  <fieldset><legend>Swing type</legend>
    <div class="row"><span>Preset<small id="presetNote"></small></span>
      <select id="presetSel">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('')}<option value="custom">Custom</option></select></div>
    <p class="fine">Choosing a preset replaces the target ranges below. Edit any number to make it your own.</p>
  </fieldset>

  <fieldset><legend>Positions & targets (degrees)</legend>
    <p class="fine">Tick a position to check it and beep on it. Tick a metric to include it. Wrist: + extension (cupped), − flexion (bowed). Hinge: + radial (cocked). Arm: elbow bend, 0 = straight.</p>
    ${positionsHtml()}
  </fieldset>

  <fieldset><legend>Drill mode</legend>
    ${sel('drill.position', [['auto', 'Auto (from lead arm angle, backswing)'], ...POSITIONS.map((p) => [p.id, p.name])], 'Position practiced')}
    ${num('drill.tolerance', '"Set target" tolerance ±', 'Range set around your held position')}
  </fieldset>

  <fieldset><legend>Calibration</legend>
    ${num('calib.feOffset', 'Wrist offset (°)', 'Added to every flex/ext reading, e.g. to match a HackMotion sensor')}
    ${num('calib.devOffset', 'Hinge offset (°)')}
  </fieldset>

  <fieldset><legend>Tracking</legend>
    ${sel('tracking.model', [['lite', 'Lite (fastest)'], ['full', 'Full (balanced)'], ['heavy', 'Heavy (most accurate, slow)']], 'Body model')}
    ${chk('tracking.hands', 'Hand tracking', 'More precise wrist angle, a bit slower')}
    ${rng('tracking.smoothing', 'Smoothing', 0, 1, 0.05)}
    ${chk('replay', 'Keep a replay of the last swing')}
    ${sel('playbackRate', [['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×']], 'Video file analysis speed', 'Slower = more frames analysed')}
  </fieldset>

  <fieldset><legend>Swing detection (advanced)</legend>
    <p class="fine">Positions are found from the lead arm angle (0° hanging, 90° parallel to the ground).</p>
    ${num('detect.addressMaxArm', 'Address: arm below (°)')}
    ${num('detect.addressHold', 'Address: hold still (s)', '', 0.1)}
    ${num('detect.p2Arm', 'P2 / P6 / P8 arm angle (°)')}
    ${num('detect.p3Arm', 'P3 / P5 arm angle (°)')}
    ${num('detect.topDrop', 'Top: arm drops by (°)')}
    ${num('detect.impactRise', 'Impact: arm rises by (°)')}
    ${num('detect.stillSpeed', 'Still below (torso lengths/s)', '', 0.1)}
  </fieldset>

  <div class="btnrow"><button type="button" id="btnReset">Reset everything to defaults</button></div>`;

  const fill = () => {
    root.querySelectorAll('[data-path]').forEach((el) => {
      const val = get(S, el.dataset.path);
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = String(val);
    });
    root.querySelectorAll('.pos').forEach((el) => el.classList.toggle('disabled', !S.positions[el.dataset.pos].alert));
    root.querySelector('#presetSel').value = S.preset;
    root.querySelector('#presetNote').textContent = PRESETS[S.preset]?.note || 'Your own targets';
  };
  fill();

  root.oninput = root.onchange = (e) => {
    const el = e.target;
    if (el.id === 'presetSel') {
      if (e.type !== 'change') return;
      if (el.value !== 'custom') S.positions = presetPositions(el.value);
      S.preset = el.value;
      fill();
      hooks.changed('positions');
      return;
    }
    const path = el.dataset.path;
    if (!path) return;
    const old = get(S, path);
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (typeof old === 'number') { val = parseFloat(el.value); if (!Number.isFinite(val)) return; }
    else val = el.value;
    set(S, path, val);
    if (path.startsWith('positions.') && /\.(min|max)$/.test(path) && S.preset !== 'custom') { S.preset = 'custom'; fill(); }
    if (path.endsWith('.alert')) fill();
    hooks.changed(path);
  };

  root.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.test;
    if (t === 'good') hooks.testGood();
    else if (t === 'voice') hooks.testVoice();
    else hooks.testFault(t.slice(0, -1), t.endsWith('+') ? 1 : -1);
  }));

  root.querySelector('#btnReset').addEventListener('click', () => {
    if (!confirm('Reset all settings and targets to defaults?')) return;
    const d = defaultSettings();
    for (const k of Object.keys(S)) delete S[k];
    Object.assign(S, d);
    fill();
    hooks.changed('reset');
  });
}
