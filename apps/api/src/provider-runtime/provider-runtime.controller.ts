import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CurrentUser, Roles, type AuthenticatedUser } from '../common/auth-context';
import { ProviderRuntimeService } from './provider-runtime.service';
@Roles('super_admin', 'operations_readonly')
@Controller('provider-runtime/policies')
export class ProviderRuntimeController {
  constructor(private readonly service: ProviderRuntimeService) {}
  @Get() list() { return this.service.list(); }
  @Get(':providerKey') get(@Param('providerKey') key: string) { return this.service.get(key); }
  @Get(':providerKey/revisions/:revision') revision(@Param('providerKey') key: string, @Param('revision', ParseIntPipe) revision: number) { return this.service.get(key, revision); }
}
@Controller('connections')
export class ConnectionProviderRuntimeController {
  constructor(private readonly service: ProviderRuntimeService) {}
  @Get(':id/provider-runtime') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.service.connectionView(user.id, id); }
}
