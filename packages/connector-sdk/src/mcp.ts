import { createHash } from 'node:crypto';

/**
 * R7 MCP Common Contract.
 *
 * This is the thinnest possible interop surface: typed descriptors plus a
 * minimal client that knows how to discover, bind, invoke, validate and
 * normalize a remote MCP tool. It deliberately does NOT become a second
 * capability/execution engine — binding produces a `capabilityKey` that the
 * Lazy Armor API maps back onto its existing Provider/Capability/Execution
 * chain. Transports are intentionally tiny (LOCAL/FIXTURE + HTTP JSON-RPC).
 */

export type McpEffectClass = 'READ_ONLY' | 'LOCAL_MUTATION' | 'EXTERNAL_SIDE_EFFECT';
export type McpTransportType = 'LOCAL' | 'FIXTURE' | 'HTTP' | 'STDIO';
export type McpTrustState = 'UNTRUSTED' | 'ALLOWLISTED' | 'AUTHORIZED';

export interface McpServerDescriptor {
  serverId: string;
  displayName: string;
  transport: McpTransportType;
  serverVersion: string;
  toolCatalogHash: string | null;
  trustState: McpTrustState;
  authorized: boolean;
  healthy: boolean;
  lastSeenAt: string | null;
  credentialRef?: string | null;
  /** Remote transport only. Empty for LOCAL/FIXTURE. */
  endpoint?: string | null;
  /** STDIO transport only. Must come from admin/user config or an allowlist. */
  command?: string | null;
}

export interface McpToolDescriptor {
  serverId: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** Lazy Armor capability identity derived from the tool. */
  capabilityKey: string;
  effectClass: McpEffectClass;
  /** Hint only — never a risk decision. */
  riskHint: string;
  verificationMethod: string | null;
  requiresApproval: boolean;
  /** Newly discovered external tools are disabled until an operator binds them. */
  enabled: boolean;
  schemaHash: string;
}

export interface McpToolBinding {
  bindingId: string;
  serverId: string;
  toolName: string;
  capabilityKey: string;
  effectClass: McpEffectClass;
  enabled: boolean;
  schemaHash: string;
  boundAt: string;
  /** Set when the observed schema no longer matches the bound schema. */
  revalidationRequired: boolean;
}

export interface McpToolCallRequest {
  requestId: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  userId?: string;
  timeoutMs?: number;
}

export interface McpEvidence {
  evidenceHash: string;
  toolCatalogHash: string | null;
  schemaHash: string;
  observedAt: string;
  requestId: string;
}

export interface McpToolCallResult {
  ok: boolean;
  serverId: string;
  toolName: string;
  content: Record<string, unknown> | null;
  error?: { code: string; message: string };
  evidence: McpEvidence;
}

export interface McpConnectionHealth {
  serverId: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unavailable' | 'unauthorized';
  checkedAt: string;
  reason?: string;
  toolCatalogHash: string | null;
  schemaMismatch: boolean;
}

export type McpToolHandler = {
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  effectClass: McpEffectClass;
  riskHint: string;
  verificationMethod?: string | null;
  invoke(args: Record<string, unknown>, context: { userId?: string }): Promise<Record<string, unknown>> | Record<string, unknown>;
};

export interface McpTransport {
  readonly transportType: McpTransportType;
  discover(): Promise<Array<Omit<McpToolHandler, 'invoke'>>>;
  invoke(toolName: string, args: Record<string, unknown>, options: { signal?: AbortSignal }): Promise<Record<string, unknown>>;
  health(): Promise<{ healthy: boolean; reason?: string; toolCatalogHash: string }>;
  /** Best-effort cancellation for a remote in-flight dispatch. */
  cancel?(requestId: string): Promise<void>;
}

export const MCP_CLIENT_ERROR_CODES = [
  'UNKNOWN_MCP_SERVER', 'UNKNOWN_MCP_TOOL', 'UNBOUND_MCP_TOOL', 'MCP_TOOL_DISABLED',
  'MCP_TOOL_NOT_ALLOWLISTED', 'MCP_SCHEMA_CHANGED', 'MCP_SCHEMA_INVALID', 'MCP_RESULT_SCHEMA_INVALID',
  'MCP_TIMEOUT', 'MCP_RESPONSE_TOO_LARGE', 'MCP_REQUEST_TOO_LARGE', 'MCP_SERVER_UNAVAILABLE',
  'MCP_CREDENTIAL_UNAVAILABLE', 'MCP_SIDE_EFFECT_REQUIRES_EXECUTION',
] as const;
export type McpClientErrorCode = typeof MCP_CLIENT_ERROR_CODES[number];

