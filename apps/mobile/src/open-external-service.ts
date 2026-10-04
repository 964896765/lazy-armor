import { Linking } from 'react-native';
import { openDeviceApp } from './device-app-bridge';
import type { ExternalService } from './external-services';
export async function openExternalService(item: ExternalService) { if (item.packageName) { if (!await openDeviceApp(item.packageName)) throw new Error('无法打开应用，请确认应用仍已安装'); return; } const url = new URL(item.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('服务地址无效'); await Linking.openURL(url.href); }
