let gaps: number[] = [];
let last = 0;
let handle = 0;

export function resetFrameGaps() {
  gaps = [];
  last = 0;
}

export function maxFrameGap() {
  return gaps.reduce((max, gap) => Math.max(max, gap), 0);
}

export function sampleFrameGaps() {
  resetFrameGaps();
  const tick = (time: number) => {
    if (last) gaps.push(time - last);
    last = time;
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(handle);
}
