import { ApiError } from './api';
import { ConsumerPresentationMapper } from './consumer-presentation';

export function authError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'SMS_CODE_COOLDOWN') return `请在 ${Math.max(1,Math.ceil((error.retryAfterMs??60000)/1000))} 秒后再获取短信验证码。`;
    if (error.code === 'SMS_CODE_DAILY_LIMIT') return '今日短信验证次数已达上限，请使用邮箱或密码。';
    if (error.code === 'SMS_CODE_CHANNEL_LIMIT' || error.code === 'SMS_CODE_UNAVAILABLE') return '短信验证暂时不可用，请选择邮箱或密码登录。';
    if (error.code === 'SMS_CODE_DELIVERY_FAILED') return '短信请求未能确认，请稍后重试，也可使用邮箱或密码。';
    if (error.code === 'RATE_LIMIT_SERVICE_UNAVAILABLE' || error.code === 'LOGIN_CODE_SERVICE_UNAVAILABLE') return '验证服务暂不可用，请稍后重试。';
    if (error.code === 'PASSWORD_RECOVERY_EXPIRED') return '恢复链接已失效。链接过期、重新申请或账号安全信息变化后，请重新申请。';
    if (error.code === 'EMAIL_BIND_PROOF_EXPIRED' || error.code === 'PHONE_BIND_PROOF_EXPIRED') return '账号验证已失效。会话更新、密码变更或验证过期后，请重新开始绑定。';
    if (error.code === 'PHONE_BIND_OCCUPIED') return '该手机号已有关联账号，请使用其他手机号。账号不会自动合并。';
    if (error.code === 'EMAIL_BIND_OCCUPIED') return '该邮箱已有关联账号，请使用其他邮箱。账号不会自动合并。';
    if (error.code === 'EMAIL_PROOF_REQUIRED') return '此邮箱已有密码账号。请使用原密码登录，在账号与验证中验证邮箱后，即可使用验证码登录。';
    if (error.code === 'IDENTITY_CONFLICT') return '此邮箱存在历史账号冲突，请联系支持核对。你的原账号数据会保留。';
    if (error.status === 401) return '验证失败，请检查密码或验证码，并确认验证码尚未过期。';
    if (error.status === 429) return '操作过于频繁，请稍后重试。';
    if (error.status === 400 && error.message.includes('密码过长')) return '密码过长，请缩短后重试。中文等字符会占用更多长度。';
    if (error.status === 409 || error.status === 403) return error.message;
  }
  return ConsumerPresentationMapper.error(error);
}

export function authRetryLabel(seconds:number) {
  if(seconds>=3600)return `约 ${Math.ceil(seconds/3600)} 小时后重试`;
  if(seconds>120)return `${Math.ceil(seconds/60)} 分钟后重试`;
  return `${seconds} 秒后重试`;
}
