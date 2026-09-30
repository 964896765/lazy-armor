export interface EvidenceFreshnessInput {
  observedAt: string;
  validUntil?: string | null;
}

export function evidenceStatusLabel(status: string): string {
  switch (status) {
    case 'truth_verified': return '已形成可信事实';
    case 'candidate_created': return '等待事实确认';
    case 'rejected': return '未采用';
    case 'normalized': return '已标准化';
    default: return '状态未识别';
  }
}

export function evidenceFreshness(input: EvidenceFreshnessInput, now = Date.now()): { label: string; expired: boolean } {
  const observed = Date.parse(input.observedAt);
  if (Number.isNaN(observed)) return { label: '观察时间不可用', expired: false };
  if (input.validUntil) {
    const validUntil = Date.parse(input.validUntil);
    if (!Number.isNaN(validUntil) && validUntil <= now) return { label: '已超过有效期', expired: true };
    if (!Number.isNaN(validUntil)) return { label: '仍在有效期内', expired: false };
  }
  return { label: '未声明有效期', expired: false };
}

export function sourceModeLabel(mode: string): string {
  switch (mode) {
    case 'NOTIFICATION': return '通知读取';
    case 'SHARE': return '系统分享';
    case 'APP_STRUCTURED_READ': return '受控应用读取';
    case 'PROVIDER_API': return '服务官方接口';
    case 'WEBHOOK': return '服务回调';
    case 'INTERNAL': return '设备任务';
    default: return mode || '来源未记录';
  }
}

export function shortEvidenceHash(value: string): string {
  return /^[a-f0-9]{64}$/i.test(value) ? `${value.slice(0, 12)}…${value.slice(-8)}` : '不可用';
}
