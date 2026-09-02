import { describe, expect, it } from 'vitest';
import {
  connectionStartRequest,
  disconnectRequest,
  oauthCallbackRequest,
  oauthFailureMessage,
  permissionUpdateRequest,
  reconnectRequest,
} from './connection-api-contract';

describe('P2 mobile OAuth request contract', () => {
  const gmail = {
    key: 'gmail', connectable: true, draftOnly: false, productionStatus: 'BETA', authentication: { type: 'oauth2' },
  };
  const callback = 'lazyarmor://oauth/callback?provider=gmail';

  it('uses the OAuth start and callback chain instead of legacy connection creation', () => {
    const start = connectionStartRequest(gmail, callback);
    expect(start).toEqual({
      path: '/connections/oauth/gmail/start',
      init: { method: 'POST', body: JSON.stringify({ redirectUri: callback }) },
    });
    expect(start?.path).not.toBe('/connections');
    expect(oauthCallbackRequest('gmail', 'code-1', 'server-state', callback)).toEqual({
      path: '/connections/oauth/gmail/callback',
      init: { method: 'POST', body: JSON.stringify({ code: 'code-1', state: 'server-state', redirectUri: callback }) },
    });
  });

  it('refuses to connect draft-only and non-OAuth providers through the legacy path', () => {
    expect(connectionStartRequest({ ...gmail, key: 'file_provider', draftOnly: true }, callback)).toBeNull();
    expect(connectionStartRequest({ ...gmail, key: 'logistics_provider', authentication: { type: 'api_key' } }, callback)).toBeNull();
  });

  it('covers permission revoke, reconnect, and disconnect contracts', () => {
    expect(permissionUpdateRequest('connection-1', 'READ_EMAIL', false).path).toBe('/connections/connection-1/permissions');
    expect(reconnectRequest('connection-1', callback).path).toBe('/connections/connection-1/reconnect');
    expect(disconnectRequest('connection-1')).toEqual({ path: '/connections/connection-1', init: { method: 'DELETE' } });
  });

  it('never leaks engineering errors into user-facing OAuth failures', () => {
    expect(oauthFailureMessage('cancelled')).toContain('没有任何权限');
    expect(oauthFailureMessage('state_expired')).toContain('已经过期');
    expect(oauthFailureMessage('provider_denied')).toContain('重新试一次');
    expect(oauthFailureMessage('network')).toContain('账号没有被修改');
    expect(oauthFailureMessage('reauthorization_required')).toContain('重新登录');
    expect(oauthFailureMessage('AUTH_REQUIRED')).not.toContain('AUTH_REQUIRED');
  });
});
