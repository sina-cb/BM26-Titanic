export interface TraceAdvance {
  steps: number;
  remainder: number;
}

export function advanceTraceClock(
  accumulator: number,
  elapsedSeconds: number,
  advanceHz: number,
): TraceAdvance {
  if (!Number.isFinite(accumulator) || accumulator < 0 || accumulator >= 1) {
    throw new Error('trace accumulator must be in [0, 1)');
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new Error('trace elapsedSeconds must be finite and non-negative');
  }
  if (!Number.isFinite(advanceHz) || advanceHz <= 0) {
    throw new Error('trace advanceHz must be finite and positive');
  }
  const total = accumulator + elapsedSeconds * advanceHz;
  const steps = Math.floor(total);
  return { steps, remainder: total - steps };
}
