/**
 * Retro Arcade Web Audio API Sound Synthesizer (Block Blast)
 * Generates 8-bit arcade sound effects dynamically without external audio assets.
 */

class RetroAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    // Load mute preference
    try {
      const saved = localStorage.getItem('retro_bb_muted');
      if (saved !== null) {
        this.isMuted = saved === 'true';
      }
    } catch (e) { /* storage unavailable */ }
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    try {
      localStorage.setItem('retro_bb_muted', this.isMuted);
    } catch (e) { /* storage unavailable */ }
    return this.isMuted;
  }

  // Returns true when sound can be played right now
  _ready() {
    if (this.isMuted) return false;
    this.init();
    return !!this.ctx;
  }

  // Single oscillator note with optional pitch slide and exponential decay
  _tone({ type = 'square', f0, f1 = null, start = 0, dur = 0.1, vol = 0.12 }) {
    const now = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, now + dur * 0.8);

    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + dur);
  }

  // Picking up a piece from the tray
  playPick() {
    if (!this._ready()) return;
    this._tone({ type: 'sine', f0: 500, f1: 800, dur: 0.06, vol: 0.1 });
  }

  // Placing a piece on the board
  playPlace() {
    if (!this._ready()) return;
    this._tone({ type: 'square', f0: 330, f1: 220, dur: 0.09, vol: 0.14 });
    this._tone({ type: 'triangle', f0: 165, f1: 110, dur: 0.12, vol: 0.16 });
  }

  // Invalid drop buzzer
  playInvalid() {
    if (!this._ready()) return;
    this._tone({ type: 'sawtooth', f0: 140, dur: 0.07, vol: 0.2 });
    this._tone({ type: 'sawtooth', f0: 110, start: 0.07, dur: 0.1, vol: 0.2 });
  }

  // Line clear: rising pentatonic run, longer with more lines and higher with combo
  playClear(lines, combo) {
    if (!this._ready()) return;
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98];
    const count = Math.min(scale.length, 3 + lines * 2);
    const shift = Math.pow(2, Math.min(Math.max(combo - 1, 0), 6) / 12);
    for (let i = 0; i < count; i++) {
      this._tone({ type: 'square', f0: scale[i] * shift, start: i * 0.05, dur: 0.1, vol: 0.12 });
    }
    // Low boom under the run
    this._tone({ type: 'triangle', f0: 120, f1: 50, dur: 0.25, vol: 0.2 });
  }

  // Perfect clear / new record fanfare
  playRecord() {
    if (!this._ready()) return;
    const melody = [
      { f: 523.25, d: 0.1 },   // C5
      { f: 659.25, d: 0.1 },   // E5
      { f: 783.99, d: 0.1 },   // G5
      { f: 1046.5, d: 0.18 },  // C6
      { f: 880.0, d: 0.1 },    // A5
      { f: 1046.5, d: 0.35 }   // C6
    ];
    let time = 0;
    melody.forEach((note) => {
      this._tone({ type: 'square', f0: note.f, start: time, dur: note.d, vol: 0.18 });
      time += note.d * 1.05;
    });
  }

  // Game over sad tone
  playGameOver() {
    if (!this._ready()) return;
    const notes = [440, 415.3, 392, 349.23, 311.13, 261.63];
    notes.forEach((freq, idx) => {
      this._tone({ type: 'sawtooth', f0: freq, start: idx * 0.13, dur: 0.18, vol: 0.15 });
    });
  }

  // Button click / UI select sound
  playClick() {
    if (!this._ready()) return;
    this._tone({ type: 'sine', f0: 800, f1: 400, dur: 0.04, vol: 0.1 });
  }
}

window.retroAudio = new RetroAudio();
