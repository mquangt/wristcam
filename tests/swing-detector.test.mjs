import test from 'node:test';
import assert from 'node:assert/strict';
import { SwingDetector } from '../app/js/swing-detector.js';
import { defaultSettings, evaluate, presetPositions } from '../app/js/settings.js';

// Synthetic lead-arm angle over time: still at address, back to ~140° at the top, down to ~5° at impact, up to finish.
function swingCurve() {
  const keys = [[0, 8], [1.0, 8], [1.3, 40], [1.6, 90], [2.0, 140], [2.15, 120], [2.3, 70], [2.38, 30], [2.45, 6], [2.55, 40], [2.8, 120], [3.0, 150], [4.0, 150]];
  const frames = [];
  for (let t = 0; t <= 4; t += 1 / 30) {
    let i = keys.findIndex((k) => k[0] > t);
    if (i < 0) i = keys.length - 1;
    const [t0, a0] = keys[Math.max(0, i - 1)], [t1, a1] = keys[i];
    const a = t1 === t0 ? a1 : a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    frames.push({ t, a });
  }
  return frames.map((f, i) => {
    const p = frames[i - 1];
    const speed = p ? Math.abs(f.a - p.a) / (f.t - p.t) / 30 : 0; // rough: arm deg/s -> torso/s
    return { t: f.t, armAngle: f.a, speed, metrics: { fe: f.a > 120 ? 20 : 5, dev: 10, arm: 3 } };
  });
}

test('detects every position in order for a full swing', () => {
  const order = [];
  let ended = null;
  const det = new SwingDetector(defaultSettings().detect, {
    checkpoint: (id) => order.push(id),
    swingEnd: (hits) => { ended = hits; },
  });
  for (const f of swingCurve()) det.update(f);
  assert.deepEqual(order, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P10']);
  assert.ok(ended);
  assert.ok(Math.abs(ended.P4.t - 2.0) < 0.05, `top at ${ended.P4.t}`);
  assert.ok(Math.abs(ended.P7.t - 2.45) < 0.05, `impact at ${ended.P7.t}`);
});

test('a waggle that never reaches P3 does not count as a swing', () => {
  const order = [];
  const det = new SwingDetector(defaultSettings().detect, { checkpoint: (id) => order.push(id) });
  const pts = [];
  for (let t = 0; t < 1; t += 1 / 30) pts.push({ t, armAngle: 8, speed: 0 });
  for (let t = 1; t < 1.3; t += 1 / 30) pts.push({ t, armAngle: 8 + (t - 1) * 150, speed: 2 });
  for (let t = 1.3; t < 1.6; t += 1 / 30) pts.push({ t, armAngle: 53 - (t - 1.3) * 150, speed: 2 });
  for (const p of pts) det.update({ ...p, metrics: { fe: 0 } });
  assert.ok(!order.includes('P4'));
  assert.equal(det.state, 'address');
});

test('evaluate flags out-of-range wrist with direction', () => {
  const pos = presetPositions('neutral').P4; // -10..15
  assert.equal(evaluate(pos, { fe: 5 }).ok, true);
  const hi = evaluate(pos, { fe: 25 });
  assert.equal(hi.ok, false);
  assert.equal(hi.checks[0].dir, 1);
  assert.equal(evaluate(pos, { fe: -20 }).checks[0].dir, -1);
});
