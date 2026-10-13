import { describe, expect, it, vi } from 'vitest';
vi.mock('./consumer-presentation',()=>({ConsumerPresentationMapper:{error:()=> 'fallback'}}));
import { ApiError } from './api';
import { authError, authRetryLabel } from './auth-error';
describe('SMS recovery guidance',()=>{
  it('uses the server cooldown without exposing gateway details',()=>{expect(authError(new ApiError(429,'SMS_CODE_COOLDOWN','private-gateway',12001))).toBe('请在 13 秒后再获取短信验证码。');});
  it.each(['SMS_CODE_DAILY_LIMIT','SMS_CODE_CHANNEL_LIMIT','SMS_CODE_UNAVAILABLE','SMS_CODE_DELIVERY_FAILED'])('provides alternate login for %s',code=>{expect(authError(new ApiError(429,code,'private-gateway'))).toMatch(/邮箱或密码/);});
  it('formats long daily waits without presenting tens of thousands of seconds',()=>{expect(authRetryLabel(60)).toBe('60 秒后重试');expect(authRetryLabel(300)).toBe('5 分钟后重试');expect(authRetryLabel(3601)).toBe('约 2 小时后重试');});
});
