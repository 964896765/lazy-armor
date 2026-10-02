import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuthStore } from '../src/auth-store';
import { connectionStartRequest } from '../src/connection-api-contract';
import { createDeviceAppConnectionRequest } from '../src/device-app-api-contract';
import { discoverLaunchableApps, type DiscoveredDeviceApp } from '../src/device-app-bridge';
import { deviceInstallationId } from '../src/device-installation-id';
import { deviceBoundApi, ensureTrustedDevice } from '../src/trusted-device-api';

WebBrowser.maybeCompleteAuthSession();

type Step = 'connections' | 'authorization' | 'notifications';
interface Connector { key: string; name: string; description: string; productionStatus: string; connectable: boolean; draftOnly: boolean; authentication: { type: string } }
interface OAuthStartResult { providerKey: string; authorizationUrl: string; expiresAt: string }
interface DeviceConnection { id: string; packageName: string; displayName: string }

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default function OnboardingPage() {
  const params = useLocalSearchParams<{ step?: string | string[] }>();
  const initial = first(params.step);
  const [step, setStep] = useState<Step>(initial === 'notifications' ? 'notifications' : 'connections');
  const [selectedApp, setSelectedApp] = useState<DiscoveredDeviceApp | null>(null);
  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null);
  const token = useAuthStore((state) => state.token);
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const client = useQueryClient();
  const connectors = useQuery({ queryKey: ['onboarding-connectors'], queryFn: () => api<Connector[]>('/connectors') });
  const apps = useQuery({ queryKey: ['onboarding-device-apps'], queryFn: discoverLaunchableApps, enabled: Boolean(token), staleTime: 5 * 60_000 });
  const choices = useMemo(() => (apps.data ?? []).slice(0, 8), [apps.data]);

  const addDevice = useMutation({
    mutationFn: async (app: DiscoveredDeviceApp) => {
      if (!token) throw new Error('AUTH_REQUIRED');
      const deviceId = await deviceInstallationId();
      const trusted = await ensureTrustedDevice(token);
      const request = createDeviceAppConnectionRequest(deviceId, trusted.id, app);
      if (!request) throw new Error('INVALID_DEVICE_APP');
      return deviceBoundApi<DeviceConnection>('/device-app-connections', token, { method: 'POST', body: JSON.stringify(request) });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['device-app-connections', token] });
      setStep('notifications');
    },
  });

  const authorize = useMutation({
    mutationFn: async (connector: Connector) => {
      if (!token) throw new Error('AUTH_REQUIRED');
      const redirectUri = Linking.createURL('/oauth/callback', { queryParams: { provider: connector.key, onboarding: '1' } });
      const request = connectionStartRequest(connector, redirectUri);
      if (!request) throw new Error('PROVIDER_UNAVAILABLE');
      const started = await api<OAuthStartResult>(request.path, token, request.init);
      const result = await WebBrowser.openAuthSessionAsync(started.authorizationUrl, redirectUri);
      if (result.type !== 'success') throw new Error('AUTH_CANCELLED');
      const parsed = Linking.parse(result.url);
      router.push({ pathname: '/oauth/callback', params: { provider: started.providerKey, onboarding: '1', code: first(parsed.queryParams?.code as string | string[] | undefined), state: first(parsed.queryParams?.state as string | string[] | undefined), error: first(parsed.queryParams?.error as string | string[] | undefined) } } as unknown as Href);
    },
  });

  const finish = async () => { await completeOnboarding(); router.replace('/' as never); };
  const requestNotifications = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    await finish();
  };

  if (step === 'connections') return <ConnectionStep apps={choices} connectors={connectors.data ?? []} loading={apps.isLoading || connectors.isLoading} error={apps.isError || connectors.isError} onApp={(app) => { setSelectedApp(app); setSelectedConnector(null); setStep('authorization'); }} onConnector={(connector) => { setSelectedConnector(connector); setSelectedApp(null); setStep('authorization'); }} onContinue={() => setStep('notifications')} />;
  if (step === 'authorization') return <AuthorizationStep app={selectedApp} connector={selectedConnector} pending={addDevice.isPending || authorize.isPending} error={addDevice.isError || authorize.isError} onBack={() => setStep('connections')} onAuthorize={() => selectedApp ? addDevice.mutate(selectedApp) : selectedConnector ? authorize.mutate(selectedConnector) : setStep('notifications')} onSkip={() => setStep('notifications')} />;
  return <NotificationStep onEnable={() => void requestNotifications()} onSkip={() => void finish()} />;
}

