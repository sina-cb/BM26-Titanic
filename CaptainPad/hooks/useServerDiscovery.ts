import { useState, useCallback, useRef } from 'react';
import * as Network from 'expo-network';

export interface DiscoveredServer {
  ip: string;
  url: string;
  name: string;
  service: string;
  activeModel: string;
  activePattern: string;
  activeScene: string;
  latencyMs: number;
}

export interface UseServerDiscoveryResult {
  servers: DiscoveredServer[];
  scanning: boolean;
  progress: number; // 0..1
  subnet: string | null;
  /** IP returned by the OS auto-detect (may differ from `subnet` if the
   *  operator manually picked a different prefix to scan). Useful for
   *  showing "detected: 169.254" hint next to a manually-overridden
   *  scan target. */
  autoDetectedIp: string | null;
  error: string | null;
  /** Scan a /24 subnet. If `subnetOverride` (e.g. "10.1.1") is given it
   *  takes precedence over OS auto-detection — required when iOS picks
   *  a link-local interface (169.254.x) instead of the real WiFi. */
  scan: (subnetOverride?: string | null) => void;
  cancel: () => void;
}

const SCAN_PORT = 6968;
const PROBE_TIMEOUT_MS = 600;
const BATCH_SIZE = 32;

/**
 * Derive the /24 subnet prefix from a local IP.
 * e.g. "10.1.1.42" → "10.1.1"
 */
function getSubnetPrefix(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.slice(0, 3).join('.');
}

/**
 * Validate a user-supplied subnet prefix string like "10.1.1".
 * Returns the normalized prefix (no trailing dot) or null if invalid.
 */
export function normalizeSubnetPrefix(input: string): string | null {
  const trimmed = (input || '').trim().replace(/\.+$/, '');
  if (!trimmed) return null;
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
  }
  return parts.join('.');
}

/**
 * Probe a single IP for a MarsinEngine /status endpoint.
 * Returns null if the IP doesn't respond or isn't a MarsinEngine.
 */
async function probeIp(ip: string): Promise<DiscoveredServer | null> {
  const url = `http://${ip}:${SCAN_PORT}`;
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${url}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const latencyMs = Date.now() - t0;

    // Only accept verified MarsinEngine instances
    if (data.service !== 'marsin-engine') return null;

    return {
      ip,
      url,
      name: data.name || 'MarsinEngine',
      service: data.service,
      activeModel: data.activeModel || '—',
      activePattern: data.activePattern || '—',
      activeScene: data.activeScene || '—',
      latencyMs,
    };
  } catch {
    return null;
  }
}

/**
 * React hook for discovering MarsinEngine instances on the local /24 subnet.
 * 
 * Usage:
 *   const { servers, scanning, progress, subnet, scan, error } = useServerDiscovery();
 *   // Call scan() to start; servers[] will populate as engines are found.
 */
export function useServerDiscovery(): UseServerDiscoveryResult {
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [subnet, setSubnet] = useState<string | null>(null);
  const [autoDetectedIp, setAutoDetectedIp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const scan = useCallback(async (subnetOverride?: string | null) => {
    if (scanning) return;

    setScanning(true);
    setServers([]);
    setProgress(0);
    setError(null);
    cancelledRef.current = false;

    try {
      // Always run OS auto-detect so the UI can show what iOS picked,
      // even when the operator is overriding it (which they typically
      // do when iOS chose a link-local interface).
      let detectedIp: string | null = null;
      try {
        detectedIp = await Network.getIpAddressAsync();
        if (detectedIp === '0.0.0.0') detectedIp = null;
        setAutoDetectedIp(detectedIp);
      } catch {
        setAutoDetectedIp(null);
      }

      // Resolve the prefix to scan: override wins; fall back to detected.
      let prefix: string | null = null;
      const override = normalizeSubnetPrefix(subnetOverride || '');
      if (override) {
        prefix = override;
      } else if (detectedIp) {
        prefix = getSubnetPrefix(detectedIp);
      }

      if (!prefix) {
        setError(
          detectedIp
            ? `Could not derive /24 subnet from IP ${detectedIp}. Enter the subnet manually (e.g. "10.1.1").`
            : 'Could not determine device IP. Enter the subnet manually (e.g. "10.1.1").',
        );
        setScanning(false);
        return;
      }

      setSubnet(prefix);

      // 2. Build candidate IPs (1..254)
      const candidates: string[] = [];
      for (let i = 1; i <= 254; i++) {
        candidates.push(`${prefix}.${i}`);
      }

      // 3. Probe in batches
      let completed = 0;
      for (let batchStart = 0; batchStart < candidates.length; batchStart += BATCH_SIZE) {
        if (cancelledRef.current) break;

        const batch = candidates.slice(batchStart, batchStart + BATCH_SIZE);
        const results = await Promise.all(batch.map(probeIp));

        completed += batch.length;
        setProgress(completed / candidates.length);

        // Add any discovered servers
        const found = results.filter((r): r is DiscoveredServer => r !== null);
        if (found.length > 0) {
          setServers(prev => {
            // Deduplicate by IP
            const existing = new Set(prev.map(s => s.ip));
            const newServers = found.filter(s => !existing.has(s.ip));
            return [...prev, ...newServers];
          });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Scan failed');
    } finally {
      setScanning(false);
      setProgress(1);
    }
  }, [scanning]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return { servers, scanning, progress, subnet, autoDetectedIp, error, scan, cancel };
}
