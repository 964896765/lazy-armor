import { describe, expect, it, vi, afterEach } from 'vitest';
import { PasswordResetDeliveryService } from '../src/auth/password-reset-delivery.service';

describe('PasswordResetDeliveryService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails closed when no secure delivery gateway is configured', async () => {
    const config = { get: vi.fn(() => undefined) };
    const service = new PasswordResetDeliveryService(config as never);

    await expect(service.deliver({
      email: 'person@example.com',
      token: 'a'.repeat(64),
      expiresAt: new Date('2026-09-04T00:00:00.000Z'),
    })).resolves.toBe('unavailable');
  });

  it('delivers a deep-link reset URL only through the configured gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      get: (key: string) => ({
        PASSWORD_RESET_DELIVERY_ENDPOINT: 'https://notify.lazyarmor.example/v1/messages',
        PASSWORD_RESET_DELIVERY_TOKEN: 's'.repeat(48),
      })[key],
    };
    const service = new PasswordResetDeliveryService(config as never);

    await expect(service.deliver({
      email: 'person@example.com',
      token: 'a'.repeat(64),
      expiresAt: new Date('2026-09-04T00:00:00.000Z'),
    })).resolves.toBe('delivered');

    expect(fetchMock).toHaveBeenCalledWith('https://notify.lazyarmor.example/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: `Bearer ${'s'.repeat(48)}` }),
    }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      recipientEmail: 'person@example.com',
      resetUrl: `lazyarmor://auth/reset-password?token=${'a'.repeat(64)}`,
    });
  });

  it('does not issue a token when the delivery gateway rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const config = {
      get: (key: string) => ({
        PASSWORD_RESET_DELIVERY_ENDPOINT: 'https://notify.lazyarmor.example/v1/messages',
        PASSWORD_RESET_DELIVERY_TOKEN: 's'.repeat(48),
      })[key],
    };
    const service = new PasswordResetDeliveryService(config as never);

    await expect(service.deliver({
      email: 'person@example.com',
      token: 'a'.repeat(64),
      expiresAt: new Date('2026-09-04T00:00:00.000Z'),
    })).resolves.toBe('failed');
  });
});
