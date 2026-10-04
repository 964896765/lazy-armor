import { ConversationOnceService } from './conversation-once.service';
import { AttachArtifactDto, ConfirmActionProposalDto } from './dto';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ConsumerService } from './consumer.service';
import { SaveConversationDraftInputDto, ConversationAttachmentDto, RunConversationOnceDto, CreateConversationDto, ConversationMessageDto, ConfirmConversationPlanDto, PromoteConversationDto, ExternalServiceDto, ServiceRequestDto, RequestTransitionDto } from './dto';
@Controller()
export class ConsumerController {
 constructor(private readonly consumer: ConsumerService, private readonly once: ConversationOnceService) {}
 @Get('timeline') timeline(@CurrentUser() user: AuthenticatedUser, @Query('date') date: string, @Query('timezone') timezone = 'Asia/Shanghai') { return this.consumer.timeline(user.id, date, timezone); }
 @Get('plan-library') plans(@CurrentUser() user: AuthenticatedUser) { return this.consumer.planLibrary(user.id); }
 @Get('consumer/run-once-options') onceOptions(@CurrentUser() user: AuthenticatedUser) { return this.once.options(user.id); }
 @Get('consumer/resources') resources(@CurrentUser() user: AuthenticatedUser) { return this.consumer.resources(user.id); }
 @Get('conversations') conversations(@CurrentUser() user: AuthenticatedUser) { return this.consumer.conversations(user.id); }
 @Post('conversations') createConversation(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateConversationDto) { return this.consumer.createConversation(user.id, input); }
 @Get('conversations/:id') conversation(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.consumer.conversation(user.id, id); }
 @Post('conversations/:id/attachments') attach(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConversationAttachmentDto) { return this.consumer.attach(user.id, id, input); }
 @Post('conversations/:id/artifact-attachments') attachArtifact(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: AttachArtifactDto) { return this.consumer.attachArtifact(user.id,id,input); }
 @Post('conversations/:id/run-once') runOnce(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: RunConversationOnceDto) { return this.once.run(user.id, id, input); }
 @Post('conversations/:id/confirm-action') confirmAction(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConfirmActionProposalDto) { return this.once.confirmProposal(user.id, id, input); }
 @Get('conversations/:id/once-requests') onceRequests(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.once.list(user.id, id); }
 @Get('once-requests/:id') onceRequest(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.once.get(user.id, id); }
 @Put('conversations/:id/draft-input') saveDraftInput(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: SaveConversationDraftInputDto) { return this.consumer.saveDraftInput(user.id, id, input); }
 @Post('conversations/:id/messages') message(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConversationMessageDto) { return this.consumer.message(user.id, id, input); }
 @Get('external-services') external(@CurrentUser() user: AuthenticatedUser) { return this.consumer.externalList(user.id); }
 @Get('external-services/:id') externalDetail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.consumer.externalGet(user.id, id); }
 @Post('conversations/:id/confirm-plan') confirmPlan(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConfirmConversationPlanDto) { return this.consumer.confirmPlan(user.id, id, input); }
 @Post('conversations/:id/promote') promote(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: PromoteConversationDto) { return this.consumer.promoteConversation(user.id, id, input); }
 @Post('external-services') createExternal(@CurrentUser() user: AuthenticatedUser, @Body() input: ExternalServiceDto) { return this.consumer.externalCreate(user.id, input); }
 @Delete('external-services/:id') removeExternal(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.consumer.externalRemove(user.id, id); }
 @Get('service-requests') requests(@CurrentUser() user: AuthenticatedUser) { return this.consumer.requests(user.id); }
 @Post('service-requests') createRequest(@CurrentUser() user: AuthenticatedUser, @Body() input: ServiceRequestDto) { return this.consumer.requestCreate(user.id, input); }
 @Post('service-requests/:id/status') transition(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: RequestTransitionDto) { return this.consumer.transitionRequest(user.id, id, input); }
}
