/**
 * bench_mirror_boot_policy.js — decide whether a freshly opened sim tab should
 * leave an already-armed bench mirror alone.
 *
 * Bench mirror arming is process memory on the sACN bridge and is normally
 * socket-scoped to the window that armed it. In practice the operator can still
 * land on the canonical default URL while the bridge reports ACTIVE:
 *
 *   - another sim tab armed the mirror and is still connected;
 *   - a reload/disconnect race where status-on-connect arrives before the prior
 *     socket's disconnect disarm finishes;
 *   - a long-lived bridge session the operator forgot to disarm.
 *
 * The canonical default URL means "show Titanic in 2D pixels on sACN IN with
 * no bench stand-in". Unless the URL explicitly requests bench mode
 * (`?bench_mirror=…`), the first armed status on this connection triggers a
 * client-side DISARM so ship output is not suspended by stale mirror state.
 *
 * Explicit bench mode is fail-safe: the param does NOT auto-arm anything — the
 * operator still picks sources and presses ARM — but it DOES suppress the
 * stale-state disarm so an intentional bench session survives reloads.
 */

const EXPLICIT_BENCH_MIRROR_VALUES = new Set(['1', 'true', 'yes', 'armed', 'on']);

/**
 * Did the URL explicitly opt into bench-mirror mode?
 *
 * @param {URLSearchParams} urlParams
 * @returns {boolean}
 */
export function explicitBenchMirrorRequested(urlParams) {
  if (!(urlParams instanceof URLSearchParams) || !urlParams.has('bench_mirror')) {
    return false;
  }
  const raw = String(urlParams.get('bench_mirror')).trim().toLowerCase();
  if (raw === '' || raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  if (!EXPLICIT_BENCH_MIRROR_VALUES.has(raw)) {
    console.error(
      `[bench_mirror_boot_policy] Ignoring invalid ?bench_mirror='${urlParams.get('bench_mirror')}' ` +
      `(valid explicit values: ${[...EXPLICIT_BENCH_MIRROR_VALUES].join(', ')}). ` +
      'Treating as absent — a stale armed mirror will be disarmed on this boot.',
    );
    return false;
  }
  return true;
}

/**
 * Should this boot connection disarm an armed mirror reported by the bridge?
 *
 * @param {URLSearchParams} urlParams
 * @returns {boolean}
 */
export function shouldAutoDisarmStaleBenchMirror(urlParams) {
  return !explicitBenchMirrorRequested(urlParams);
}
