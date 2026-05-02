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
  error: string | null;
  scan: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const scan = useCallback(async () => {
    if (scanning) return;

    setScanning(true);
    setServers([]);
    setProgress(0);
    setError(null);
    cancelledRef.current = false;

    try {
      // 1. Get local IP
      const ipAddress = await Network.getIpAddressAsync();
      if (!ipAddress || ipAddress === '0.0.0.0') {
        setError('Could not determine device IP. Are you connected to WiFi?');
        setScanning(false);
        return;
      }

      const prefix = getSubnetPrefix(ipAddress);
      if (!prefix) {
        setError(`Invalid IP format: ${ipAddress}`);
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

  return { servers, scanning, progress, subnet, error, scan, cancel };
}
