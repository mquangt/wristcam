// MediaPipe wrapper: full-body pose every frame, plus an optional hand-landmark pass on a crop
// around the measured wrist (hands are tiny in a full-body shot, so cropping helps a lot).

import { POSE } from './wrist-math.js?v=c832d20';

const VER = '0.10.14';
const BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODELS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const CROP = 256;

let lib = null;
let fileset = null;

async function create(Cls, options) {
  try {
    return await Cls.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } });
  } catch (e) {
    console.warn('GPU delegate failed, using CPU', e);
    return await Cls.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
  }
}

export async function createTracker({ model = 'full', hands = true, onStatus = () => {} } = {}) {
  if (!lib) {
    onStatus('Loading vision library…');
    lib = await import(`${BASE}/vision_bundle.mjs`);
    fileset = await lib.FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  }
  onStatus(`Loading body model (${model})…`);
  const pose = await create(lib.PoseLandmarker, {
    baseOptions: { modelAssetPath: MODELS[model] || MODELS.full },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  let hand = null;
  if (hands) {
    onStatus('Loading hand model…');
    hand = await create(lib.HandLandmarker, {
      baseOptions: { modelAssetPath: HAND_MODEL },
      runningMode: 'IMAGE', numHands: 2,
      minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35,
    });
  }
  const crop = document.createElement('canvas');
  crop.width = crop.height = CROP;
  const cctx = crop.getContext('2d', { willReadFrequently: false });
  let lastTs = 0;

  /**
   * source: <video>. side: 'L' | 'R' wrist to refine with the hand model.
   * Returns { lm, world, hand: { lm (image-normalised), world } | null } or null when no person.
   */
  function detect(source, nowMs, side) {
    const ts = Math.max(Math.round(nowMs), lastTs + 1);
    lastTs = ts;
    const r = pose.detectForVideo(source, ts);
    const lm = r.landmarks?.[0];
    const world = r.worldLandmarks?.[0];
    if (!lm || !world) return null;
    const out = { lm, world, hand: null };
    if (!hand) return out;

    const W = source.videoWidth, H = source.videoHeight;
    const P = POSE[side];
    const wr = lm[P.wrist], el = lm[P.elbow];
    const forearmPx = Math.hypot((wr.x - el.x) * W, (wr.y - el.y) * H);
    const size = Math.max(96, forearmPx * 1.6);
    // centre a little past the wrist, toward the hand
    const cx = wr.x * W + (wr.x - el.x) * W * 0.25;
    const cy = wr.y * H + (wr.y - el.y) * H * 0.25;
    const x0 = cx - size / 2, y0 = cy - size / 2;
    cctx.clearRect(0, 0, CROP, CROP);
    cctx.drawImage(source, x0, y0, size, size, 0, 0, CROP, CROP);
    const hr = hand.detect(crop);
    let best = null, bestD = Infinity;
    (hr.landmarks || []).forEach((hl, i) => {
      const hx = x0 + hl[0].x * size, hy = y0 + hl[0].y * size;
      const d = Math.hypot(hx - wr.x * W, hy - wr.y * H);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best != null && bestD < size * 0.45) {
      out.hand = {
        lm: hr.landmarks[best].map((p) => ({ x: (x0 + p.x * size) / W, y: (y0 + p.y * size) / H, z: p.z })),
        world: hr.worldLandmarks[best],
      };
    }
    return out;
  }

  return {
    detect,
    hasHands: !!hand,
    close() { pose.close(); hand?.close(); },
  };
}
