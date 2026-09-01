import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type AuthenticatedUser } from '../common/auth-context';

// 服务端 RBAC：只有 @Roles(...) 声明的端点才校验角色；其余端点放行（由 AuthGuard 负责身份）。
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) throw new UnauthorizedException('Authentication required');
    if (!required.includes(request.user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
