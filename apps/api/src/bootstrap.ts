import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { resolveCorrelationId, runWithRequestContext } from './common/request-context';
import { SafeLoggerService } from './common/safe-logger.service';
import { ObservabilityService } from './observability/observability.service';

type RequestWithRawBody = Request & { rawBody?: Buffer };
const captureRawBody = (req: Request, _res: Response, body: Buffer) => {
  (req as RequestWithRawBody).rawBody = Buffer.from(body);
};

// 构建共享 HTTP 应用（CORS 白名单 + 安全响应头 + 请求体上限 + 校验管道 + 优雅停机）。
export async function createHttpApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  const logger = app.get(SafeLoggerService);
  const telemetry = app.get(ObservabilityService);
  app.useLogger(logger);
  // Base64 adds ~33% overhead. Only the authenticated local-file import path
  // receives the larger parser budget; every other API keeps the tighter cap.
  app.use('/api/file-imports', json({ limit: '1400kb', verify: captureRawBody }));
  app.use(json({ limit: '256kb', verify: captureRawBody }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.setGlobalPrefix('api');
  // CORS：生产用 ALLOWED_ORIGINS 白名单；禁止 `*` + Credential。
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : (process.env.NODE_ENV === 'production' ? false : true),
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  // 安全响应头（无第三方依赖，避免供应链面扩大）。
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    next();
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const correlationId = resolveCorrelationId(req.header('x-correlation-id'));
    const requestId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    runWithRequestContext({ correlationId, requestId, method: req.method, routeTemplate: normalizeRouteTemplate(req) }, () => {
      res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        telemetry.increment('api.request_count', 1, { method: req.method, statusCode: String(res.statusCode) });
        telemetry.histogram('api.duration', durationMs, { method: req.method, statusCode: String(res.statusCode) });
        if (res.statusCode >= 400) telemetry.increment('api.error_count', 1, { method: req.method, statusCode: String(res.statusCode) });
        telemetry.event(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log', 'http_request_completed', {
          method: req.method,
          routeTemplate: normalizeRouteTemplate(req),
          statusCode: res.statusCode,
          durationMs,
        });
      });
      next();
    });
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}

function normalizeRouteTemplate(req: Request) {
  const route = typeof req.route?.path === 'string'
    ? `${req.baseUrl ?? ''}${req.route.path}`
    : (req.path || req.url || '/').split('?')[0];
  return route
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d{2,}(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:id');
}
