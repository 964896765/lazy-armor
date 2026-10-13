import { ApiError } from './api';
import { ConsumerPresentationMapper } from './consumer-presentation';

export function authError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'EMAIL_BIND_PROOF_EXPIRED') return '账号验证已失效。会话更新、密码变更或验证过期后，请重新开始绑定。';
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
