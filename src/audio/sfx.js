/**
 * 音效系统 —— WebAudio 实时合成的 8-bit 方波/三角波，无外部音频文件。
 */

const STORAGE_KEY = 'fc-monopoly.sound';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch { /* 隐私模式 */ }
    this.unlocked = false;
  }

  /** 首次用户交互时解锁音频上下文 */
  unlock() {
    if (this.unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch { /* ignore */ }
    if (on) this.unlock();
  }

  /** 播放音符序列 */
  play(notes) {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    let t = this.ctx.currentTime;
    for (const n of notes) {
      const dur = (n.dur || 0.1) * 0.85;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = n.type || 'square';
      osc.frequency.setValueAtTime(n.freq, t);
      if (n.to) osc.frequency.linearRampToValueAtTime(n.to, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(n.vol || 0.3, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += (n.delay || 0) + dur;
    }
  }

  /** 音阶表 */
  static get SCALE() {
    return {
      C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
      C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
      C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1567.98,
      C3: 130.81, E3: 164.81, G3: 196.00, A2: 110.00, F2: 87.31,
    };
  }

  diceRoll() {
    this.play([
      { freq: 400, dur: 0.05, type: 'square', to: 600 },
      { freq: 600, dur: 0.05, type: 'square', to: 300, delay: 0.05 },
      { freq: 300, dur: 0.05, type: 'square', to: 800, delay: 0.05 },
    ]);
  }

  diceLand() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.A4, dur: 0.06, type: 'square' },
      { freq: S.E5, dur: 0.08, type: 'square', delay: 0.06 },
      { freq: S.C6, dur: 0.12, type: 'square', delay: 0.12 },
    ]);
  }

  step() {
    this.play([{ freq: 220, dur: 0.03, type: 'triangle', vol: 0.15 }]);
  }

  buy() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.C5, dur: 0.07, type: 'square' },
      { freq: S.E5, dur: 0.07, type: 'square', delay: 0.07 },
      { freq: S.G5, dur: 0.07, type: 'square', delay: 0.14 },
      { freq: S.C6, dur: 0.16, type: 'square', delay: 0.21 },
    ]);
  }

  upgrade() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.C4, dur: 0.06, type: 'square' },
      { freq: S.G4, dur: 0.06, type: 'square', delay: 0.06 },
      { freq: S.C5, dur: 0.06, type: 'square', delay: 0.12 },
      { freq: S.E5, dur: 0.06, type: 'square', delay: 0.18 },
      { freq: S.G5, dur: 0.06, type: 'square', delay: 0.24 },
      { freq: S.C6, dur: 0.18, type: 'square', delay: 0.30 },
    ]);
  }

  payRent() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.A4, dur: 0.07, type: 'square' },
      { freq: S.F4, dur: 0.07, type: 'square', delay: 0.07 },
      { freq: S.D4, dur: 0.14, type: 'square', delay: 0.14 },
    ]);
  }

  win() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.C5, dur: 0.09, type: 'square' },
      { freq: S.E5, dur: 0.09, type: 'square', delay: 0.09 },
      { freq: S.G5, dur: 0.09, type: 'square', delay: 0.18 },
      { freq: S.C6, dur: 0.09, type: 'square', delay: 0.27 },
      { freq: S.G5, dur: 0.09, type: 'square', delay: 0.36 },
      { freq: S.C6, dur: 0.24, type: 'square', delay: 0.45 },
    ]);
  }

  bankrupt() {
    this.play([
      { freq: 300, dur: 0.12, type: 'triangle', to: 200 },
      { freq: 200, dur: 0.12, type: 'triangle', to: 140, delay: 0.12 },
      { freq: 140, dur: 0.14, type: 'triangle', to: 90, delay: 0.24 },
      { freq: 90, dur: 0.3, type: 'triangle', delay: 0.38 },
    ]);
  }

  click() {
    this.play([{ freq: 880, dur: 0.03, type: 'square', vol: 0.18 }]);
  }

  deny() {
    this.play([
      { freq: 200, dur: 0.08, type: 'square' },
      { freq: 150, dur: 0.1, type: 'square', delay: 0.08 },
    ]);
  }

  cardFlip() {
    this.play([
      { freq: 600, dur: 0.04, type: 'square', to: 1200 },
      { freq: 1200, dur: 0.05, type: 'square', to: 700, delay: 0.04 },
    ]);
  }

  marketBull() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.C5, dur: 0.06, type: 'square' },
      { freq: S.D5, dur: 0.06, type: 'square', delay: 0.06 },
      { freq: S.E5, dur: 0.06, type: 'square', delay: 0.12 },
      { freq: S.G5, dur: 0.14, type: 'square', delay: 0.18 },
    ]);
  }

  marketBear() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.G5, dur: 0.06, type: 'square' },
      { freq: S.E5, dur: 0.06, type: 'square', delay: 0.06 },
      { freq: S.D5, dur: 0.06, type: 'square', delay: 0.12 },
      { freq: S.C5, dur: 0.16, type: 'square', delay: 0.18 },
    ]);
  }

  teleport() {
    this.play([
      { freq: 300, dur: 0.05, type: 'triangle', to: 1400 },
      { freq: 1400, dur: 0.06, type: 'triangle', to: 400, delay: 0.05 },
    ]);
  }

  startTurn() {
    const S = Sfx.SCALE;
    this.play([
      { freq: S.E5, dur: 0.05, type: 'square', vol: 0.18 },
      { freq: S.A5, dur: 0.07, type: 'square', vol: 0.18, delay: 0.05 },
    ]);
  }
}
