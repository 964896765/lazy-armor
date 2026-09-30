import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreationDraftsService } from './creation-drafts.service';
import { SaveCreationDraftDto } from './dto';

@Controller('creation-drafts')
export class CreationDraftsController {
  constructor(private readonly drafts: CreationDraftsService) {}

  @Post()
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() request: SaveCreationDraftDto) {
    return this.drafts.upsert(user.id, request);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.drafts.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.get(user.id, id);
  }

  @Post(':id/resume')
  resume(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.resume(user.id, id);
  }

  @Delete(':id')
  discard(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.drafts.discard(user.id, id);
  }
}
