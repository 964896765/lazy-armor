import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { api, ApiError } from '../src/api';
import { authError } from '../src/auth-error';
import type { SecurityMethods } from '../src/auth-methods';
import { useAuthStore } from '../src/auth-store';
import { SegmentedControl } from '../src/consumer-ui';
import { AuthPage, styles } from './auth/login';

type Stage = 'start' | 'current' | 'target' | 'done';
type Delivery = { retryAfterSeconds: number; delivery?: string };

export default function SecurityBindEmailPage() {
  const token = useAuthStore(s => s.token);
  const client = useQueryClient();
  const methods = useQuery({ queryKey: ['security-methods', token], queryFn: () => api<SecurityMethods>('/auth/security/methods', token), enabled: Boolean(token) });
  const sources = methods.data?.emailBinding?.sources ?? [];
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
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
    setEmail(''); setSourceId(''); setProof('password');
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
  const post = <T,>(path: string, body: unknown) => api<T>('/auth/email-binding/' + path, token, { method: 'POST', body: JSON.stringify(body) });
  const delivery = (result: Delivery) => {
    setRetryAt(Date.now() + result.retryAfterSeconds * 1000);
    setNotice(result.delivery === 'LOCAL_DEVELOPMENT' ? '开发验证码已生成，请查看本地后端控制台。' : '验证码已发送，5 分钟内有效。');
  };
  const perform = async (work: (current: () => boolean) => Promise<void>) => {
    const captured = generation.current;
    const current = () => generation.current === captured && useAuthStore.getState().token === token;
    setBusy(true); setError('');
    try { await work(current); }
    catch (e) {
      if (current()) {
        if (e instanceof ApiError && (e.code === 'EMAIL_BIND_PROOF_EXPIRED' || e.status === 503)) restart();
        setError(authError(e));
      }
    } finally { if (current()) setBusy(false); }
  };
  const start = () => perform(async current => {
    const result = await post<Delivery & { challenge: string; stage: 'current' | 'target'; challengeExpiresIn: number }>('start', { email, proof, ...(proof === 'password' ? { password } : { identifierId: selected }) });
    if (!current()) return;
    setPassword(''); setCode(''); setChallenge(result.challenge); setStage(result.stage); setExpiresAt(Date.now() + result.challengeExpiresIn * 1000);
    if (result.stage === 'current') delivery(result); else setNotice('当前账号已验证，请获取新邮箱验证码。');
  });
  const confirmCurrent = () => perform(async current => {
    await post('current/confirm', { challenge, code });
    if (current()) { setStage('target'); setCode(''); setNotice('当前账号已验证，请获取新邮箱验证码。'); setRetryAt(0); }
  });
  const requestTarget = () => perform(async current => {
    const result = await post<Delivery>('target/request', { challenge });
    if (current()) delivery(result);
  });
  const confirm = () => perform(async current => {
    await post('confirm', { challenge, code });
    if (!current()) return;
    setStage('done'); setChallenge(''); setCode(''); setNotice('');
    await client.invalidateQueries({ queryKey: ['security-methods'] });
  });
  return <AuthPage title="添加登录邮箱" subtitle={stage === 'done' ? '邮箱已添加到当前账号' : stage === 'current' ? '第一步：验证当前账号' : stage === 'target' ? '第二步：验证新邮箱' : '两次验证，将新邮箱绑定到当前账号'} backHref="/security-center">
    {methods.isPending ? <Text style={styles.notice}>正在读取账号验证方式…</Text> : methods.isError ? <Text style={styles.error}>{authError(methods.error)}</Text> : !methods.data?.emailBinding?.available ? <Text style={styles.notice}>新增邮箱绑定暂未开放。</Text> : <>
      {stage === 'done' ? <>
        <Text style={styles.success}>邮箱已绑定。可以用新邮箱验证码{methods.data.passwordConfigured ? '或当前密码' : ''}登录原账号，目标与记录仍属于此账号。</Text>
        <Pressable accessibilityRole="button" style={styles.submit} onPress={() => router.replace('/security-center' as never)}><Text style={styles.submitText}>返回账号与验证</Text></Pressable>
      </> : <>
        <Text style={styles.fieldLabel}>新邮箱</Text>
        <TextInput accessibilityLabel="新邮箱" placeholder="要添加的邮箱地址" style={styles.input} value={email} editable={!busy && stage === 'start'} maxLength={320} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} onChangeText={setEmail}/>
        {stage === 'start' ? <>
          {methods.data.passwordConfigured && sources.length ? <SegmentedControl value={proof} options={[{ value: 'password', label: '当前密码' }, { value: 'code', label: '已有验证码' }]} onChange={value => { if (!busy) { setProof(value); setPassword(''); setError(''); } }}/> : null}
          {proof === 'password' ? <TextInput accessibilityLabel="当前密码" placeholder="当前账号密码" style={styles.input} value={password} onChangeText={setPassword} editable={!busy} secureTextEntry autoComplete="current-password" maxLength={128}/> : <>
            <Text style={styles.notice}>选择当前账号已验证的登录方式</Text>
            {sources.map(source => <Pressable key={source.id} accessibilityRole="radio" accessibilityState={{ checked: selected === source.id }} disabled={busy} onPress={() => setSourceId(source.id)}><Text style={styles.textLink}>{selected === source.id ? '● ' : '○ '}{source.kind === 'email' ? '邮箱' : '手机号'} · {source.masked}</Text></Pressable>)}
            {!sources.length ? <Text style={styles.notice}>当前没有可发送验证码的已验证渠道，请先验证已有邮箱。</Text> : null}
          </>}
          <Pressable accessibilityRole="button" disabled={busy || !email.trim() || (proof === 'password' ? !password : !selected)} style={[styles.submit, busy && styles.submitDisabled]} onPress={() => void start()}><Text style={styles.submitText}>{busy ? '验证中…' : proof === 'password' ? '验证当前账号' : '发送当前账号验证码'}</Text></Pressable>
        </> : <>
          {stage === 'current' ? <Text style={styles.notice}>验证码发送至已有登录方式：{sources.find(s => s.id === selected)?.masked}</Text> : null}
          {stage === 'target' ? <Text style={styles.notice}>请核对新邮箱：{email.trim()}</Text> : null}
          <TextInput accessibilityLabel={stage === 'current' ? '当前账号验证码' : '新邮箱验证码'} placeholder={stage === 'current' ? '当前账号的 6 位验证码' : '新邮箱的 6 位验证码'} style={styles.input} value={code} onChangeText={setCode} editable={!busy} keyboardType="number-pad" maxLength={6}/>
          {stage === 'target' ? <Pressable accessibilityRole="button" disabled={busy || remaining > 0} onPress={() => void requestTarget()}><Text style={styles.textLink}>{remaining > 0 ? remaining + ' 秒后重试' : '获取新邮箱验证码'}</Text></Pressable> : null}
          <Pressable accessibilityRole="button" disabled={busy || !/^\d{6}$/.test(code)} style={[styles.submit, busy && styles.submitDisabled]} onPress={() => void (stage === 'current' ? confirmCurrent() : confirm())}><Text style={styles.submitText}>{busy ? '验证中…' : stage === 'current' ? '确认当前账号' : '验证并绑定邮箱'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={restart}><Text style={styles.textLink}>重新开始绑定</Text></Pressable>
        </>}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.notice}>仅添加登录方式，不自动合并其他账号。敏感操作仍需单独授权。</Text>
      </>}
    </>}
  </AuthPage>;
}
