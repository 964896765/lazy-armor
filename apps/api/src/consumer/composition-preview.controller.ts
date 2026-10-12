import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsObject, IsString, Length } from 'class-validator';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CompositionPreviewService } from './composition-preview.service';
import { CompositionAuthoringService } from './composition-authoring.service';
import { CompositionReportResourcesService } from './composition-report-resources.service';
class CompositionPreviewDto { @IsObject() graph!: Record<string, unknown> }
class CompositionAuthoringDto { @IsString() @Length(1, 100) requestId!: string; @IsObject() selection!: Record<string, unknown> }
@Controller('conversations')
export class CompositionPreviewController {
  constructor(private readonly composition: CompositionPreviewService, private readonly authoring: CompositionAuthoringService, private readonly resources: CompositionReportResourcesService) {}
  @Get(':id/composition-resources') resourcesForReport(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.resources.options(user.id, id);
  }
  @Get(':id/composition-options') options(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.composition.options(user.id, id);
  }
  @Post(':id/composition-preview') preview(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: CompositionPreviewDto) {
    return this.composition.preview(user.id, id, input.graph);
  }
  @Post(':id/composition-authoring') prepare(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: CompositionAuthoringDto) {
    return this.authoring.submit(user.id, id, input.requestId, input.selection);
  }
}
