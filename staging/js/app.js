// WristCam: UI wiring, frame loop, drill/swing feedback.

import { POSE, v, armAngle, armMetrics, sub, len } from './wrist-math.js?v=c832d20';
import { SwingDetector } from './swing-detector.js?v=c832d20';
import { Sound } from './audio.js?v=c832d20';
import { createTracker } from './tracker.js?v=c832d20';
import { drawFrame } from './overlay.js?v=c832d20';
import { renderSettings } from './settings-ui.js?v=c832d20';
import { POSITIONS, METRICS, loadSettings, saveSettings, evaluate, describeCheck } from './settings.js?v=c832d20';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');

const S = loadSettings();
const sound = new Sound(S);
const posName = Object.fromEntries(POSITIONS.map((p) => [p.id, p]));

let tracker = null;
let trackerKey = '';
let running = false;
let source = 'camera';
let stream = null;
let detector = null;
let prev = null;          // previous frame (speed + smoothing)
let fps = { n: 0, t0: performance.now(), value: 0 };
let drillState = { badSince: null, okSince: null };
let swing = null;         // { results: {P: {...}} } for the swing in progress
let lastSwing = null;     // { results, frames, hits }
let flash = null;         // { ev, until } colour the readout after a checkpoint
let wakeLock = null;
let lastUi = 0;

