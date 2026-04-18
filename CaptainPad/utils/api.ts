// Use your machine's local IP address when testing on a physical iPad (e.g., '192.168.1.100').
// Use 'localhost' or '10.0.2.2' if testing on iOS simulator / Android emulator.
export const API_BASE = 'http://10.1.1.172:6968';

export async function sendControl(id: number, v0: number, v1?: number, v2?: number) {
  try {
    const payload: any = { id, v0 };
    if (v1 !== undefined) payload.v1 = v1;
    if (v2 !== undefined) payload.v2 = v2;

    const res = await fetch(`${API_BASE}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  } catch (err) {
    console.warn('Control request failed:', err);
  }
}

export async function fetchPatterns() {
  try {
    const res = await fetch(`${API_BASE}/list-patterns`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('Fetch patterns failed:', err);
    return [];
  }
}

export async function setActivePattern(pattern: string) {
  try {
    const res = await fetch(`${API_BASE}/set-pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern }),
    });
    return res.json();
  } catch (err) {
    console.warn('Set active pattern failed:', err);
  }
}

export async function fetchPatternCode(name: string) {
  try {
    const res = await fetch(`${API_BASE}/pattern-code?name=${name}`);
    const text = await res.text();
    return text;
  } catch (err) {
    console.warn('Fetch pattern code failed:', err);
    return null;
  }
}

export async function savePatternCode(name: string, code: string) {
  try {
    const res = await fetch(`${API_BASE}/save-pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code }),
    });
    return res.json();
  } catch (err) {
    console.warn('Save pattern failed:', err);
  }
}
