// Swing phase state machine. Pure: feed it frames, it calls back at each P-position.
//
// A frame is { t (seconds), armAngle (deg, lead arm from straight down), speed (shoulder-widths/s), metrics: {fe, dev, arm} }.
// Positions come from the lead arm angle, since the club itself is not tracked:
//   P1 address: arm low and still · P2/P3: arm angle crosses thresholds going up · P4: arm angle peaks
//   P5/P6: crosses back down · P7: arm angle bottoms out · P8: rises past P2 again · P10: hands still again.

import { median } from './wrist-math.js?v=c832d20';

export class SwingDetector {
  constructor(cfg, handlers = {}) {
    this.cfg = cfg;
    this.on = handlers;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.buf = [];
    this.stillSince = null;
    this.hits = {};
    this.ext = null; // extreme (max/min) frame being tracked
    this.tState = 0;
    this.addressFrame = null;
  }

  setPhase(state, t) {
    this.state = state;
    this.tState = t;
    this.on.phase?.(state);
  }

  /** Metrics at a frame, taken as the median of it and its neighbours to reject single-frame glitches. */
  metricsAt(frame) {
    const i = this.buf.indexOf(frame);
    const around = this.buf.slice(Math.max(0, i - 1), i + 2);
    const out = {};
    for (const k of ['fe', 'dev', 'arm']) out[k] = median(around.map((f) => f.metrics?.[k]));
    return out;
  }

  hit(id, frame) {
    if (this.hits[id]) return;
    this.hits[id] = frame;
    this.on.checkpoint?.(id, frame, this.metricsAt(frame));
  }

  finish(frame) {
    this.hit('P10', frame);
    const hits = this.hits;
    this.on.swingEnd?.(hits);
    this.reset();
    this.state = 'cooldown';
    this.tState = frame.t;
    this.on.phase?.('cooldown');
  }

  update(f) {
    const c = this.cfg;
    this.buf.push(f);
    if (this.buf.length > 240) this.buf.shift();
    const a = f.armAngle;
    if (!Number.isFinite(a)) return;

    const still = f.speed < c.stillSpeed;
    this.stillSince = still ? (this.stillSince ?? f.t) : null;
    const stillFor = this.stillSince == null ? 0 : f.t - this.stillSince;

    switch (this.state) {
      case 'cooldown':
        if (f.t - this.tState > 1.0) this.setPhase('idle', f.t);
        break;

      case 'idle':
        if (a < c.addressMaxArm && stillFor >= c.addressHold) {
          this.addressFrame = f;
          this.setPhase('address', f.t);
        }
        break;

      case 'address':
        if (still && a < c.addressMaxArm) this.addressFrame = f; // keep the latest still frame
        if (a > c.addressMaxArm || a > this.addressFrame.armAngle + 15) {
          this.hit('P1', this.addressFrame);
          this.ext = f;
          this.setPhase('backswing', f.t);
        }
        break;

      case 'backswing':
        if (a >= c.p2Arm) this.hit('P2', f);
        if (a >= c.p3Arm) this.hit('P3', f);
        if (a > this.ext.armAngle) this.ext = f;
        if (a < this.ext.armAngle - c.topDrop) {
          if (this.ext.armAngle >= c.p3Arm * 0.85) {
            this.hit('P4', this.ext);
            this.ext = f;
            this.setPhase('downswing', f.t);
          } else if (a < c.addressMaxArm) {
            // waggle or aborted takeaway: back to address
            this.hits = {};
            this.addressFrame = f;
            this.setPhase('address', f.t);
          }
        }
        break;

      case 'downswing':
        if (a <= c.p3Arm) this.hit('P5', f);
        if (a <= c.p2Arm) this.hit('P6', f);
        if (a < this.ext.armAngle) this.ext = f;
        if ((this.hits.P6 && a > this.ext.armAngle + c.impactRise) || f.t - this.tState > 1.5) {
          this.hit('P7', this.ext);
          this.setPhase('through', f.t);
        }
        break;

      case 'through':
        if (a >= c.p2Arm) this.hit('P8', f);
        if ((still && stillFor >= 0.3 && f.t - this.tState > 0.4) || f.t - this.tState > 2.5) this.finish(f);
        break;
    }
  }
}
