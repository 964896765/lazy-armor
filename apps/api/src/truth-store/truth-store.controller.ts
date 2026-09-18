import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { TruthStoreService } from './truth-store.service';

@Controller('truth-records')
export class TruthStoreController {
  constructor(private readonly truthStore: TruthStoreService) {}

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.truthStore.get(user.id, id); }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('resource') resource?: string) {
    return this.truthStore.list(user.id, typeof resource === 'string' && resource.length > 0 && resource.length <= 120 ? resource : undefined);
  }
}
