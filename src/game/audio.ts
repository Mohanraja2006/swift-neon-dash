let ctx: AudioContext | null = null;

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  gain = 0.05,
  slideTo?: number,
) {
  const a = ac();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  osc.connect(g).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + dur + 0.02);
}

export const sfx = {
  jump: () => tone(320, 0.16, "square", 0.04, 720),
  coin: () => tone(880, 0.12, "triangle", 0.05, 1400),
  hit: () => tone(220, 0.5, "sawtooth", 0.07, 60),
  ui: () => tone(520, 0.08, "sine", 0.04, 660),
  unlock: () => {
    tone(660, 0.12, "triangle", 0.05, 990);
    setTimeout(() => tone(990, 0.2, "triangle", 0.05, 1320), 110);
  },
};
