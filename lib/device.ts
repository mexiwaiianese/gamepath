/** This phone's chosen job on the team network. Stored only on this device. */

export const DEVICE_STORAGE_KEY = 'gamepath-device-v1';

export type DeviceRole = 'stat' | 'coach' | 'camera';

export type DeviceSession = {
  id: string;
  role: DeviceRole;
  label: string;
  matchId: string;
  token: string;
  cameraId?: string;
};

export function createDeviceId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function loadDevice(): DeviceSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY) ?? '') as DeviceSession;
    if (!parsed?.id || !parsed.matchId || !parsed.token) return null;
    if (parsed.role !== 'stat' && parsed.role !== 'coach' && parsed.role !== 'camera') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDevice(session: DeviceSession) {
  localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(session));
}
