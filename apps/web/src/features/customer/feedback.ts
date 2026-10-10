/** Short audible + haptic scan feedback (no external assets). */
let ctx: AudioContext | null = null;

export function scanFeedback(kind: "ok" | "warn" | "error") {
  try {
    navigator.vibrate?.(kind === "ok" ? 40 : [60, 40, 60]);
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === "ok" ? 1240 : kind === "warn" ? 660 : 320;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    /* feedback is best-effort */
  }
}
