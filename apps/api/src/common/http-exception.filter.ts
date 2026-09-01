import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

// 生产错误边界：统一业务错误码 + 安全文案，绝不返回 stack/SQL/路径/凭据。
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const safe = this.toSafeBody(exception, status);

    // 内部细节只进受控日志，不回传客户端。
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.message : 'Internal server error');

    response.status(status).json(safe);
  }

  private toSafeBody(exception: unknown, status: number): {
    statusCode: number;
    code: string;
    message: string;
    category?: string;
    retryable?: boolean;
    retryAfterMs?: number | null;
    providerCode?: string | null;
    operationState?: string | null;
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
      const detail = typeof res === 'object' && res !== null ? res as Record<string, unknown> : null;
      return {
        statusCode: status,
        code: typeof detail?.code === 'string' ? detail.code : this.codeForStatus(status),
        message: this.firstMessage(message),
        category: typeof detail?.category === 'string' ? detail.category : undefined,
        retryable: typeof detail?.retryable === 'boolean' ? detail.retryable : undefined,
        retryAfterMs: typeof detail?.retryAfterMs === 'number' ? detail.retryAfterMs : undefined,
        providerCode: typeof detail?.providerCode === 'string' ? detail.providerCode : undefined,
        operationState: typeof detail?.operationState === 'string' ? detail.operationState : undefined,
      };
    }
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }

  private firstMessage(message: string | string[]): string {
    if (Array.isArray(message)) return message[0] ?? 'Request failed';
    return message;
  }

  private codeForStatus(status: number): string {
    if (status === 400) return 'BAD_REQUEST';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 422) return 'VALIDATION_FAILED';
    if (status === 429) return 'RATE_LIMITED';
    return 'INTERNAL_ERROR';
  }
}