function Mark() { return <View style={styles.mark}><View style={styles.dot} /><View style={styles.dot} /></View>; }

function ConnectionStep({ apps, connectors, loading, error, onApp, onConnector, onContinue }: { apps: DiscoveredDeviceApp[]; connectors: Connector[]; loading: boolean; error: boolean; onApp: (app: DiscoveredDeviceApp) => void; onConnector: (connector: Connector) => void; onContinue: () => void }) {
  return <SafeAreaView style={styles.safeArea}><ScrollView contentContainerStyle={styles.scroll}><Mark /><Text style={styles.heading}>让懒人装甲在这台设备上更了解你</Text><Text style={styles.subheading}>只连接你选择的来源，每项读取和操作都会单独说明。</Text>
    {loading ? <ActivityIndicator style={styles.loading} color="#397FA9" /> : null}
    {error ? <Text style={styles.error}>暂时无法读取真实连接，请检查网络后重试。</Text> : null}
    <View style={styles.list}>{apps.map((app) => <Pressable key={app.packageName} onPress={() => onApp(app)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><View style={styles.appIcon}>{app.iconDataUri ? <Image source={{ uri: app.iconDataUri }} style={styles.appImage} /> : <Ionicons name="apps-outline" size={22} color="#377B9E" />}</View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{app.displayName}</Text><Text style={styles.rowText}>连接这台手机上已安装的应用</Text></View><Text style={styles.connect}>＋ 连接</Text></Pressable>)}</View>
    {connectors.length > 0 ? <><Text style={styles.sectionTitle}>在线服务</Text><View style={styles.list}>{connectors.map((connector) => { const ready = connector.connectable && !connector.draftOnly && connector.productionStatus !== 'DISABLED' && connector.authentication.type === 'oauth2'; return <Pressable key={connector.key} disabled={!ready} onPress={() => onConnector(connector)} style={({ pressed }) => [styles.row, !ready && styles.unavailable, pressed && styles.pressed]}><View style={styles.appIcon}><Ionicons name="cloud-outline" size={22} color="#377B9E" /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{connector.name}</Text><Text numberOfLines={2} style={styles.rowText}>{ready ? connector.description : '当前环境尚未配置授权服务'}</Text></View><Text style={styles.connect}>{ready ? '＋ 连接' : '不可用'}</Text></Pressable>; })}</View></> : null}
  </ScrollView><View style={styles.footerBar}><Pressable onPress={onContinue} style={styles.primaryLight}><Text style={styles.primaryLightText}>继续</Text></Pressable><Pressable onPress={onContinue} style={styles.skip}><Text style={styles.skipText}>暂时跳过</Text></Pressable></View></SafeAreaView>;
}

function AuthorizationStep({ app, connector, pending, error, onBack, onAuthorize, onSkip }: { app: DiscoveredDeviceApp | null; connector: Connector | null; pending: boolean; error: boolean; onBack: () => void; onAuthorize: () => void; onSkip: () => void }) {
  const name = app?.displayName ?? connector?.name ?? '所选连接';
  return <SafeAreaView style={styles.safeArea}><View style={styles.authorization}><Pressable onPress={onBack} style={styles.back}><Ionicons name="arrow-back" size={26} color="#526475" /></Pressable><Mark /><View style={styles.authIcon}><Ionicons name={app ? 'phone-portrait-outline' : 'shield-checkmark-outline'} size={54} color="#FFFFFF" /></View><Text style={styles.heading}>授权连接 {name}</Text><Text style={styles.authCopy}>{app ? '确认后会用这台设备的安全密钥完成设备证明，并保存你选择的应用连接。此步骤不会自动读取应用内容或通知。' : '接下来会打开服务商的正式授权页。只有你在服务商页面确认后，连接才会创建；凭据不会显示在应用界面中。'}</Text>{error ? <Text style={styles.error}>授权没有完成，没有保存新的权限。你可以返回后重试。</Text> : null}</View><View style={styles.footerBar}><Pressable disabled={pending} onPress={onAuthorize} style={[styles.primaryLight, pending && styles.disabled]}><Text style={styles.primaryLightText}>{pending ? '正在连接…' : '继续授权'}</Text></Pressable><Pressable onPress={onSkip} style={styles.skip}><Text style={styles.skipText}>暂时跳过</Text></Pressable></View></SafeAreaView>;
}

function NotificationStep({ onEnable, onSkip }: { onEnable: () => void; onSkip: () => void }) {
  return <SafeAreaView style={styles.safeArea}><View style={styles.notification}><Mark /><Text style={styles.heading}>开启通知，让懒人装甲在后台也能继续帮你做事</Text><View style={styles.bellFrame}><Ionicons name="notifications-outline" size={92} color="rgba(255,255,255,0.94)" /></View></View><View style={styles.footerBar}><Pressable onPress={onEnable} style={styles.primaryLight}><Text style={styles.primaryLightText}>开启通知</Text></Pressable><Pressable onPress={onSkip} style={styles.skip}><Text style={styles.skipText}>暂时跳过</Text></Pressable></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: 'transparent' }, scroll: { paddingHorizontal: 20, paddingTop: 58, paddingBottom: 150 }, mark: { flexDirection: 'row', alignSelf: 'center', gap: 10, marginBottom: 34 }, dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.94)' }, heading: { color: '#202A36', fontSize: 27, lineHeight: 38, fontWeight: '500', textAlign: 'center' }, subheading: { marginTop: 10, color: '#667584', fontSize: 14, lineHeight: 21, textAlign: 'center' }, loading: { marginTop: 28 }, error: { marginTop: 16, color: '#A33C46', fontSize: 14, lineHeight: 21, textAlign: 'center' }, list: { gap: 10, marginTop: 26 }, sectionTitle: { marginTop: 26, color: '#334252', fontSize: 17, fontWeight: '700' }, row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.95)' }, appIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 13, backgroundColor: 'rgba(219,239,249,0.92)' }, appImage: { width: 46, height: 46 }, rowCopy: { flex: 1, minWidth: 0 }, rowTitle: { color: '#202A36', fontSize: 17, fontWeight: '700' }, rowText: { marginTop: 3, color: '#52606E', fontSize: 14, lineHeight: 20 }, connect: { color: '#293845', fontSize: 14, fontWeight: '600' }, unavailable: { opacity: 0.58 }, pressed: { opacity: 0.68 },
  footerBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 18, backgroundColor: 'rgba(239,245,249,0.72)' }, primaryLight: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)' }, primaryLightText: { color: '#202830', fontSize: 17, fontWeight: '700' }, skip: { minHeight: 46, alignItems: 'center', justifyContent: 'center' }, skipText: { color: '#677482', fontSize: 15 }, disabled: { opacity: 0.55 }, authorization: { flex: 1, alignItems: 'center', paddingHorizontal: 30, paddingTop: 12, paddingBottom: 142 }, back: { width: 48, height: 48, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', marginLeft: -10 }, authIcon: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center', marginBottom: 30, borderRadius: 32, backgroundColor: 'rgba(79,146,181,0.72)' }, authCopy: { marginTop: 20, padding: 20, color: '#344554', fontSize: 15, lineHeight: 25, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.7)' }, notification: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 80, paddingBottom: 142 }, bellFrame: { flex: 1, width: '100%', maxHeight: 520, alignItems: 'center', justifyContent: 'center', marginTop: 44, borderWidth: 4, borderColor: 'rgba(255,255,255,0.86)', borderRadius: 62 },
});
