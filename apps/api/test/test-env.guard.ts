// §31 测试数据库隔离硬门禁：NODE_ENV=test 时拒绝连接非隔离库。
process.env.NODE_ENV = 'test';

const url = process.env.TEST_DATABASE_URL ?? 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor_test';
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.toLowerCase().includes('test')) {
  throw new Error(`Refusing to run tests against non-isolated database "${dbName}". Test database name must contain "test".`);
}
process.env.DATABASE_URL = url;

if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://127.0.0.1:6379';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret-that-is-longer-than-thirty-two-characters';
if (!process.env.CREDENTIAL_MASTER_KEY) process.env.CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 6).toString('base64');
