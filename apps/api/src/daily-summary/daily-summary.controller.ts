import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CreateImportantItemCandidateDto, ListImportantItemCandidatesDto } from './dto';
import { DailySummaryService } from './daily-summary.service';

@Controller('important-item-candidates')
export class DailySummaryController {
  constructor(private readonly dailySummary: DailySummaryService) {}

  @Post()
  createCandidate(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateImportantItemCandidateDto) {
    return this.dailySummary.createCandidate(user.id, input);
  }

  @Get()
  listCandidates(@CurrentUser() user: AuthenticatedUser, @Query() query: ListImportantItemCandidatesDto) {
    return this.dailySummary.listCandidates(user.id, query.sourceType);
  }
}
