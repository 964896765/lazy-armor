import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { GetStudyProgressDto, ListStudyTasksDto, UpdateStudyProgressDto } from './dto';
import { StudyService } from './study.service';

@Controller()
export class StudyController {
  constructor(private readonly study: StudyService) {}

  @Get('study-progress')
  getProgress(@CurrentUser() user: AuthenticatedUser, @Query() query: GetStudyProgressDto) {
    return this.study.getProgress(user.id, query.planId);
  }

  @Post('study-progress')
  updateProgress(@CurrentUser() user: AuthenticatedUser, @Body() input: UpdateStudyProgressDto) {
    return this.study.updateProgress(user.id, input);
  }

  @Get('study-tasks')
  listTasks(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStudyTasksDto) {
    return this.study.listTasks(user.id, query.planId, query.studyDate);
  }
}
