// Settings: defaults, swing presets, persistence. Pure apart from localStorage access (guarded).

export const POSITIONS = [
  { id: 'P1', short: 'Address', name: 'P1 · Address' },
  { id: 'P2', short: 'P2', name: 'P2 · Shaft parallel (back)' },
  { id: 'P3', short: 'P3', name: 'P3 · Lead arm parallel (back)' },
  { id: 'P4', short: 'Top', name: 'P4 · Top' },
  { id: 'P5', short: 'P5', name: 'P5 · Lead arm parallel (down)' },
  { id: 'P6', short: 'P6', name: 'P6 · Shaft parallel (down)' },
  { id: 'P7', short: 'Impact', name: 'P7 · Impact' },
  { id: 'P8', short: 'P8', name: 'P8 · Shaft parallel (through)' },
  { id: 'P10', short: 'Finish', name: 'P10 · Finish' },
];

export const METRICS = [
  { id: 'fe', name: 'Flexion / extension', short: 'Wrist', hint: '+ extension (cupped) · − flexion (bowed)' },
  { id: 'dev', name: 'Radial / ulnar (hinge)', short: 'Hinge', hint: '+ radial (hinged) · − ulnar' },
  { id: 'arm', name: 'Lead arm bend', short: 'Arm bend', hint: '0 = straight arm' },
];

// Wrist flexion/extension target ranges (degrees) per preset. null = not checked by default.
const FE = {
  neutral: { P1: [10, 35], P2: [5, 30], P3: [0, 25], P4: [-10, 15], P5: [-10, 15], P6: [-15, 10], P7: [-25, 0], P8: [-30, 10], P10: [-20, 30] },
  bowed:   { P1: [10, 35], P2: [0, 25], P3: [-10, 15], P4: [-30, -5], P5: [-30, 0], P6: [-30, -5], P7: [-35, -10], P8: [-35, 0], P10: [-20, 30] },
  cupped:  { P1: [15, 40], P2: [10, 35], P3: [5, 30], P4: [5, 30], P5: [0, 25], P6: [-5, 15], P7: [-15, 5], P8: [-25, 15], P10: [-20, 30] },
};
const DEV = { P1: [0, 30], P2: [10, 40], P3: [20, 55], P4: [20, 55], P5: [20, 55], P6: [15, 45], P7: [-5, 25], P8: [-15, 25], P10: [-30, 30] };
const ARM = { P1: [0, 15], P2: [0, 15], P3: [0, 15], P4: [0, 25], P5: [0, 20], P6: [0, 15], P7: [0, 15], P8: [0, 40], P10: [0, 90] };
const ALERT_ON = new Set(['P2', 'P3', 'P4', 'P7']);

export const PRESETS = {
  neutral: { name: 'Neutral / flat at top', note: 'Flat-ish lead wrist at the top, flexing into impact.' },
  bowed: { name: 'Bowed (strong grip)', note: 'Flexed lead wrist from P3 through impact.' },
  cupped: { name: 'Cupped (weak grip)', note: 'Some extension at the top, less flexion at impact.' },
};

export function presetPositions(preset = 'neutral') {
  const fe = FE[preset] || FE.neutral;
  const out = {};
  for (const { id } of POSITIONS) {
    out[id] = {
      alert: ALERT_ON.has(id),
      fe: { on: true, min: fe[id][0], max: fe[id][1] },
      dev: { on: false, min: DEV[id][0], max: DEV[id][1] },
      arm: { on: false, min: ARM[id][0], max: ARM[id][1] },
    };
  }
  return out;
}

export function defaultSettings() {
  return {
    version: 1,
    golfer: { handed: 'right' },
    view: 'dtl',
    camera: { facing: 'environment', fps: 60 },
    mode: 'swing',
    tracking: { model: 'full', hands: true, wrist: 'lead', smoothing: 0.5 },
    preset: 'neutral',
    positions: presetPositions('neutral'),
    sound: {
      enabled: true, volume: 0.8,
      style: 'out',          // 'out' = beep when out of range, 'in' = beep when in range
      directional: true,     // high pitch = too extended/cupped, low pitch = too flexed/bowed
      successChime: false,
      voice: false,          // speak each fault as it happens (swing mode)
      voiceSummary: true,    // speak a summary after each swing
      repeatMs: 400, holdMs: 150,
    },
    drill: { position: 'auto', tolerance: 6 },
    calib: { feOffset: 0, devOffset: 0 },
    detect: { addressMaxArm: 30, p2Arm: 35, p3Arm: 80, topDrop: 12, impactRise: 10, stillSpeed: 0.6, addressHold: 0.4 },
    replay: true,
    playbackRate: 0.5,
  };
}

const KEY = 'wristcam.settings.v1';

/** Deep-merge saved values over defaults so new settings appear after upgrades. */
export function merge(base, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(base)) return saved ?? base;
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], saved[k]) : saved[k];
  }
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(defaultSettings(), JSON.parse(raw));
  } catch { /* private mode or blocked storage */ }
  return defaultSettings();
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Checks the metrics against one position's targets. Returns { ok, checks: [{metric, value, min, max, ok, dir}] }. */
export function evaluate(posCfg, metrics) {
  const checks = [];
  for (const { id } of METRICS) {
    const t = posCfg?.[id];
    const value = metrics?.[id];
    if (!t?.on || !Number.isFinite(value)) continue;
    const ok = value >= t.min && value <= t.max;
    checks.push({ metric: id, value, min: t.min, max: t.max, ok, dir: ok ? 0 : value > t.max ? 1 : -1 });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

export function describeCheck(c) {
  const v = Math.round(c.value);
  if (c.metric === 'fe') {
    const word = c.dir > 0 ? 'too cupped' : c.dir < 0 ? 'too bowed' : 'good';
    return `${word}, ${Math.abs(v)} degrees ${v >= 0 ? 'extension' : 'flexion'}`;
  }
  if (c.metric === 'dev') return `${c.dir > 0 ? 'too much hinge' : c.dir < 0 ? 'not enough hinge' : 'hinge good'}, ${v} degrees`;
  return `${c.dir > 0 ? 'lead arm bent' : 'arm good'}, ${v} degrees`;
}
