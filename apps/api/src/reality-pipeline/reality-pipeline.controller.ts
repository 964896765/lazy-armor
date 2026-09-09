import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, Roles, type AuthenticatedUser } from '../common/auth-context';
import { CreateSourceObservationDto } from './dto';
import { RealityPipelineService } from './reality-pipeline.service';

@Controller()
export class RealityPipelineController {
  constructor(private readonly pipeline: RealityPipelineService) {}
  @Roles('super_admin') @Post('source-observations') ingest(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateSourceObservationDto) { return this.pipeline.ingest(user.id, input); }
  @Get('candidates/pending') pending(@CurrentUser() user: AuthenticatedUser) { return this.pipeline.listPending(user.id); }
  @Post('candidates/:id/confirm') confirm(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.pipeline.confirmCandidate(user.id, id); }
  @Post('candidates/:id/reject') reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.pipeline.rejectCandidate(user.id, id); }
  @Get('truth') listTruth(@CurrentUser() user: AuthenticatedUser) { return this.pipeline.listTruth(user.id); }
  @Get('truth/:id') truth(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.pipeline.truthResponse(user.id, id); }
}
