import test from 'node:test';
import assert from 'node:assert/strict';
import { wristAngles, armAngle, elbowBend, armMetrics } from '../app/js/wrist-math.js';

const rad = (d) => (d * Math.PI) / 180;
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// Right hand held up, palm facing the camera (z away from camera), thumb to the viewer's right.
// Back of hand points +z (away). Forearm points up (y down => -y).
const F = [0, -1, 0];
const R_RIGHT = [1, 0, 0];
const R_LEFT = [-1, 0, 0]; // left hand palm to camera: thumb on viewer's left, back of hand also +z

test('straight wrist reads 0/0', () => {
  const { fe, dev } = wristAngles(F, F, R_RIGHT, false);
  near(fe, 0); near(dev, 0);
});

for (const [name, r, left] of [['right', R_RIGHT, false], ['left', R_LEFT, true]]) {
  test(`${name} hand: bending back of hand (extension) is positive`, () => {
    for (const a of [10, 25, 45]) {
      const h = [0, -Math.cos(rad(a)), Math.sin(rad(a))]; // tilts toward +z = back of hand
      near(wristAngles(F, h, r, left).fe, a);
      const hf = [0, -Math.cos(rad(a)), -Math.sin(rad(a))]; // toward palm = flexion
      near(wristAngles(F, hf, r, left).fe, -a);
    }
  });
  test(`${name} hand: tilting toward thumb (radial deviation) is positive`, () => {
    const h = [r[0] * Math.sin(rad(30)), -Math.cos(rad(30)), 0];
    const { fe, dev } = wristAngles(F, h, r, left);
    near(dev, 30); near(fe, 0);
  });
}

test('flexion and deviation separate when combined', () => {
  // 20° extension then 15° radial
  const h = [Math.sin(rad(15)), -Math.cos(rad(15)) * Math.cos(rad(20)), Math.cos(rad(15)) * Math.sin(rad(20))];
  const { fe, dev } = wristAngles(F, h, R_RIGHT, false);
  near(fe, 20, 1); near(dev, 15, 1);
});

test('arm angle from vertical', () => {
  near(armAngle([0, 0, 0], [0, 1, 0]), 0);
  near(armAngle([0, 0, 0], [1, 0, 0]), 90);
  near(armAngle([0, 0, 0], [0, -1, 0]), 180);
  near(armAngle([0, 0, 0], [0, 1, 1]), 45);
});

test('elbow bend: straight arm is 0', () => {
  near(elbowBend([0, 0, 0], [0, 1, 0], [0, 2, 0]), 0);
  near(elbowBend([0, 0, 0], [0, 1, 0], [1, 1, 0]), 90);
});

test('armMetrics falls back to pose hand points', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  // left arm hanging straight down, hand straight, palm facing camera, thumb on viewer's left (left hand)
  lm[11] = { x: 0, y: 0, z: 0 }; lm[13] = { x: 0, y: 0.3, z: 0 }; lm[15] = { x: 0, y: 0.6, z: 0 };
  lm[19] = { x: -0.03, y: 0.7, z: 0 }; lm[17] = { x: 0.03, y: 0.7, z: 0 };
  const m = armMetrics(lm, 'L');
  assert.equal(m.source, 'pose');
  near(m.fe, 0); near(m.dev, 0); near(m.arm, 0);
});
