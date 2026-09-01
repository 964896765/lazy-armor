import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { PermissionsService } from '../permissions/permissions.service';
import { ConnectionsService } from './connections.service';
import {
  CompleteOAuthConnectionDto,
  CreateConnectionDto,
  InvokeConnectorDto,
  RotateConnectionCredentialsDto,
  StartOAuthConnectionDto,
  UpdatePermissionsDto,
  WebhookEventDto,
} from './dto';
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
  @Post('oauth/:provider/start') startOAuth(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string, @Body() input: StartOAuthConnectionDto) { return this.connections.startOAuth(user.id, provider, input); }
  @Post('oauth/:provider/callback') completeOAuth(@CurrentUser() user: AuthenticatedUser, @Param('provider') provider: string, @Body() input: CompleteOAuthConnectionDto) { return this.connections.completeOAuth(user.id, provider, input); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.connections.get(user.id, id); }
  @Delete(':id') @HttpCode(204) revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.connections.revoke(user.id, id); }
  @Post(':id/validate') validate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.connections.validate(user.id, id); }
  @Post(':id/reconnect') reconnect(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: StartOAuthConnectionDto) { return this.connections.reconnect(user.id, id, input); }
  @Post(':id/credentials/rotate') rotateCredentials(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: RotateConnectionCredentialsDto) { return this.connections.rotateCredentials(user.id, id, input); }
  @Post(':id/invoke') async invoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: InvokeConnectorDto) {
    const result = await this.connections.invoke(user.id, id, input);
    return result.data;
  }
  @Get(':id/permissions') listPermissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.permissions.list(user.id, id); }
  @Put(':id/permissions') updatePermissions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: UpdatePermissionsDto) { return this.permissions.update(user.id, id, input.permissions); }
  @Post(':id/webhook-events') webhook(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: WebhookEventDto) { return this.webhooks.receive(user.id, id, input); }
}
