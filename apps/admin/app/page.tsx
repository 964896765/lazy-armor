import { loadOperationsDashboard, type EndpointResult } from './operations-data';

export const dynamic = 'force-dynamic';

type Worker = {
  status?: string;
  processStatus?: string;
  dataStatus?: string;
  queueBacklog?: number | null;
  readiness?: { status?: string; mysql?: string; redis?: string; bullmq?: string; reason?: string | null };
};

type Overview = {
  status?: string;
  dataStatus?: string;
  generatedAt?: string;
  delivery?: { outcomeUnknown?: number | null };
};

type Diagnostics = {
  activeExecutions?: number;
  failedExecutions24h?: number;
  pendingOutbox?: number;
  deadOutbox?: number;
  outcomeUnknown?: number;
  stuckExecutions?: number;
};

type Workers = { executionWorker?: Worker; outboxWorker?: Worker };
type Outbox = { dataStatus?: string; pendingCount?: number | null; retryWaitCount?: number | null; deadCount?: number | null; recentFailures?: Array<{ id: string; status: string; lastErrorCode?: string | null }> };
type Executions = { dataStatus?: string; stuck?: Array<{ id: string; stuckDurationSeconds?: number | null }>; recentFailed?: Array<{ id: string; errorCode?: string | null; resultCode?: string | null }> };
type Connectors = { items?: Array<{ providerKey: string; provider: string; operationalHealth: string; productionGateStatus: string }> };
type Alerts = { overallStatus?: string; alerts?: Array<{ code: string; severity: string; status: string; title: string; summary: string }> };

function data<T>(result: EndpointResult<unknown>): T | null {
  return result.data as T | null;
}

function tone(status?: string | null) {
  const normalized = status?.toLowerCase();
  if (['up', 'ready', 'available', 'healthy', 'clear'].includes(normalized ?? '')) return 'ok';
  if (['down', 'critical', 'unavailable', 'not_ready'].includes(normalized ?? '')) return 'bad';
  return 'warn';
}

function Status({ value }: { value?: string | null }) {
  return <span className={`status ${tone(value)}`}>{value ?? 'UNKNOWN'}</span>;
}

function Metric({ label, value }: { label: string; value?: number | string | null }) {
  return <div className="metric"><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}

function EndpointError({ result }: { result: EndpointResult<unknown> }) {
  return result.error ? <p className="endpoint-error">数据不可用：{result.error}</p> : null;
}

