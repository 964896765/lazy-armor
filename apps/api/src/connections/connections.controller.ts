import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { PermissionsService } from '../permissions/permissions.service';
import { ConnectionsService } from './connections.service';
import { CreateConnectionDto, RotateConnectionCredentialsDto, UpdatePermissionsDto, WebhookEventDto } from './dto';
import { WebhooksService } from './webhooks.service';

@Controller('connections')
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly permissions: PermissionsService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.connections.list(user.id); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateConnectionDto) { return this.connections.create(user.id, input); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.connections.get(user.id, id); }
  @Delete(':id') @HttpCode(204) revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.connections.revoke(user.id, id); }
  @Post(':id/validate') validate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.connections.validate(user.id, id); }
  @Post(':id/credentials/rotate') rotateCredentials(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: RotateConnectionCredentialsDto) { return this.connections.rotateCredentials(user.id, id, input); }
  @Get(':id/permissions') listPermissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.permissions.list(user.id, id); }
  @Put(':id/permissions') updatePermissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdatePermissionsDto) { return this.permissions.update(user.id, id, input.permissions); }
  @Post(':id/webhook-events') webhook(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: WebhookEventDto) { return this.webhooks.receive(user.id, id, input); }
}
