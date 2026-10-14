import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api, ApiError } from './api';
import { authError, authRetryLabel } from './auth-error';
import type { SecurityMethods } from './auth-methods';
import { useAuthStore } from './auth-store';
import { SegmentedControl } from './consumer-ui';
import { AuthPage, styles } from '../app/auth/login';

type Stage = 'start' | 'current' | 'target' | 'done';
type Delivery = { retryAfterSeconds: number; delivery?: string };

export function IdentifierBindingPage({ kind, operation = 'bind' }: { kind: 'email' | 'phone'; operation?:'bind'|'change' }) {
  const changing = operation === 'change';
  const label = kind === 'email' ? '邮箱' : '手机号';
  const token = useAuthStore(s => s.token);
  const client = useQueryClient();
  const methods = useQuery({ queryKey: ['security-methods', token], queryFn: () => api<SecurityMethods>('/auth/security/methods', token), enabled: Boolean(token) });
  useFocusEffect(useCallback(() => { if (token) void methods.refetch(); }, [token, methods.refetch]));
  const capability = changing ? methods.data?.phoneChange : kind === 'email' ? methods.data?.emailBinding : methods.data?.phoneBinding;
  const phones = methods.data?.phoneChange?.phones ?? [];
  const [oldIdentifierId,setOldIdentifierId] = useState('');
  const selectedOld = oldIdentifierId || phones[0]?.id;
  const sources = capability?.sources ?? [];
  const [identifier, setIdentifier] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [proofPreference, setProof] = useState('password'), [sourceId, setSourceId] = useState('');
  const proof = methods.data?.passwordConfigured ? proofPreference : 'code';
  const [stage, setStage] = useState<Stage>('start'), [challenge, setChallenge] = useState('');
  const [expiresAt, setExpiresAt] = useState(0), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const generation = useRef(0);
  const restart = () => { setChallenge(''); setStage('start'); setPassword(''); setCode(''); setExpiresAt(0); setNotice(''); setError(''); };
  useEffect(() => {
    generation.current++;
    restart(); setBusy(false);
    setIdentifier(''); setSourceId(''); setOldIdentifierId(''); setProof('password');
    if (challenge) setError('登录会话已更新，请重新验证当前账号。');
    return () => { generation.current++; };
  }, [token]);
  useFocusEffect(useCallback(() => () => {
    generation.current++; setChallenge(''); setStage('start'); setPassword(''); setCode(''); setBusy(false);
  }, []));
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (challenge && expiresAt <= now) {
      generation.current++; restart(); setBusy(false); setError('验证已过期，请重新开始绑定。');
    }
  }, [now, expiresAt, challenge]);
  const remaining = Math.max(0, Math.ceil((retryAt - Math.max(now, Date.now())) / 1000));
  const selected = sourceId || sources[0]?.id;
  const post = <T,>(path: string, body: unknown) => api<T>(`/auth/${kind}-${changing?'change':'binding'}/` + path, token, { method: 'POST', body: JSON.stringify(body) });
  const delivery = (result: Delivery) => {
    setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
    setNotice(result.delivery === 'LOCAL_DEVELOPMENT' ? '开发验证码已生成，请查看本地后端控制台。' : result.delivery === 'GATEWAY_ACCEPTED' ? '短信请求已受理，请留意短信。验证码 5 分钟内有效。' : '验证码已发送，5 分钟内有效。');
  };
  const perform = async (work: (current: () => boolean) => Promise<void>) => {
    const captured = generation.current;
    const current = () => generation.current === captured && useAuthStore.getState().token === token;
    setBusy(true); setError('');
    try { await work(current); }
    catch (e) {
      if (current()) {
        if(e instanceof ApiError && e.retryAfterMs)setRetryAt(Date.now()+e.retryAfterMs);
        if (e instanceof ApiError && (e.code === 'EMAIL_BIND_PROOF_EXPIRED' || e.code === 'PHONE_BIND_PROOF_EXPIRED' || e.code === 'PHONE_CHANGE_PROOF_EXPIRED' || e.status === 503)) restart();
        setError(authError(e));
      }
    } finally { if (current()) setBusy(false); }
  };
  const start = () => perform(async current => {
    const result = await post<Delivery & { challenge: string; stage: 'current' | 'target'; challengeExpiresIn: number }>('start', { [kind]: identifier, proof, ...(changing?{oldIdentifierId:selectedOld}:{}), ...(proof === 'password' ? { password } : { identifierId: selected }) });
    if (!current()) return;
    setPassword(''); setCode(''); setChallenge(result.challenge); setStage(result.stage); setExpiresAt(Date.now() + result.challengeExpiresIn * 1000);
    if (result.stage === 'current') delivery(result); else setNotice(`当前账号已验证，请获取新${label}验证码。`);
  });
  const confirmCurrent = () => perform(async current => {
    await post('current/confirm', { challenge, code });
    if (current()) { setStage('target'); setCode(''); setNotice(`当前账号已验证，请获取新${label}验证码。`); setRetryAt(0); }
  });
  const requestTarget = () => perform(async current => {
    const result = await post<Delivery>('target/request', { challenge });
    if (current()) delivery(result);
  });
  const confirm = () => perform(async current => {
    const result = await post<{changed?:boolean;reauthenticate?:boolean}>('confirm', { challenge, code });
    if (!current()) return;
    if (changing && result.changed && result.reauthenticate) {
      generation.current++; setChallenge(''); setPassword(''); setCode('');
      await useAuthStore.getState().clear();
      router.replace('/auth/login?reason=phone-changed' as never); return;
    }
    setStage('done'); setChallenge(''); setCode(''); setNotice('');
    await client.invalidateQueries({ queryKey: ['security-methods'] });
  });
  return <AuthPage title={changing?'更换登录手机号':`添加登录${label}`} subtitle={stage === 'done' ? `${label}已添加到当前账号` : stage === 'current' ? '第一步：验证当前账号' : stage === 'target' ? `第二步：验证新${label}` : changing?'验证当前账号和新号码，保留原账号与数据':`两次验证，将新${label}绑定到当前账号`} backHref="/security-center">
    {methods.isPending ? <Text style={styles.notice}>正在读取账号验证方式…</Text> : methods.isError ? <Text style={styles.error}>{authError(methods.error)}</Text> : !capability?.available ? <Text style={styles.notice}>{changing?'手机号更换暂未开放。':`新增${label}绑定暂未开放。`}</Text> : <>
      {stage === 'done' ? <>
        <Text style={styles.success}>{`${label}已绑定。可以用新${label}验证码`}{methods.data.passwordConfigured ? '或当前密码' : ''}登录原账号，目标与记录仍属于此账号。</Text>
        <Pressable accessibilityRole="button" style={styles.submit} onPress={() => router.replace('/security-center' as never)}><Text style={styles.submitText}>返回账号与验证</Text></Pressable>
      </> : <>
        {changing ? <>
          <Text style={styles.fieldLabel}>要停用的原手机号</Text>
          {phones.map(phone=><Pressable key={phone.id} accessibilityRole="radio" accessibilityState={{checked:selectedOld===phone.id}} disabled={busy||stage!=='start'} onPress={()=>setOldIdentifierId(phone.id)}><Text style={styles.textLink}>{selectedOld===phone.id?'● ':'○ '}{phone.masked}</Text></Pressable>)}
          <Text style={styles.notice}>完成后原号码将停用，所有设备需要重新登录。安全通知将排队发送到原号码和已验证邮箱，实际发送状态可在账号与验证中查看。</Text>
        </> : null}
        <Text style={styles.fieldLabel}>{`新${label}`}</Text>
        <TextInput accessibilityLabel={`新${label}`} placeholder={kind === 'email' ? '要添加的邮箱地址' : '+86 中国大陆手机号码'} style={styles.input} value={identifier} editable={!busy && stage === 'start'} maxLength={kind === 'email' ? 320 : 32} keyboardType={kind === 'email' ? 'email-address' : 'phone-pad'} autoCapitalize="none" autoCorrect={false} onChangeText={setIdentifier}/>
        {stage === 'start' ? <>
          {methods.data.passwordConfigured && sources.length ? <SegmentedControl value={proof} options={[{ value: 'password', label: '当前密码' }, { value: 'code', label: '已有验证码' }]} onChange={value => { if (!busy) { setProof(value); setPassword(''); setError(''); } }}/> : null}
          {proof === 'password' ? <TextInput accessibilityLabel="当前密码" placeholder="当前账号密码" style={styles.input} value={password} onChangeText={setPassword} editable={!busy} secureTextEntry autoComplete="current-password" maxLength={128}/> : <>
            <Text style={styles.notice}>选择当前账号已验证的登录方式</Text>
            {sources.map(source => <Pressable key={source.id} accessibilityRole="radio" accessibilityState={{ checked: selected === source.id }} disabled={busy} onPress={() => setSourceId(source.id)}><Text style={styles.textLink}>{selected === source.id ? '● ' : '○ '}{source.kind === 'email' ? '邮箱' : '手机号'} · {source.masked}</Text></Pressable>)}
            {!sources.length ? <Text style={styles.notice}>当前没有可发送验证码的已验证渠道，请先验证已有邮箱。</Text> : null}
          </>}
          <Pressable accessibilityRole="button" disabled={busy || !identifier.trim() || (changing&&!selectedOld) || (proof === 'password' ? !password : !selected)} style={[styles.submit, busy && styles.submitDisabled]} onPress={() => void start()}><Text style={styles.submitText}>{busy ? '验证中…' : proof === 'password' ? '验证当前账号' : '发送当前账号验证码'}</Text></Pressable>
        </> : <>
          {stage === 'current' ? <Text style={styles.notice}>验证码发送至已有登录方式：{sources.find(s => s.id === selected)?.masked}</Text> : null}
          {stage === 'target' ? <Text style={styles.notice}>{`请核对新${label}：${identifier.trim()}`}</Text> : null}
          <TextInput accessibilityLabel={stage === 'current' ? '当前账号验证码' : `新${label}验证码`} placeholder={stage === 'current' ? '当前账号的 6 位验证码' : `新${label}的 6 位验证码`} style={styles.input} value={code} onChangeText={setCode} editable={!busy} keyboardType="number-pad" maxLength={6}/>
          {stage === 'target' ? <Pressable accessibilityRole="button" disabled={busy || remaining > 0} onPress={() => void requestTarget()}><Text style={styles.textLink}>{remaining > 0 ? authRetryLabel(remaining) : `获取新${label}验证码`}</Text></Pressable> : null}
          <Pressable accessibilityRole="button" disabled={busy || !/^\d{6}$/.test(code)} style={[styles.submit, busy && styles.submitDisabled]} onPress={() => void (stage === 'current' ? confirmCurrent() : confirm())}><Text style={styles.submitText}>{busy ? '验证中…' : stage === 'current' ? '确认当前账号' : changing?'确认换号并重新登录':`验证并绑定${label}`}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={restart}><Text style={styles.textLink}>重新开始绑定</Text></Pressable>
        </>}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.notice}>{changing?'新号验证码不能单独恢复旧账号，已被占用的号码不能转移。':'仅添加登录方式，不自动合并其他账号。'}敏感操作仍需单独授权。</Text>
      </>}
    </>}
  </AuthPage>;
}