export default async function OperationsDashboard(): Promise<React.ReactElement> {
  const snapshot = await loadOperationsDashboard();
  const overview = data<Overview>(snapshot.overview);
  const diagnostics = data<Diagnostics>(snapshot.diagnostics);
  const workers = data<Workers>(snapshot.workers);
  const outbox = data<Outbox>(snapshot.outbox);
  const executions = data<Executions>(snapshot.executions);
  const connectors = data<Connectors>(snapshot.connectors);
  const alerts = data<Alerts>(snapshot.alerts);
  const executionWorker = workers?.executionWorker;
  const outboxWorker = workers?.outboxWorker;
  const firingAlerts = alerts?.alerts?.filter((item) => item.status === 'firing') ?? [];

  return (
    <main>
      <aside>
        <div className="brand">懒人装甲</div>
        <div className="admin">Operations · Read only</div>
        <nav>
          {['System', 'Workers', 'Execution', 'Outbox', 'Connector', 'Alerts'].map((item) => <a key={item} href={`#${item.toLowerCase()}`}>{item}</a>)}
        </nav>
        <p className="guardrail">只读诊断。这里不能修改执行、Outbox、历史记录，也不能绕过 Risk / Approval。</p>
      </aside>

      <section className="content">
        <header>
          <div><p>统一底层运行态</p><h1>Operations Dashboard</h1></div>
          <div className="header-status"><Status value={overview?.status ?? alerts?.overallStatus} /><small>{overview?.generatedAt ? new Date(overview.generatedAt).toLocaleString('zh-CN') : '尚未取得快照'}</small></div>
        </header>

        {!snapshot.configured && <div className="notice">尚未配置服务端 ADMIN_ACCESS_TOKEN。Dashboard 保持只读、fail closed，不会发出未认证诊断请求。</div>}

        <article id="system">
          <div className="section-title"><div><span className="eyebrow">System</span><h2>基础依赖</h2></div><Status value={overview?.status} /></div>
          <EndpointError result={snapshot.overview} />
          <EndpointError result={snapshot.diagnostics} />
          <div className="status-grid">
            <Metric label="API" value={snapshot.overview.data ? 'UP' : 'UNAVAILABLE'} />
            <Metric label="DB" value={overview?.dataStatus} />
            <Metric label="Redis" value={executionWorker?.readiness?.redis ?? outboxWorker?.readiness?.redis} />
            <Metric label="Queue" value={executionWorker?.readiness?.bullmq ?? outboxWorker?.readiness?.bullmq} />
          </div>
          <div className="metrics">
            <Metric label="active execution" value={diagnostics?.activeExecutions} />
            <Metric label="failed / 24h" value={diagnostics?.failedExecutions24h} />
            <Metric label="pending outbox" value={diagnostics?.pendingOutbox} />
          </div>
        </article>

        <div className="two-column">
          <article id="workers">
            <div className="section-title"><div><span className="eyebrow">Workers</span><h2>进程与就绪状态</h2></div></div>
            <EndpointError result={snapshot.workers} />
            {[['Execution Worker', executionWorker], ['Outbox Worker', outboxWorker]].map(([label, worker]) => {
              const item = worker as Worker | undefined;
              return <div className="row" key={label as string}><div><strong>{label as string}</strong><small>{item?.readiness?.reason ?? `backlog ${item?.queueBacklog ?? '—'}`}</small></div><Status value={item?.status ?? item?.processStatus} /></div>;
            })}
          </article>

          <article id="execution">
            <div className="section-title"><div><span className="eyebrow">Execution</span><h2>异常执行</h2></div><Status value={executions?.dataStatus} /></div>
            <EndpointError result={snapshot.executions} />
            <div className="metrics">
              <Metric label="stuck" value={executions?.stuck?.length} />
              <Metric label="recent failed" value={executions?.recentFailed?.length} />
              <Metric label="outcome_unknown" value={overview?.delivery?.outcomeUnknown ?? diagnostics?.outcomeUnknown} />
            </div>
          </article>
        </div>

        <div className="two-column">
          <article id="outbox">
            <div className="section-title"><div><span className="eyebrow">Outbox</span><h2>投递状态</h2></div><Status value={outbox?.dataStatus} /></div>
            <EndpointError result={snapshot.outbox} />
            <div className="metrics">
              <Metric label="pending" value={outbox?.pendingCount} />
              <Metric label="retry_wait" value={outbox?.retryWaitCount} />
              <Metric label="dead" value={outbox?.deadCount} />
            </div>
          </article>

          <article id="alerts">
            <div className="section-title"><div><span className="eyebrow">Alerts</span><h2>当前告警</h2></div><Status value={alerts?.overallStatus} /></div>
            <EndpointError result={snapshot.alerts} />
            {firingAlerts.length === 0 ? <p className="empty">当前没有 firing alert。</p> : firingAlerts.map((alert) => <div className="alert" key={alert.code}><Status value={alert.severity} /><div><strong>{alert.title}</strong><small>{alert.summary}</small></div></div>)}
          </article>
        </div>

        <article id="connector">
          <div className="section-title"><div><span className="eyebrow">Connector</span><h2>健康与 Production Gate</h2></div></div>
          <EndpointError result={snapshot.connectors} />
          <div className="table" role="table">
            <div className="table-row table-head" role="row"><span>Provider</span><span>Health</span><span>Production gate</span></div>
            {(connectors?.items ?? []).map((connector) => <div className="table-row" role="row" key={connector.providerKey}><strong>{connector.provider}</strong><Status value={connector.operationalHealth} /><Status value={connector.productionGateStatus} /></div>)}
            {(connectors?.items?.length ?? 0) === 0 && <p className="empty">没有可显示的 Connector 数据。</p>}
          </div>
        </article>

        <footer>数据源：7 个既有只读 Admin 接口 · 自动恢复、写操作与安全绕过均未开放</footer>
      </section>
    </main>
  );
}
