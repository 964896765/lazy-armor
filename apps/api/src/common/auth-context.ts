import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type UserRole = 'user' | 'super_admin' | 'operations_readonly';

export interface AuthenticatedUser {
  id: string;
  status: 'active' | 'disabled';
  role: UserRole;
  // Set only by server-side JWT/session validation, never by a request body.
  sessionId?: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
