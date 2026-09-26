import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  search(@CurrentUser() user: AuthenticatedUser, @Query('q') query?: string) {
    return this.service.search(user.id, query ?? '');
  }
}
