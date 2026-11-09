// Beeps and voice. Web Audio must be unlocked from a user tap (iOS), so call unlock() from a click handler.

export class Sound {
  constructor(settings) {
    this.s = settings;
    this.ctx = null;
    this.lastBeep = 0;
  }

  unlock() {
    try {
      // iOS 16.4+: play even when the ringer switch is on silent.
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* not supported */ }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // A silent blip finishes the unlock on older iOS.
    this.tone(440, 0.01, 'sine', 0);
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  }

  tone(freq, dur, type = 'sine', gain = 1, at = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const vol = gain * (this.s.sound.volume ?? 0.8) * 0.5;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /**
   * Fault sound for a metric. dir: +1 too high (cupped / too hinged / bent), -1 too low (bowed / under-hinged).
   * Wrist flex/ext uses sine, hinge uses square, arm bend uses triangle so they are distinguishable by ear.
   */
  fault(metric = 'fe', dir = 1) {
    if (!this.s.sound.enabled) return;
    const type = metric === 'fe' ? 'sine' : metric === 'dev' ? 'square' : 'triangle';
    const gain = type === 'square' ? 0.45 : 1;
    if (!this.s.sound.directional) { this.tone(900, 0.12, type, gain); return; }
    if (dir > 0) { this.tone(1320, 0.07, type, gain); this.tone(1320, 0.07, type, gain, 0.1); }
    else this.tone(520, 0.2, type, gain);
  }

  good() {
    if (!this.s.sound.enabled) return;
    this.tone(880, 0.07, 'sine', 0.6);
    this.tone(1175, 0.09, 'sine', 0.6, 0.07);
  }

  /** Rate-limited version for continuous drill feedback. */
  repeat(fn) {
    const now = performance.now();
    if (now - this.lastBeep < (this.s.sound.repeatMs ?? 400)) return;
    this.lastBeep = now;
    fn();
  }

  say(text, interrupt = false) {
    if (!this.s.sound.enabled || !('speechSynthesis' in window)) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.1;
    u.volume = this.s.sound.volume ?? 0.8;
    speechSynthesis.speak(u);
  }
}
