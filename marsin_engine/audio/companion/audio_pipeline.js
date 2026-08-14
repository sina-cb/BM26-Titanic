export const RAW_MIRROR_SOURCES = Object.freeze([
  Object.freeze({ key: 'micLowRaw', analyzerField: 'low' }),
  Object.freeze({ key: 'micMidRaw', analyzerField: 'mid' }),
  Object.freeze({ key: 'micHighRaw', analyzerField: 'high' }),
  Object.freeze({ key: 'micKickRaw', analyzerField: 'kick' }),
  Object.freeze({ key: 'micFluxRaw', analyzerField: 'flux' }),
  Object.freeze({ key: 'micDomFreq1', analyzerField: 'domFreq1' }),
  Object.freeze({ key: 'micDomEnergy1', analyzerField: 'domEnergy1' }),
  Object.freeze({ key: 'micDomFreq2', analyzerField: 'domFreq2' }),
  Object.freeze({ key: 'micDomEnergy2', analyzerField: 'domEnergy2' }),
  Object.freeze({ key: 'micOnsetLowRaw', analyzerField: 'onsetLow' }),
  Object.freeze({ key: 'micOnsetMidRaw', analyzerField: 'onsetMid' }),
  Object.freeze({ key: 'micOnsetHighRaw', analyzerField: 'onsetHigh' }),
  Object.freeze({ key: 'micSubRaw', analyzerField: 'micSub' }),
  Object.freeze({ key: 'micTonalStabilityRaw', analyzerField: 'tonalStability' }),
  Object.freeze({ key: 'micChromaFluxRaw', analyzerField: 'chromaFlux' }),
  Object.freeze({ key: 'micChromaTiltRaw', analyzerField: 'chromaTilt' }),
]);

/** Build the exact raw-CPC write bundle used by the production Companion. */
export function buildRawMirrorWrites(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    throw new TypeError('buildRawMirrorWrites: analysis must be an object');
  }
  return RAW_MIRROR_SOURCES.map(({ key, analyzerField }) => {
    const value = analysis[analyzerField];
    if (!Number.isFinite(value)) {
      throw new TypeError(`buildRawMirrorWrites: analyzer field "${analyzerField}" is not finite`);
    }
    return { kind: 'scalar', key, value };
  });
}
