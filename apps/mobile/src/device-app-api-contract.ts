import { supportedDeviceApp, type DeviceAppConnectionMode } from '@lazy-armor/shared';

export interface DeviceAppConnectionRequest {
  deviceId: string;
  packageName: string;
  modes: DeviceAppConnectionMode[];
}

export function createDeviceAppConnectionRequest(deviceId: string, packageName: string, modes: readonly DeviceAppConnectionMode[]): DeviceAppConnectionRequest | null {
  const app = supportedDeviceApp(packageName);
  if (!app || !deviceId.trim()) return null;
  const allowed = new Set(app.capabilities.filter((capability) => capability.availability === 'available').map((capability) => capability.mode));
  const uniqueModes = [...new Set(modes)].filter((mode): mode is DeviceAppConnectionMode => allowed.has(mode));
  if (uniqueModes.length === 0) return null;
  return { deviceId: deviceId.trim(), packageName: app.packageName, modes: uniqueModes };
}
