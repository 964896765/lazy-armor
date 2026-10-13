import type { InjectedDatabase } from '../common/database.module';

export type AuthTransaction = Parameters<Parameters<InjectedDatabase['transaction']>[0]>[0];

function retryable(error: unknown): boolean {
  for (let depth = 0; error && typeof error === 'object' && depth < 5; depth++) {
    const item = error as { code?: string; cause?: unknown };
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY'].includes(item.code ?? '')) return true;
    error = item.cause;
  }
  return false;
}

// Only database work belongs here. Delivery, bcrypt, JWT response publication
// and external actions must remain outside a retryable transaction.
export async function authTransaction<T>(db: InjectedDatabase, work: (tx: AuthTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(work, { isolationLevel: 'repeatable read' }); }
    catch (error) {
      if (attempt >= 2 || !retryable(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
