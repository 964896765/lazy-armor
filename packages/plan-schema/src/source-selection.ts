/**
 * 统一来源选择合同（Source Selection Contract）。
 *
 * `selectedSourceId` 历史上是一个带前缀的模糊字符串（`connection:` / `device-app:`），
 * 只能表达 Provider Connection 与可信设备两类来源，无法表达手动登记与内部事实，
 * 也容易被客户端自行声明「已授权 / 已验证 / 具备真实设备能力」。
 *
 * 本文件建立类型化的来源身份，区分四类互斥来源：
 *  - PROVIDER_CONNECTION 外部 Provider 连接（复用既有 connection/权限/能力/健康检查）
 *  - TRUSTED_DEVICE       可信设备（需验证设备身份、授权范围、设备状态与实际能力）
 *  - MANUAL_INPUT         用户手动登记的真实事实
 *  - INTERNAL_FACT        具有用户归属、事实版本与来源证据的内部事实
 *
 * 每种来源只暴露自己真实拥有的身份字段，绝不虚构 Provider Connection 来冒充
 * 手动来源或内部事实。
 */
export const SOURCE_SELECTION_KINDS = [
  'PROVIDER_CONNECTION',
  'TRUSTED_DEVICE',
  'MANUAL_INPUT',
  'INTERNAL_FACT',
] as const;
export type SourceSelectionKind = typeof SOURCE_SELECTION_KINDS[number];

export const SOURCE_SELECTION_SCHEMA_VERSION = 1 as const;

export interface SourceSelection {
  schemaVersion: typeof SOURCE_SELECTION_SCHEMA_VERSION;
  kind: SourceSelectionKind;
  /**
   * 稳定、按 kind 命名空间化的不透明 id。为历史兼容，等价于旧的
   * selectedSourceId 字符串（`connection:…` / `device-app:…` /
   * `manual:…` / `internal:…`）。
   */
  sourceId: string;
  /** PROVIDER_CONNECTION：外部 Provider 连接 id。 */
  connectionId: string | null;
  /** PROVIDER_CONNECTION / TRUSTED_DEVICE：来源能力 key。 */
  capabilityKey: string | null;
  /** TRUSTED_DEVICE：可信设备 id。 */
  trustedDeviceId: string | null;
  /** TRUSTED_DEVICE：设备 App 连接 id（读取机制的具体载体）。 */
  deviceAppConnectionId: string | null;
  /** MANUAL_INPUT / INTERNAL_FACT：事实记录 id。 */
  truthRecordId: string | null;
  /** MANUAL_INPUT / INTERNAL_FACT：事实版本 id。 */
  truthVersionId: string | null;
}

export function buildSourceSelection(input: {
  kind: SourceSelectionKind;
  sourceId: string;
  connectionId?: string | null;
  capabilityKey?: string | null;
  trustedDeviceId?: string | null;
  deviceAppConnectionId?: string | null;
  truthRecordId?: string | null;
  truthVersionId?: string | null;
}): SourceSelection {
  const selection: SourceSelection = {
    schemaVersion: SOURCE_SELECTION_SCHEMA_VERSION,
    kind: input.kind,
    sourceId: input.sourceId,
    connectionId: input.connectionId ?? null,
    capabilityKey: input.capabilityKey ?? null,
    trustedDeviceId: input.trustedDeviceId ?? null,
    deviceAppConnectionId: input.deviceAppConnectionId ?? null,
    truthRecordId: input.truthRecordId ?? null,
    truthVersionId: input.truthVersionId ?? null,
  };
  if (!isSourceSelection(selection)) throw new Error(`Incomplete ${input.kind} source identity`);
  return Object.freeze(selection);
}

/**
 * 根据来源身份选择 id 命名空间。只允许这四种，避免客户端注入任意前缀。
 */
export function sourceIdNamespace(kind: SourceSelectionKind): string {
  switch (kind) {
    case 'PROVIDER_CONNECTION': return 'connection';
    case 'TRUSTED_DEVICE': return 'device-app';
    case 'MANUAL_INPUT': return 'manual';
    case 'INTERNAL_FACT': return 'internal';
  }
}

/** 验证一个反序列化的来源选择是否自洽（kind 与命名空间、身份字段一致）。 */
export function isSourceSelection(value: unknown): value is SourceSelection {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SourceSelection>;
  if (candidate.schemaVersion !== SOURCE_SELECTION_SCHEMA_VERSION) return false;
  if (!SOURCE_SELECTION_KINDS.includes(candidate.kind as SourceSelectionKind)) return false;
  if (typeof candidate.sourceId !== 'string' || !candidate.sourceId) return false;
  const namespace = sourceIdNamespace(candidate.kind as SourceSelectionKind);
  if (!candidate.sourceId.startsWith(`${namespace}:`)) return false;
  // 每种来源必须携带其真实身份字段，不能为空。
  switch (candidate.kind) {
    case 'PROVIDER_CONNECTION':
      return typeof candidate.connectionId === 'string' && Boolean(candidate.connectionId)
        && typeof candidate.capabilityKey === 'string' && Boolean(candidate.capabilityKey)
        && candidate.sourceId === `connection:${candidate.connectionId}:${candidate.capabilityKey}`;
    case 'TRUSTED_DEVICE':
      return typeof candidate.trustedDeviceId === 'string' && Boolean(candidate.trustedDeviceId)
        && typeof candidate.deviceAppConnectionId === 'string' && Boolean(candidate.deviceAppConnectionId)
        && typeof candidate.capabilityKey === 'string' && Boolean(candidate.capabilityKey)
        && candidate.sourceId === `device-app:${candidate.deviceAppConnectionId}`;
    case 'MANUAL_INPUT':
    case 'INTERNAL_FACT':
      return typeof candidate.truthRecordId === 'string' && Boolean(candidate.truthRecordId)
        && typeof candidate.truthVersionId === 'string' && Boolean(candidate.truthVersionId)
        && candidate.sourceId === `${candidate.kind === 'MANUAL_INPUT' ? 'manual' : 'internal'}:${candidate.truthRecordId}:${candidate.truthVersionId}`;
    default:
      return false;
  }
}
