export interface ConnectorAuthorizationContract {
  key: string;
  connectable: boolean;
  draftOnly: boolean;
  productionStatus: string;
  authentication: { type: string };
}

export interface ApiRequestContract {
  path: string;
  init?: RequestInit;
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export function connectionStartRequest(connector: ConnectorAuthorizationContract, redirectUri: string): ApiRequestContract | null {
  if (!connector.connectable || connector.draftOnly || connector.productionStatus === 'DISABLED') return null;
  if (connector.authentication.type !== 'oauth2') return null;
  return {
    path: `/connections/oauth/${encodeURIComponent(connector.key)}/start`,
    init: json('POST', { redirectUri }),
  };
}

export function oauthCallbackRequest(providerKey: string, code: string, state: string, redirectUri: string): ApiRequestContract {
  return {
    path: `/connections/oauth/${encodeURIComponent(providerKey)}/callback`,
    init: json('POST', { code, state, redirectUri }),
  };
}

export function reconnectRequest(connectionId: string, redirectUri: string): ApiRequestContract {
  return { path: `/connections/${encodeURIComponent(connectionId)}/reconnect`, init: json('POST', { redirectUri }) };
}

export function validateConnectionRequest(connectionId: string): ApiRequestContract {
  return { path: `/connections/${encodeURIComponent(connectionId)}/validate`, init: { method: 'POST' } };
}

export function permissionUpdateRequest(connectionId: string, capability: string, granted: boolean): ApiRequestContract {
  return {
    path: `/connections/${encodeURIComponent(connectionId)}/permissions`,
    init: json('PUT', { permissions: [{ capability, granted }] }),
  };
}

export function disconnectRequest(connectionId: string): ApiRequestContract {
  return { path: `/connections/${encodeURIComponent(connectionId)}`, init: { method: 'DELETE' } };
}

export function oauthFailureMessage(reason: string) {
  switch (reason) {
    case 'cancelled': return '你取消了连接，没有任何权限被授予。';
    case 'state_expired': return '这次连接已经过期，请重新连接。';
    case 'provider_denied': return '连接没有完成，请重新试一次。';
    case 'network': return '网络没有连通，你的账号没有被修改。';
    case 'reauthorization_required': return '这个账号需要重新登录。';
    default: return '连接没有完成，请重新试一次。';
  }
}