// ---------- small helpers ----------
const setStatus = (t) => { $('status').textContent = t; };
const leadSide = () => (S.golfer.handed === 'right' ? 'L' : 'R');
const trackedSide = () => (S.tracking.wrist === 'lead' ? leadSide() : leadSide() === 'L' ? 'R' : 'L');
const fmtFe = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))}° ${x >= 0 ? 'ext' : 'flex'}` : '–');
const fmtDeg = (x) => (Number.isFinite(x) ? `${Math.round(x)}°` : '–');
const save = () => saveSettings(S);

function setMode(mode) {
  S.mode = mode;
  save();
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('btnCapture').hidden = mode !== 'drill' || !running;
  $('btnReplay').hidden = mode !== 'swing' || !lastSwing?.frames?.length;
  detector?.reset();
  swing = null;
  $('chipPhase').textContent = mode === 'drill' ? 'Drill' : 'Waiting for address';
  $('chipPos').textContent = '';
}

// ---------- tracker / sources ----------
async function ensureTracker() {
  const key = `${S.tracking.model}|${S.tracking.hands}`;
  if (tracker && key === trackerKey) return;
  tracker?.close();
  tracker = null;
  tracker = await createTracker({ model: S.tracking.model, hands: S.tracking.hands, onStatus: setStatus });
  trackerKey = key;
}

async function startCamera() {
  sound.unlock();
  try {
    $('btnCamera').disabled = true;
    await ensureTracker();
    setStatus('Starting camera…');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: S.camera.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: S.camera.fps } },
    });
    video.srcObject = stream;
    video.removeAttribute('src');
    await video.play();
    source = 'camera';
    begin();
  } catch (e) {
    console.error(e);
    setStatus(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access for this site and try again.' : `Could not start: ${e.message || e}`);
  } finally {
    $('btnCamera').disabled = false;
  }
}

async function startFile(file) {
  sound.unlock();
  try {
    await ensureTracker();
    stopStream();
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.loop = false;
    await video.play();
    video.playbackRate = S.playbackRate;
    source = 'file';
    begin();
  } catch (e) {
    console.error(e);
    setStatus(`Could not open video: ${e.message || e}`);
  }
}

function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function begin() {
  running = true;
  prev = null;
  detector = new SwingDetector(S.detect, { checkpoint: onCheckpoint, swingEnd: onSwingEnd, phase: onPhase });
  const mirror = source === 'camera' && S.camera.facing === 'user';
  video.classList.toggle('mirror', mirror);
  overlay.classList.toggle('mirror', mirror);
  $('start').hidden = true;
  $('hud').hidden = false;
  setStatus('');
  setMode(S.mode);
  requestWakeLock();
  schedule();
}

function stop() {
  running = false;
  stopStream();
  video.pause();
  $('hud').hidden = true;
  $('results').hidden = true;
  $('start').hidden = false;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  wakeLock?.release?.();
  wakeLock = null;
}

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
}
document.addEventListener('visibilitychange', () => { if (running && document.visibilityState === 'visible') requestWakeLock(); });

function schedule() {
  if (!running) return;
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame((now) => onFrame(now, { mediaTime: video.currentTime }));
}

function onFrame(now, meta) {
  if (!running) return;
  try {
    if (video.readyState >= 2 && !video.paused) process(source === 'file' ? meta.mediaTime : now / 1000);
  } catch (e) {
    console.error(e);
  }
  if (source === 'file' && video.ended) { $('chipPhase').textContent = 'Video finished'; }
  schedule();
}

// ---------- per-frame processing ----------
function process(t) {
  const W = video.videoWidth, H = video.videoHeight;
  if (!W || !H) return;
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }

  const side = trackedSide();
  const det = tracker.detect(video, performance.now(), side);
  tickFps();
  octx.clearRect(0, 0, W, H);
  if (!det) {
    $('chipPhase').textContent = 'No golfer in view';
    prev = null;
    return;
  }

  const raw = armMetrics(det.world, side, det.hand?.world);
  raw.fe += S.calib.feOffset;
  raw.dev += S.calib.devOffset;

  const L = POSE[leadSide()];
  const lead = armAngle(v(det.world[L.shoulder]), v(det.world[L.wrist]));

  // Hand speed in torso-lengths per second (torso stays visible in both views).
  const px = (p) => [p.x * W, p.y * H, 0];
  const torso = len(sub(px(midLm(det.lm[11], det.lm[12])), px(midLm(det.lm[23], det.lm[24])))) || H / 3;
  const wp = px(det.lm[L.wrist]);
  let speed = 0;
  if (prev && t > prev.t) speed = len(sub(wp, prev.wp)) / torso / (t - prev.t);
  if (prev) speed = 0.5 * speed + 0.5 * prev.speed;

  // Smoothing: heavier in drill mode (static positions), light in swing mode (fast motion).
  const k = S.mode === 'drill' ? 1 - S.tracking.smoothing * 0.85 : 1 - S.tracking.smoothing * 0.4;
  const metrics = {};
  for (const { id } of METRICS) metrics[id] = prev ? prev.metrics[id] + k * (raw[id] - prev.metrics[id]) : raw[id];

  const frame = { t, armAngle: lead, speed, metrics, det, src: raw.source };
  prev = { t, wp, speed, metrics };

  let status = 'idle';
  let pos = null, ev = null;
  if (S.mode === 'drill') {
    ({ pos, ev, status } = drill(frame));
  } else {
    detector.update(frame);
    captureReplay(frame);
    if (flash && performance.now() < flash.until) { ev = flash.ev; pos = flash.pos; status = ev.ok ? 'ok' : 'bad'; }
  }

  drawFrame(octx, det, side, status, W, H);
  updateReadout(metrics, pos, ev, raw.source, lead);
}

const midLm = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function tickFps() {
  fps.n++;
  const now = performance.now();
  if (now - fps.t0 > 1000) { fps.value = Math.round((fps.n * 1000) / (now - fps.t0)); fps.n = 0; fps.t0 = now; }
}

// ---------- drill mode ----------
function autoPosition(a) {
  const d = S.detect;
  if (a < d.addressMaxArm) return 'P1';
  if (a < (d.p2Arm + d.p3Arm) / 2) return 'P2';
  if (a < d.p3Arm + 20) return 'P3';
  return 'P4';
}

function worst(ev) {
  return ev.checks.filter((c) => !c.ok).sort((a, b) => overBy(b) - overBy(a))[0];
}
const overBy = (c) => (c.dir > 0 ? c.value - c.max : c.min - c.value);

function drill(f) {
  const pos = S.drill.position === 'auto' ? autoPosition(f.armAngle) : S.drill.position;
  const ev = evaluate(S.positions[pos], f.metrics);
  const status = !ev.checks.length ? 'idle' : ev.ok ? 'ok' : 'bad';
  const now = performance.now();
  const hold = S.sound.holdMs;
  if (status === 'bad') {
    drillState.okSince = null;
    drillState.badSince ??= now;
    if (S.sound.style === 'out' && now - drillState.badSince >= hold) {
      const w = worst(ev);
      sound.repeat(() => sound.fault(w.metric, w.dir));
    }
  } else if (status === 'ok') {
    drillState.badSince = null;
    drillState.okSince ??= now;
    if (S.sound.style === 'in' && now - drillState.okSince >= hold) sound.repeat(() => sound.good());
  } else {
    drillState.badSince = drillState.okSince = null;
  }
  $('chipPhase').textContent = `Drill · ${posName[pos].short}`;
  return { pos, ev, status };
}

function capturePosition() {
  if (!prev) return;
  const pos = S.drill.position === 'auto' ? autoPosition(prevArm()) : S.drill.position;
  const tol = S.drill.tolerance;
  const cfg = S.positions[pos];
  for (const { id } of METRICS) {
    if (id === 'arm' && !cfg.arm.on) continue;
    const x = Math.round(prev.metrics[id]);
    cfg[id].min = x - tol;
    cfg[id].max = x + tol;
  }
  S.preset = 'custom';
  save();
  sound.good();
  $('chipPos').textContent = `${posName[pos].short} target set: ${fmtFe(prev.metrics.fe)} ±${tol}°`;
}
let lastLeadAngle = 0;
const prevArm = () => lastLeadAngle;

// ---------- swing mode ----------
function onPhase(state) {
  const label = { idle: 'Waiting for address', address: 'Address ✓ — swing when ready', backswing: 'Backswing', downswing: 'Downswing', through: 'Follow-through', cooldown: 'Swing captured' }[state];
  $('chipPhase').textContent = label || state;
  if (state === 'backswing') { swing = { results: {} }; $('results').hidden = true; }
}

function onCheckpoint(id, frame, metrics) {
  const cfg = S.positions[id];
  const ev = evaluate(cfg, metrics);
  if (!swing) swing = { results: {} };
  swing.results[id] = { metrics, ev, t: frame.t };
  if (!cfg.alert) return;
  flash = { ev, pos: id, until: performance.now() + 1200 };
  $('chipPos').textContent = `${posName[id].short}: ${ev.ok ? 'good' : 'fault'}`;
  $('chipPos').className = `chip ${ev.ok ? 'ok' : 'bad'}`;
  if (!ev.checks.length) return;
  if (!ev.ok) {
    const w = worst(ev);
    if (S.sound.style === 'out') sound.fault(w.metric, w.dir);
    if (S.sound.voice) sound.say(`${posName[id].short}, ${describeCheck(w)}`);
  } else if (S.sound.style === 'in' || S.sound.successChime) {
    sound.good();
  }
}

function onSwingEnd(hits) {
  const results = swing?.results || {};
  swing = null;
  const t0 = hits.P1?.t ?? -Infinity;
  const frames = S.replay ? ring.filter((r) => r.t >= t0 - 0.2).map((r) => ({ ...r })) : [];
  frames.forEach((fr) => { fr.canvas = cloneCanvas(fr.canvas); });
  lastSwing = { results, frames, hits };
  $('btnReplay').hidden = !frames.length;
  showResults(results);
  if (S.sound.voiceSummary) {
    const faults = POSITIONS.filter((p) => S.positions[p.id].alert && results[p.id] && !results[p.id].ev.ok)
      .map((p) => `${p.short}, ${describeCheck(worst(results[p.id].ev))}`);
    const checked = POSITIONS.some((p) => S.positions[p.id].alert && results[p.id]?.ev.checks.length);
    if (checked) sound.say(faults.length ? faults.join('. ') : 'All checked positions good.', true);
  }
}

function showResults(results) {
  const rows = POSITIONS.filter((p) => results[p.id]).map((p) => {
    const r = results[p.id];
    const cell = (id, fmt) => {
      const c = r.ev.checks.find((x) => x.metric === id);
      const cls = c ? (c.ok ? 'ok' : 'bad') : '';
      return `<td class="${cls}">${fmt(r.metrics[id])}</td>`;
    };
    return `<tr><td>${p.short}${S.positions[p.id].alert ? '' : ' <small>(not checked)</small>'}</td>${cell('fe', fmtFe)}${cell('dev', fmtDeg)}${cell('arm', fmtDeg)}</tr>`;
  });
  const el = $('results');
  el.innerHTML = `<h3>Last swing <button class="icon" id="btnResultsClose" aria-label="Close">✕</button></h3>
    <table><tr><td></td><td>Wrist</td><td>Hinge</td><td>Arm</td></tr>${rows.join('') || '<tr><td colspan=4>No positions detected.</td></tr>'}</table>`;
  el.hidden = false;
  $('btnResultsClose').onclick = () => { el.hidden = true; };
}

// ---------- replay buffer ----------
const RING_MAX = 110;
const ring = [];
const pool = [];
let lastCapT = -1;

function captureReplay(f) {
  if (!S.replay || detector.state === 'idle' || detector.state === 'cooldown') return;
  if (f.t - lastCapT < 1 / 31) return;
  lastCapT = f.t;
  const W = video.videoWidth, H = video.videoHeight;
  const s = 320 / Math.max(W, H);
  let c = ring.length >= RING_MAX ? ring.shift().canvas : pool.pop() || document.createElement('canvas');
  c.width = Math.round(W * s);
  c.height = Math.round(H * s);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  ring.push({ t: f.t, canvas: c, det: { lm: f.det.lm, hand: f.det.hand }, metrics: f.metrics });
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ---------- replay viewer ----------
let replayTimer = null;
function openReplay() {
  if (!lastSwing?.frames?.length) return;
  const frames = lastSwing.frames;
  const cv = $('replayCanvas');
  const slider = $('replaySlider');
  slider.max = frames.length - 1;
  slider.value = 0;
  const chips = $('replayChips');
  chips.innerHTML = '';
  for (const p of POSITIONS) {
    const hit = lastSwing.hits[p.id];
    if (!hit) continue;
    let best = 0;
    frames.forEach((fr, i) => { if (Math.abs(fr.t - hit.t) < Math.abs(frames[best].t - hit.t)) best = i; });
    const r = lastSwing.results[p.id];
    const b = document.createElement('button');
    b.className = `chip ${r?.ev.checks.length && S.positions[p.id].alert ? (r.ev.ok ? 'ok' : 'bad') : ''}`;
    b.textContent = p.short;
    b.onclick = () => { slider.value = best; show(best); };
    chips.appendChild(b);
  }
  const mirror = source === 'camera' && S.camera.facing === 'user';
  function show(i) {
    const fr = frames[i];
    cv.width = fr.canvas.width * 2;
    cv.height = fr.canvas.height * 2;
    const ctx = cv.getContext('2d');
    ctx.save();
    if (mirror) { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(fr.canvas, 0, 0, cv.width, cv.height);
    drawFrame(ctx, fr.det, trackedSide(), 'idle', cv.width, cv.height);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, 0, cv.width, 34);
    ctx.fillStyle = '#fff';
    ctx.font = '600 20px system-ui';
    ctx.fillText(`${fmtFe(fr.metrics.fe)}   hinge ${fmtDeg(fr.metrics.dev)}   arm ${fmtDeg(fr.metrics.arm)}`, 10, 24);
  }
  slider.oninput = () => show(+slider.value);
  $('btnReplayPlay').onclick = () => {
    clearInterval(replayTimer);
    let i = 0;
    replayTimer = setInterval(() => {
      if (i >= frames.length) { clearInterval(replayTimer); return; }
      slider.value = i; show(i++);
    }, 120);
  };
  show(0);
  $('replay').showModal();
}

// ---------- readout ----------
function updateReadout(m, pos, ev, src, lead) {
  lastLeadAngle = lead;
  const now = performance.now();
  if (now - lastUi < 80) return;
  lastUi = now;
  const set = (id, val, metric) => {
    $(`val${id}`).textContent = val;
    const box = $(`val${id}`).parentElement;
    const cfg = pos ? S.positions[pos][metric] : null;
    const c = ev?.checks.find((x) => x.metric === metric);
    box.className = `metric${id === 'Fe' ? ' big' : ''}${c ? (c.ok ? ' ok' : ' bad') : ''}${cfg && !cfg.on ? ' off' : ''}`;
    $(`tgt${id}`).textContent = cfg?.on ? `target ${cfg.min}…${cfg.max}°` : '';
  };
  set('Fe', fmtFe(m.fe), 'fe');
  set('Dev', fmtDeg(m.dev), 'dev');
  set('Arm', fmtDeg(m.arm), 'arm');
  $('chipSrc').textContent = src === 'hand' ? 'hand ✓' : 'hand: body est.';
  $('chipFps').textContent = `${fps.value} fps · arm ${Math.round(lead)}°`;
  if (S.mode === 'drill') { $('chipPos').textContent = ''; $('chipPos').className = 'chip'; }
}

// ---------- settings ----------
function openSettings() {
  renderSettings($('settingsBody'), S, {
    changed(path) {
      save();
      if (path === 'mode') setMode(S.mode);
      if (detector) detector.cfg = S.detect;
      if (path === 'playbackRate' && source === 'file') video.playbackRate = S.playbackRate;
    },
    testFault: (metric, dir) => { sound.unlock(); sound.fault(metric, dir); },
    testGood: () => { sound.unlock(); sound.good(); },
    testVoice: () => { sound.unlock(); sound.say('Top, too cupped, 14 degrees extension', true); },
  });
  $('settings').showModal();
}

$('settings').addEventListener('close', async () => {
  // Tracking model changes need a reload of the models.
  if (running && `${S.tracking.model}|${S.tracking.hands}` !== trackerKey) {
    running = false;
    $('chipPhase').textContent = 'Reloading models…';
    await ensureTracker();
    running = true;
    schedule();
  }
  if (running && source === 'camera' && stream) {
    const facing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
    if (facing && facing !== S.camera.facing) { stop(); startCamera(); }
  }
});

// ---------- wiring ----------
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { sound.unlock(); setMode(b.dataset.mode); }));
$('btnCamera').addEventListener('click', startCamera);
$('fileInput').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) startFile(f); e.target.value = ''; });
$('btnSettings').addEventListener('click', openSettings);
$('btnStop').addEventListener('click', stop);
$('btnCapture').addEventListener('click', capturePosition);
$('btnReplay').addEventListener('click', openReplay);
$('btnReplayClose').addEventListener('click', () => { clearInterval(replayTimer); $('replay').close(); });

if (location.pathname.includes('/staging')) $('envBadge').hidden = false;
setMode(S.mode);
fetch('version.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => { if (j) $('version').textContent = `Build ${j.sha} · ${j.env} · ${new Date(j.builtAt).toLocaleString()}`; })
  .catch(() => { $('version').textContent = 'Local build'; });
if (!window.isSecureContext) setStatus('Camera needs HTTPS (or localhost). Open the https:// link.');
