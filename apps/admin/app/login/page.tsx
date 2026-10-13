export const dynamic = 'force-dynamic';

const messages: Record<string, string> = {
  credentials: '邮箱或密码不正确，或账号当前不可用。',
  forbidden: '该账号没有管理员访问权限。',
  unavailable: '认证服务暂时不可用，请稍后重试。',
  'rate-limit': '登录尝试过于频繁，请稍后重试。',
  'logout-incomplete': '此浏览器已退出，但服务端未能确认会话撤销。请稍后重试或联系管理员。',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="auth-shell"><section className="auth-card">
    <p className="eyebrow">懒人装甲 · Operations</p><h1>管理员登录</h1>
    <p>请使用已有管理员账号的邮箱和密码。会话到期后需重新登录。</p>
    {error && Object.hasOwn(messages, error) && <p className="endpoint-error" role="alert">{messages[error]}</p>}
    <form action="/auth/login" method="post" className="login-form">
      <label htmlFor="email">邮箱</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required />
      <label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={128} required />
      <button type="submit">登录</button>
    </form>
  </section></main>;
}
