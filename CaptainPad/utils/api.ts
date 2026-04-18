import AsyncStorage from '@react-native-async-storage/async-storage';
const defaultConfigsRaw: any = require('@/configs.yaml');
const defaultConfigs = defaultConfigsRaw?.default || defaultConfigsRaw || {};

let api_base = defaultConfigs.api_base || 'http://10.1.1.172:6968';

// Background bootloader for async store check
AsyncStorage.getItem('API_BASE').then(val => {
  if (val) api_base = val;
});

export function getApiBase() {
  return api_base;
}

export async function setApiBase(val: string) {
  api_base = val;
  if (val === defaultConfigs.api_base) {
    await AsyncStorage.removeItem('API_BASE');
  } else {
    await AsyncStorage.setItem('API_BASE', val);
  }
}

export async function sendControl(id: number, v0: number, v1?: number, v2?: number) {
  try {
    const payload: any = { id, v0 };
    if (v1 !== undefined) payload.v1 = v1;
    if (v2 !== undefined) payload.v2 = v2;

    const res = await fetch(`${getApiBase()}/control`, {
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
    const res = await fetch(`${getApiBase()}/list-patterns`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('Fetch patterns failed:', err);
    return [];
  }
}

export async function setActivePattern(pattern: string) {
  try {
    const res = await fetch(`${getApiBase()}/set-pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern }),
    });
    return res.json();
  } catch (err) {
    console.warn('Set active pattern failed:', err);
  }
}

export async function fetchExports() {
  try {
    const res = await fetch(`${getApiBase()}/exports`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('Fetch exports failed:', err);
    return [];
  }
}

export async function setSectionBrightness(sectionId: number, brightness: number) {
  try {
    const res = await fetch(`${getApiBase()}/section-brightness`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId, brightness }),
    });
    return res.json();
  } catch(err) {
    console.warn(`Failed to set section ${sectionId} brightness:`, err);
  }
}

export async function fetchDimmers() {
  try {
    const res = await fetch(`${getApiBase()}/dimmers`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('Fetch dimmers failed:', err);
    return {};
  }
}

export async function setGlobalBlackout(state: boolean) {
  try {
    const res = await fetch(`${getApiBase()}/global-blackout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    return res.json();
  } catch(err) {
    console.warn(`Failed to set global blackout:`, err);
  }
}

export async function setGlobalEffect(effect: string, state: boolean) {
  try {
    const res = await fetch(`${getApiBase()}/global-effect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effect, state }),
    });
    if (!res.ok) {
      console.warn(`Endpoint global-effect returned ${res.status}`);
      return;
    }
    return res.json();
  } catch(err) {
    console.warn(`Failed to set global effect ${effect}:`, err);
  }
}

export async function fetchPatternCode(name: string) {
  try {
    const res = await fetch(`${getApiBase()}/pattern-code?name=${name}`);
    const text = await res.text();
    return text;
  } catch (err) {
    console.warn('Fetch pattern code failed:', err);
    return null;
  }
}

export async function savePatternCode(name: string, code: string) {
  try {
    const res = await fetch(`${getApiBase()}/save-pattern`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code }),
    });
    return res.json();
  } catch (err) {
    console.warn('Save pattern failed:', err);
  }
}
