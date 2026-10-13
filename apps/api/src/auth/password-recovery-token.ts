import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';

const contextSchema = z.object({
  version: z.literal(2),
  userId: z.uuid(),
  source: z.object({ kind: z.enum(['identifier','legacy']), id: z.uuid(), epoch: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  passwordEpoch: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive().safe(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export type RecoveryContext = z.infer<typeof contextSchema>;
const aad = Buffer.from('lazyarmor:password-recovery:v2');
const key = (secret:string) => Buffer.from(hkdfSync('sha256',secret,'lazyarmor-auth-recovery-v2','opaque-reset-token',32));

// A pre-V2 reader hashes a bearer with plain SHA-256. Separate the SQL lookup
// domain so it cannot find and consume a V2 row while ignoring its frozen context.
export function recoveryTokenHash(secret:string,raw:string) {
  return createHmac('sha256',secret).update('lazyarmor:password-recovery:v2:sql-token:').update(raw).digest('hex');
}

// The URL contains an authenticated ciphertext, never an email, password/hash,
// credential version or User ID. SQL separately owns expiry and single use.
export function encodeRecoveryToken(secret:string,context:Omit<RecoveryContext,'version'|'nonce'>) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key(secret),iv);
  cipher.setAAD(aad);
  const body = contextSchema.parse({...context,version:2,nonce:randomBytes(32).toString('base64url')});
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(body),'utf8'),cipher.final()]);
  return ['v2',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
}
export function decodeRecoveryToken(secret:string,raw:string):RecoveryContext {
  try {
    if(raw.length>1024) throw new Error();
    const [version,...segments] = raw.split('.');
    if(version!=='v2'||segments.length!==3||segments.some(value=>!value||!/^[A-Za-z0-9_-]+$/.test(value))) throw new Error();
    const [iv,encrypted,tag] = segments.map(value=>Buffer.from(value,'base64url'));
    if(iv.length!==12||tag.length!==16||segments.some((value,index)=>[iv,encrypted,tag][index].toString('base64url')!==value)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm',key(secret),iv);
    decipher.setAAD(aad); decipher.setAuthTag(tag);
    return contextSchema.parse(JSON.parse(Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8')));
  } catch { throw new Error('Invalid recovery token'); }
}
