const entries = [
  ['用户与连接', '用户支持、连接状态与逐项权限'],
  ['Connector 管理', '注册表、Capability 与健康状态'],
  ['执行运维', 'P0-5 预留，本轮不可用'],
  ['Risk & Approval', '后续风险目录与审批运营入口'],
  ['Audit & Security', '后续安全审计入口'],
  ['System', 'MySQL、Redis、BullMQ 与 Migration 状态'],
];

export default function AdminShell() {
  return (
    <main>
      <aside>
        <div className="brand">懒人装甲</div>
        <div className="admin">Admin · P0 Shell</div>
        <nav>{entries.map(([title]) => <span key={title}>{title}</span>)}</nav>
      </aside>
      <section>
        <header><div><p>统一底层</p><h1>管理后台骨架</h1></div><button type="button">管理员登录（待接企业身份）</button></header>
        <div className="notice">本轮仅提供入口和边界，不展示 Mock 业务数据，也不开放高风险管理操作。</div>
        <div className="grid">{entries.map(([title, description]) => <article key={title}><h2>{title}</h2><p>{description}</p><small>入口已预留</small></article>)}</div>
      </section>
    </main>
  );
}
