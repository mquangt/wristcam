// Pure geometry for wrist and arm angles. No DOM, no MediaPipe: unit-tested in tests/.
//
// Coordinates follow MediaPipe's world landmarks: metres, x right, y DOWN, z away from camera.
// Vectors are plain [x, y, z] arrays.

export const POSE = {
  L: { shoulder: 11, elbow: 13, wrist: 15, pinky: 17, index: 19, thumb: 21, hip: 23 },
  R: { shoulder: 12, elbow: 14, wrist: 16, pinky: 18, index: 20, thumb: 22, hip: 24 },
};
export const HAND = { wrist: 0, thumbMcp: 2, indexMcp: 5, middleMcp: 9, ringMcp: 13, pinkyMcp: 17 };

export const v = (p) => [p.x, p.y, p.z ?? 0];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mid = (a, b) => scale(add(a, b), 0.5);
/** Component of a perpendicular to unit vector n. */
export const reject = (a, n) => sub(a, scale(n, dot(a, n)));
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const deg = (r) => (r * 180) / Math.PI;

/** Angle in degrees between the arm (shoulder -> wrist) and straight down. 0 = hanging, 90 = parallel to ground, 180 = straight up. */
export function armAngle(shoulder, wrist) {
  const d = norm(sub(wrist, shoulder));
  return deg(Math.acos(clamp(d[1], -1, 1)));
}

/** Elbow bend in degrees: 0 = straight arm. */
export function elbowBend(shoulder, elbow, wrist) {
  const a = norm(sub(shoulder, elbow));
  const b = norm(sub(wrist, elbow));
  return 180 - deg(Math.acos(clamp(dot(a, b), -1, 1)));
}

/**
 * Wrist angles in the HackMotion-style convention.
 *  forearm : elbow -> wrist
 *  hand    : wrist -> middle knuckle (along the back of the hand)
 *  radial  : pinky knuckle -> index knuckle (across the hand, pointing to the thumb side)
 *  leftHand: true for an anatomical left hand
 * Returns { fe, dev } in degrees:
 *  fe  > 0 extension ("cupped"),  fe  < 0 flexion ("bowed")
 *  dev > 0 radial deviation ("hinged"/cocked toward thumb), dev < 0 ulnar deviation
 */
export function wristAngles(forearm, hand, radial, leftHand) {
  const f = norm(forearm);
  const h = norm(hand);
  const r = norm(radial);

  // Flexion/extension is rotation about the radial-ulnar axis r.
  const fp = norm(reject(f, r));
  const hp = norm(reject(h, r));
  const s = dot(cross(fp, hp), r);
  // Right hand: back of hand = hand x radial, so extension gives a negative s. Left hand is mirrored.
  const fe = deg(Math.atan2(leftHand ? s : -s, dot(fp, hp)));

  // Radial/ulnar deviation: how far the hand tilts toward the thumb side of the forearm.
  const rp = norm(reject(r, f));
  const dev = deg(Math.asin(clamp(dot(h, rp), -1, 1)));
  return { fe, dev };
}

/**
 * Builds the metrics for one arm from MediaPipe results.
 *  poseWorld: pose world landmarks (array of {x,y,z})
 *  side:      'L' | 'R' (anatomical side of the wrist we measure)
 *  handWorld: optional hand-landmarker world landmarks for that same hand (more precise)
 */
export function armMetrics(poseWorld, side, handWorld) {
  const P = POSE[side];
  const sh = v(poseWorld[P.shoulder]);
  const el = v(poseWorld[P.elbow]);
  const wr = v(poseWorld[P.wrist]);
  const forearm = sub(wr, el);

  let hand, radial, source;
  if (handWorld && handWorld.length >= 21) {
    const w = v(handWorld[HAND.wrist]);
    hand = sub(v(handWorld[HAND.middleMcp]), w);
    radial = sub(v(handWorld[HAND.indexMcp]), v(handWorld[HAND.pinkyMcp]));
    source = 'hand';
  } else {
    const ix = v(poseWorld[P.index]);
    const pk = v(poseWorld[P.pinky]);
    hand = sub(mid(ix, pk), wr);
    radial = sub(ix, pk);
    source = 'pose';
  }
  const { fe, dev } = wristAngles(forearm, hand, radial, side === 'L');
  return { fe, dev, arm: elbowBend(sh, el, wr), source };
}

/** Median of the finite numbers in xs (NaN if none). */
export function median(xs) {
  const a = xs.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