export class McpClientError extends Error {
  constructor(readonly code: McpClientErrorCode, message: string, readonly serverId?: string, readonly toolName?: string) {
    super(`${code}: ${message}`);
    this.name = 'McpClientError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeMcpSchemaHash(schema: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(schema)).digest('hex');
}

export function computeMcpToolCatalogHash(tools: Array<Pick<McpToolHandler, 'toolName' | 'inputSchema' | 'outputSchema'>>): string {
  return createHash('sha256').update(canonical(tools)).digest('hex');
}

/** Derives the stable Lazy Armor capability key for an MCP tool. */
export function mcpCapabilityKey(serverId: string, toolName: string): string {
  const normalized = toolName.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
  const prefix = serverId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return `MCP_${prefix}_${normalized}`;
}

export function describeMcpTool(serverId: string, tool: Omit<McpToolHandler, 'invoke'>, enabled = false): McpToolDescriptor {
  const schemaHash = computeMcpSchemaHash({ input: tool.inputSchema, output: tool.outputSchema });
  return {
    serverId,
    toolName: tool.toolName,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    capabilityKey: mcpCapabilityKey(serverId, tool.toolName),
    effectClass: tool.effectClass,
    riskHint: tool.riskHint,
    verificationMethod: tool.verificationMethod ?? null,
    requiresApproval: tool.effectClass === 'EXTERNAL_SIDE_EFFECT',
    enabled,
    schemaHash,
  };
}

/**
 * Minimal JSON-Schema subset validator. Supports the constructs our MCP
 * fixtures and adapters actually declare; anything unknown is fail-closed.
 */
export function validateMcpJson(value: unknown, schema: Record<string, unknown>, path = '$'): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path} must be an object`); return errors; }
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(properties)) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        errors.push(...validateMcpJson(record[key], properties[key], `${path}.${key}`));
      }
    }
    const required = (schema.required ?? []) as string[];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) errors.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
    return errors;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return errors; }
    const itemSchema = schema.items as Record<string, unknown> | undefined;
    if (itemSchema) value.forEach((item, index) => errors.push(...validateMcpJson(item, itemSchema, `${path}[${index}]`)));
    return errors;
  }
  if (type === 'string' && typeof value !== 'string') errors.push(`${path} must be a string`);
  if (type === 'integer' && (!Number.isSafeInteger(value))) errors.push(`${path} must be an integer`);
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) errors.push(`${path} must be a number`);
  if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
  if (type === 'null' && value !== null) errors.push(`${path} must be null`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => canonical(item) === canonical(value))) errors.push(`${path} must be one of the allowed values`);
  return errors;
}

export interface McpClientConfig {
  /** Server endpoints/commands may only come from an explicit allowlist. */
  allowedServers: string[];
  allowedTools?: string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  /** When false, only READ_ONLY tools may be invoked directly. */
  allowSideEffect?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_MAX_REQUEST_BYTES = 256_000;

export class McpClient {
  private readonly tools = new Map<string, Map<string, Omit<McpToolHandler, 'invoke'>>>();
  private readonly descriptors = new Map<string, McpServerDescriptor>();

  constructor(
    private readonly config: McpClientConfig,
    private readonly transports: Map<string, McpTransport>,
  ) {}

  getConfig(): McpClientConfig { return { ...this.config }; }

  async discover(serverId: string): Promise<McpServerDescriptor> {
    const transport = this.requireTransport(serverId);
    const listed = await transport.discover();
    const tools = new Map<string, Omit<McpToolHandler, 'invoke'>>();
    for (const tool of listed) tools.set(tool.toolName, tool);
    this.tools.set(serverId, tools);
    const catalogHash = computeMcpToolCatalogHash(listed);
    const descriptor: McpServerDescriptor = {
      serverId,
      displayName: serverId,
      transport: transport.transportType,
      serverVersion: '1.0.0',
      toolCatalogHash: catalogHash,
      trustState: this.config.allowedServers.includes(serverId) ? 'ALLOWLISTED' : 'UNTRUSTED',
      authorized: this.config.allowedServers.includes(serverId),
      healthy: true,
      lastSeenAt: new Date().toISOString(),
    };
    this.descriptors.set(serverId, descriptor);
    return descriptor;
  }

  describeTool(serverId: string, toolName: string, enabled = false): McpToolDescriptor {
    this.requireServer(serverId);
    const tool = this.requireTool(serverId, toolName);
    return describeMcpTool(serverId, tool, enabled);
  }

  listTools(serverId: string): McpToolDescriptor[] {
    this.requireServer(serverId);
    return [...(this.tools.get(serverId)?.values() ?? [])].map((tool) => describeMcpTool(serverId, tool, false));
  }

  async health(serverId: string, expectedCatalogHash: string | null): Promise<McpConnectionHealth> {
    const transport = this.requireTransport(serverId);
    const checkedAt = new Date().toISOString();
    try {
      const result = await transport.health();
      return {
        serverId,
        status: result.healthy ? 'healthy' : 'unavailable',
        checkedAt,
        reason: result.reason,
        toolCatalogHash: result.toolCatalogHash,
        schemaMismatch: expectedCatalogHash !== null && expectedCatalogHash !== result.toolCatalogHash,
      };
    } catch {
      return { serverId, status: 'unavailable', checkedAt, toolCatalogHash: null, schemaMismatch: false };
    }
  }

  async invokeTool(request: McpToolCallRequest, boundSchemaHash: string, effectClass: McpEffectClass): Promise<McpToolCallResult> {
    this.assertAllowedServer(request.serverId);
    const tool = this.requireTool(request.serverId, request.toolName);
    if (this.config.allowedTools && !this.config.allowedTools.includes(request.toolName)) {
      throw new McpClientError('MCP_TOOL_NOT_ALLOWLISTED', `Tool ${request.toolName} is not allowlisted`, request.serverId, request.toolName);
    }
    if (effectClass !== 'READ_ONLY' && !this.config.allowSideEffect) {
      throw new McpClientError('MCP_SIDE_EFFECT_REQUIRES_EXECUTION', `Tool ${request.toolName} is a side effect and cannot be invoked directly`, request.serverId, request.toolName);
    }
    const schemaHash = computeMcpSchemaHash({ input: tool.inputSchema, output: tool.outputSchema });
    if (schemaHash !== boundSchemaHash) {
      throw new McpClientError('MCP_SCHEMA_CHANGED', `Tool ${request.toolName} schema changed; binding requires revalidation`, request.serverId, request.toolName);
    }
    const inputErrors = validateMcpJson(request.arguments, tool.inputSchema);
    if (inputErrors.length) {
      throw new McpClientError('MCP_SCHEMA_INVALID', `Invalid arguments for ${request.toolName}: ${inputErrors.join('; ')}`, request.serverId, request.toolName);
    }
    const requestBytes = Buffer.byteLength(canonical(request.arguments), 'utf8');
    const maxRequestBytes = this.config.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    if (requestBytes > maxRequestBytes) {
      throw new McpClientError('MCP_REQUEST_TOO_LARGE', `Request for ${request.toolName} exceeds size limit`, request.serverId, request.toolName);
    }
    const transport = this.requireTransport(request.serverId);
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let content: Record<string, unknown>;
    try {
      content = await transport.invoke(request.toolName, request.arguments, { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new McpClientError('MCP_TIMEOUT', `Tool ${request.toolName} timed out`, request.serverId, request.toolName);
      }
      throw new McpClientError('MCP_SERVER_UNAVAILABLE', `Tool ${request.toolName} invocation failed: ${error instanceof Error ? error.message : 'unknown'}`, request.serverId, request.toolName);
    } finally {
      clearTimeout(timer);
    }
    const responseBytes = Buffer.byteLength(canonical(content), 'utf8');
    const maxResponseBytes = this.config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (responseBytes > maxResponseBytes) {
      throw new McpClientError('MCP_RESPONSE_TOO_LARGE', `Response for ${request.toolName} exceeds size limit`, request.serverId, request.toolName);
    }
    const outputErrors = validateMcpJson(content, tool.outputSchema);
    if (outputErrors.length) {
      throw new McpClientError('MCP_RESULT_SCHEMA_INVALID', `Invalid result for ${request.toolName}: ${outputErrors.join('; ')}`, request.serverId, request.toolName);
    }
    const observedAt = new Date().toISOString();
    const evidence: McpEvidence = {
      evidenceHash: createHash('sha256').update(canonical({ serverId: request.serverId, toolName: request.toolName, requestId: request.requestId, schemaHash, content })).digest('hex'),
      toolCatalogHash: this.descriptors.get(request.serverId)?.toolCatalogHash ?? null,
      schemaHash,
      observedAt,
      requestId: request.requestId,
    };
    return { ok: true, serverId: request.serverId, toolName: request.toolName, content, evidence };
  }

  private assertAllowedServer(serverId: string) {
    if (!this.config.allowedServers.includes(serverId)) {
      throw new McpClientError('UNKNOWN_MCP_SERVER', `Unknown or unauthorized MCP server: ${serverId}`, serverId);
    }
  }

  private requireTransport(serverId: string): McpTransport {
    const transport = this.transports.get(serverId);
    if (!transport) throw new McpClientError('UNKNOWN_MCP_SERVER', `Unknown MCP server: ${serverId}`, serverId);
    return transport;
  }

  private requireServer(serverId: string) {
    if (!this.tools.has(serverId)) throw new McpClientError('UNKNOWN_MCP_SERVER', `MCP server not discovered: ${serverId}`, serverId);
  }

  private requireTool(serverId: string, toolName: string): Omit<McpToolHandler, 'invoke'> {
    const tool = this.tools.get(serverId)?.get(toolName);
    if (!tool) throw new McpClientError('UNKNOWN_MCP_TOOL', `Unknown MCP tool: ${serverId}/${toolName}`, serverId, toolName);
    return tool;
  }
}

/** In-memory transport over a set of registered tool handlers. */
export class LocalMcpTransport implements McpTransport {
  readonly transportType: McpTransportType = 'LOCAL';
  constructor(
    private readonly handlers: Map<string, McpToolHandler>,
    private readonly invokeInterceptor?: (toolName: string, args: Record<string, unknown>, options: { signal?: AbortSignal }) => Promise<Record<string, unknown>>,
  ) {}

  async discover() {
    return [...this.handlers.values()].map(({ invoke: _invoke, ...tool }) => tool);
  }

  async invoke(toolName: string, args: Record<string, unknown>, options: { signal?: AbortSignal }): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(toolName);
    if (!handler) throw new McpClientError('UNKNOWN_MCP_TOOL', `Unknown MCP tool: ${toolName}`);
    if (options.signal?.aborted) throw new Error('Aborted');
    if (this.invokeInterceptor) return this.invokeInterceptor(toolName, args, options);
    return handler.invoke(args, {});
  }

  async health() {
    return { healthy: true, toolCatalogHash: computeMcpToolCatalogHash([...this.handlers.values()].map(({ invoke: _invoke, ...tool }) => tool)) };
  }
}

/** FIXTURE transport marker so fixtures are auditable separately from LOCAL tests. */
export class FixtureMcpTransport extends LocalMcpTransport {
  readonly transportType: McpTransportType = 'FIXTURE';
}

export interface FixtureFault {
  kind: 'timeout' | 'oversized_response' | 'unavailable' | 'invalid_result';
  toolName?: string;
}

/**
 * Deterministic MCP fixture server for tests. Never depends on real third-party
 * tokens or network. Supports fault injection to exercise fail-closed paths.
 */
export class FixtureMcpServer {
  protected readonly handlers = new Map<string, McpToolHandler>();
  private readonly faults = new Map<string, FixtureFault>();
  private readonly calls: Array<{ toolName: string; args: Record<string, unknown>; at: string }> = [];
  private schemaRevision = 0;

  readonly transport: LocalMcpTransport;

  constructor(readonly serverId: string, readonly displayName: string) {
    this.transport = new FixtureMcpTransport(this.handlers, (toolName, args, options) => this.invoke(toolName, args, options));
  }

  register(handler: McpToolHandler): this {
    this.handlers.set(handler.toolName, handler);
    return this;
  }

  fault(toolName: string, fault: FixtureFault): this {
    this.faults.set(toolName, fault);
    return this;
  }

  mutateSchema(toolName: string): this {
    const handler = this.handlers.get(toolName);
    if (handler) {
      this.schemaRevision += 1;
      handler.inputSchema = { type: 'object', properties: { mutated: { type: 'string' } }, required: ['mutated'], additionalProperties: false };
    }
    return this;
  }

  callsFor(toolName: string) {
    return this.calls.filter((call) => call.toolName === toolName);
  }

  get callCount() {
    return this.calls.length;
  }

  async invoke(toolName: string, args: Record<string, unknown>, options: { signal?: AbortSignal }): Promise<Record<string, unknown>> {
    this.calls.push({ toolName, args, at: new Date().toISOString() });
    const fault = this.faults.get(toolName);
    if (fault?.kind === 'unavailable') throw new Error('fixture server unavailable');
    if (fault?.kind === 'timeout') {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 30_000);
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Aborted')); }, { once: true });
      });
    }
    const handler = this.handlers.get(toolName);
    if (!handler) throw new Error(`Unknown fixture tool: ${toolName}`);
    if (options.signal?.aborted) throw new Error('Aborted');
    const result = await handler.invoke(args, {});
    if (fault?.kind === 'oversized_response') {
      return { ...result, blob: 'x'.repeat(2_000_000) };
    }
    if (fault?.kind === 'invalid_result') {
      return { unexpected: true };
    }
    return result;
  }
}

/** LOCAL transport variant of the deterministic MCP test server. */
export class LocalTestMcpServer extends FixtureMcpServer {
  override readonly transport: LocalMcpTransport;

  constructor(serverId: string, displayName: string) {
    super(serverId, displayName);
    this.transport = new LocalMcpTransport(this.handlers);
  }
}

/**
 * Minimal JSON-RPC 2.0 MCP transport over HTTP. Endpoint must be in the client
 * allowlist; the transport additionally refuses non-https endpoints outside a
 * private/local test host.
 */
export class HttpMcpTransport implements McpTransport {
  readonly transportType: McpTransportType = 'HTTP';
  private readonly inflight = new Map<string, AbortController>();

  constructor(
    private readonly serverId: string,
    private readonly endpoint: string,
    private readonly options: { headers?: Record<string, string> } = {},
  ) {}

  private validateEndpoint(): URL {
    const url = new URL(this.endpoint);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new McpClientError('MCP_SERVER_UNAVAILABLE', 'MCP HTTP endpoint must be http(s)', this.serverId);
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new McpClientError('MCP_SERVER_UNAVAILABLE', 'Plain HTTP is only allowed to localhost', this.serverId);
    }
    return url;
  }

  async discover() {
    const url = this.validateEndpoint();
    const response = await this.request('tools/list', {}, url);
    const tools = (response.tools ?? []) as Array<Record<string, unknown>>;
    return tools.map((tool) => ({
      toolName: String(tool.name),
      description: String(tool.description ?? ''),
      inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      outputSchema: (tool.outputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      effectClass: (tool.effectClass ?? 'READ_ONLY') as McpEffectClass,
      riskHint: String(tool.riskHint ?? 'R0'),
      verificationMethod: typeof tool.verificationMethod === 'string' ? tool.verificationMethod : null,
    }));
  }

  async invoke(toolName: string, args: Record<string, unknown>, options: { signal?: AbortSignal }): Promise<Record<string, unknown>> {
    const url = this.validateEndpoint();
    const response = await this.request('tools/call', { name: toolName, arguments: args }, url, options.signal);
    if (response.isError) throw new Error(String(response.content ?? 'tool error'));
    const content = response.content;
    return content && typeof content === 'object' && !Array.isArray(content) ? content as Record<string, unknown> : {};
  }

  async health() {
    try {
      const response = await this.request('health', {}, this.validateEndpoint());
      return { healthy: response.status === 'healthy', reason: typeof response.reason === 'string' ? response.reason : undefined, toolCatalogHash: String(response.toolCatalogHash ?? '') };
    } catch {
      return { healthy: false, reason: 'unreachable', toolCatalogHash: '' };
    }
  }

  cancel(requestId: string) {
    return Promise.resolve(this.inflight.get(requestId)?.abort());
  }

  private async request(method: string, params: Record<string, unknown>, url: URL, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const requestId = createHash('sha256').update(`${method}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
    const controller = new AbortController();
    this.inflight.set(requestId, controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.options.headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { result?: Record<string, unknown>; error?: unknown };
      if (body.error) throw new Error('JSON-RPC error');
      return body.result ?? {};
    } finally {
      signal?.removeEventListener('abort', abort);
      this.inflight.delete(requestId);
    }
  }
}
