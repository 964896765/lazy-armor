import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module';

// 构建共享 HTTP 应用（CORS 白名单 + 安全响应头 + 请求体上限 + 校验管道 + 优雅停机）。
export async function createHttpApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Base64 adds ~33% overhead. Only the authenticated local-file import path
  // receives the larger parser budget; every other API keeps the tighter cap.
  app.use('/api/file-imports', json({ limit: '1400kb' }));
  app.use(json({ limit: '256kb' }));
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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}
