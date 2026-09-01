import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ContentService } from './content.service';
import { CreateMasterContentDto, ListPlatformVariantsDto } from './dto';

@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Post('master-contents')
  createMasterContent(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateMasterContentDto) {
    return this.content.createMasterContent(user.id, input);
  }

  @Get('master-contents')
  listMasterContents(@CurrentUser() user: AuthenticatedUser) {
    return this.content.listMasterContents(user.id);
  }

  @Get('platform-variants')
  listPlatformVariants(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPlatformVariantsDto) {
    return this.content.listPlatformVariants(user.id, query);
  }
}
