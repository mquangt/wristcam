// Draws the tracked body/hand on a canvas whose pixel size matches the video frame.

import { POSE } from './wrist-math.js';

const BODY = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [24, 26], [25, 27], [26, 28]];
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

export const COLORS = { ok: '#3ddc84', bad: '#ff4d4f', idle: '#ffd666', line: 'rgba(255,255,255,0.75)' };

export function drawFrame(ctx, det, side, status = 'idle', W, H) {
  const lw = Math.max(2, W / 320);
  if (!det) return;
  const { lm, hand } = det;
  const pt = (p) => [p.x * W, p.y * H];

  ctx.lineCap = 'round';
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (const [a, b] of BODY) {
    if ((lm[a].visibility ?? 1) < 0.3 || (lm[b].visibility ?? 1) < 0.3) continue;
    ctx.moveTo(...pt(lm[a]));
    ctx.lineTo(...pt(lm[b]));
  }
  ctx.stroke();

  const P = POSE[side];
  const col = COLORS[status] || COLORS.idle;
  ctx.strokeStyle = col;
  ctx.lineWidth = lw * 2.2;
  ctx.beginPath();
  ctx.moveTo(...pt(lm[P.shoulder]));
  ctx.lineTo(...pt(lm[P.elbow]));
  ctx.lineTo(...pt(lm[P.wrist]));
  ctx.stroke();

  if (hand) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (const [a, b] of HAND_LINKS) {
      ctx.moveTo(...pt(hand.lm[a]));
      ctx.lineTo(...pt(hand.lm[b]));
    }
    ctx.stroke();
  } else {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw * 1.5;
    ctx.beginPath();
    ctx.moveTo(...pt(lm[P.wrist])); ctx.lineTo(...pt(lm[P.index]));
    ctx.moveTo(...pt(lm[P.wrist])); ctx.lineTo(...pt(lm[P.pinky]));
    ctx.stroke();
  }
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(...pt(lm[P.wrist]), lw * 3.5, 0, Math.PI * 2);
  ctx.fill();
}
