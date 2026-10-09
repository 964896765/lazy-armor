import { UserEventSyncLaunchService } from '../execution/user-event-sync-launch.service';
import { GoalResourceMatchService } from './goal-resource-match.service';
import { GoalPageReadService } from './goal-page-read.service';
import { ConfirmGoalPageReadDto } from './goal-page-read.dto';
import { GoalResourceMatchQueryDto } from './goal-resource-match.dto';
import { UserEventsService } from '../profiles/user-events.service';
import { ChangeUserEventDto, ProposeUserEventSyncChangeDto } from './dto';
import { ExternalReferenceDto } from './dto';
import { CalendarProjectionService } from './calendar-projection.service';
import {NativeCapabilitiesDto} from './local-capabilities.dto';
import {LocalCapabilitiesService} from './local-capabilities.service';
import {Headers, Req} from '@nestjs/common';
import type {Request} from 'express';
import type {IncomingHttpHeaders} from 'node:http';
import {TrustedDevicesService} from '../trusted-devices/trusted-devices.service';
import {LocalAcquisitionService} from './local-acquisition.service';
import {LocalAcquisitionDto} from './local-acquisition.dto';
import { WorkItemProjectionService } from './work-item-projection.service';
import { CANONICAL_PRODUCT_CATALOG } from '@lazy-armor/plan-schema';
import { Public } from '../common/auth-context';
import { ConversationOnceService } from './conversation-once.service';
import { AttachArtifactDto, ConfirmActionProposalDto } from './dto';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ConsumerService } from './consumer.service';
import { UpdateConversationHistoryDto, SaveConversationDraftInputDto, ConversationAttachmentDto, RunConversationOnceDto, CreateConversationDto, ConversationMessageDto, ConfirmConversationPlanDto, PromoteConversationDto, ExternalServiceDto, ServiceRequestDto, RequestTransitionDto } from './dto';
@Controller()
export class ConsumerController {
 constructor(private readonly pageRead: GoalPageReadService, private readonly resourceMatch:GoalResourceMatchService, private readonly syncLaunch:UserEventSyncLaunchService, private readonly calendarProjection: CalendarProjectionService, private readonly localCapabilities:LocalCapabilitiesService, private readonly consumer: ConsumerService, private readonly once: ConversationOnceService,private readonly workItems:WorkItemProjectionService,private readonly localAcquisition:LocalAcquisitionService,private readonly trustedDevices:TrustedDevicesService, private readonly userEvents: UserEventsService) {}
 @Get('consumer/acquisition-coverage') coverage(@CurrentUser() user:AuthenticatedUser){return this.localAcquisition.coverage(user.id);}
 @Post('consumer/local-acquisition') async localRead(@CurrentUser() user:AuthenticatedUser,@Body() input:LocalAcquisitionDto,@Req() request:Request,@Headers() headers:IncomingHttpHeaders){const h=(name:string)=>{const v=headers[name];return Array.isArray(v)?v[0]??'':v??'';};const proof={sessionId:h('x-device-session'),requestId:h('x-device-request-id'),signedAt:h('x-device-signed-at'),payloadHash:h('x-device-payload-hash'),signature:h('x-device-signature')};const signed=await this.trustedDevices.assertSignedRequest(user.id,proof,'POST','/consumer/local-acquisition',request.body);return this.localAcquisition.receive(user.id,signed.trustedDeviceId,proof.requestId,input);}
 @Get('consumer/calendar') calendar(@CurrentUser() user:AuthenticatedUser,@Query('month') month:string,@Query('timezone') timezone='Asia/Shanghai'){return this.calendarProjection.month(user.id,month,timezone);}
 @Get('consumer/work-items') work(@CurrentUser() user:AuthenticatedUser){return this.workItems.project(user.id);}
 @Get('timeline') timeline(@CurrentUser() user: AuthenticatedUser, @Query('date') date: string, @Query('timezone') timezone = 'Asia/Shanghai') { return this.consumer.timeline(user.id, date, timezone); }
 @Public()
 @Get('consumer/plan-catalog') catalog() { return CANONICAL_PRODUCT_CATALOG; }
 @Get('plan-library') plans(@CurrentUser() user: AuthenticatedUser) { return this.consumer.planLibrary(user.id); }
 @Get('consumer/run-once-options') onceOptions(@CurrentUser() user: AuthenticatedUser) { return this.once.options(user.id); }
 @Post('consumer/local-capabilities') async localManifest(@CurrentUser() user:AuthenticatedUser,@Body() input:NativeCapabilitiesDto,@Req() request:Request,@Headers() headers:IncomingHttpHeaders){
  const proof=this.deviceProof(headers);const signed=await this.trustedDevices.assertSignedRequest(user.id,proof,'POST','/consumer/local-capabilities',request.body);
  return this.localCapabilities.receive(user.id,signed.trustedDeviceId,proof.requestId,input);
 }
 private deviceProof(headers:IncomingHttpHeaders){const h=(name:string)=>{const v=headers[name];return Array.isArray(v)?v[0]??'':v??'';};return {sessionId:h('x-device-session'),requestId:h('x-device-request-id'),signedAt:h('x-device-signed-at'),payloadHash:h('x-device-payload-hash'),signature:h('x-device-signature')};}
 @Get('consumer/resources') async resources(@CurrentUser() user:AuthenticatedUser,@Headers() headers:IncomingHttpHeaders){
  const current=headers['x-device-session']?await this.trustedDevices.assertSignedRequest(user.id,this.deviceProof(headers),'GET','/consumer/resources',{}):null;
  const [resources,local]=await Promise.all([this.consumer.resources(user.id,current?.trustedDeviceId,current?.deviceId),this.localCapabilities.project(user.id,current?.trustedDeviceId)]);
  return [...resources, ...local];
 }
 @Get('conversations') conversations(@CurrentUser() user: AuthenticatedUser) { return this.consumer.conversations(user.id); }
 @Post('conversations') createConversation(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateConversationDto) { return this.consumer.createConversation(user.id, input); }
 @Post('conversations/:id/history') updateHistory(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateConversationHistoryDto) { return this.consumer.updateConversationHistory(user.id, id, input); }
 @Get('conversations/archived') archivedConversations(@CurrentUser() user: AuthenticatedUser) { return this.consumer.archivedConversations(user.id); }
 @Get('conversations/:id/messages/:messageId/resources') goalResources(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) messageId:string,@Query() input:GoalResourceMatchQueryDto){return this.resourceMatch.match(user.id,id,messageId,input.version);}
 @Post('conversations/:id/messages/:messageId/page-read/confirm') async confirmPageRead(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string,@Param('messageId',ParseUUIDPipe) messageId:string,@Body() input:ConfirmGoalPageReadDto,@Headers() headers:IncomingHttpHeaders){
  const signed=await this.trustedDevices.assertSignedRequest(user.id,this.deviceProof(headers),'POST',`/conversations/${id}/messages/${messageId}/page-read/confirm`,input);
  return this.pageRead.confirm(user.id,id,messageId,input,signed.trustedDeviceId);
 }
 @Get('conversations/:id') conversation(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.consumer.conversation(user.id, id); }
 @Post('conversations/:id/attachments') attach(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConversationAttachmentDto) { return this.consumer.attach(user.id, id, input); }
 @Post('conversations/:id/artifact-attachments') attachArtifact(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: AttachArtifactDto) { return this.consumer.attachArtifact(user.id,id,input); }
 @Post('conversations/:id/run-once') runOnce(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: RunConversationOnceDto) { return this.once.run(user.id, id, input); }
 @Post('conversations/:id/confirm-action') confirmAction(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConfirmActionProposalDto) { return this.once.confirmProposal(user.id, id, input); }
 @Get('conversations/:id/once-requests') onceRequests(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.once.list(user.id, id); }
 @Get('once-requests/:id') onceRequest(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.once.get(user.id, id); }
 @Put('conversations/:id/draft-input') saveDraftInput(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: SaveConversationDraftInputDto) { return this.consumer.saveDraftInput(user.id, id, input); }
 @Post('conversations/:id/messages') message(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConversationMessageDto) { return this.consumer.message(user.id, id, input); }
 @Get('external-references') references(@CurrentUser() user:AuthenticatedUser){return this.consumer.externalList(user.id,true);}
 @Get('external-references/:id') reference(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string){return this.consumer.externalGet(user.id,id);}
 @Post('external-references') createReference(@CurrentUser() user:AuthenticatedUser,@Body() input:ExternalReferenceDto){return this.consumer.externalCreate(user.id,input);}
 @Delete('external-references/:id') deleteReference(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string){return this.consumer.externalRemove(user.id,id);}
 @Get('external-services') external(@CurrentUser() user: AuthenticatedUser) { return this.consumer.externalList(user.id); }
 @Get('external-services/:id') externalDetail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.consumer.externalGet(user.id, id); }
 @Get('user-events/:id/external-sync') eventSyncStatus(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string){return this.syncLaunch.summaries(user.id,id);}
 @Post('user-events/:id/external-sync/:requestId/start') startEventSync(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string,@Param('requestId',ParseUUIDPipe) requestId:string){return this.syncLaunch.start(user.id,id,requestId);}
 @Post('user-events/:id/external-sync/:requestId/propose-change') proposeEventSyncChange(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string,@Param('requestId',ParseUUIDPipe) requestId:string,@Body() input:ProposeUserEventSyncChangeDto){return this.syncLaunch.proposeMutation(user.id,id,requestId,input.version);}
 @Post('user-events/:id/external-sync/confirm-change') confirmEventSyncChange(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string,@Body() input:ConfirmActionProposalDto){return this.syncLaunch.confirmMutation(user.id,id,input);}
 @Post('conversations/:id/confirm-user-event') confirmEvent(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string,@Body() input:ConfirmActionProposalDto){return this.consumer.confirmUserEvent(user.id,id,input);}
 @Get('user-events') userEventList(@CurrentUser() user:AuthenticatedUser){return this.userEvents.list(user.id);}
 @Get('user-events/:id') userEvent(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string){return this.userEvents.get(user.id,id);}
 @Post('user-events/:id/lifecycle') changeEvent(@CurrentUser() user:AuthenticatedUser,@Param('id',ParseUUIDPipe) id:string,@Body() input:ChangeUserEventDto){return this.userEvents.change(user.id,id,input);}
 @Post('conversations/:id/confirm-plan') confirmPlan(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConfirmConversationPlanDto) { return this.consumer.confirmPlan(user.id, id, input); }
 @Post('conversations/:id/promote') promote(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: PromoteConversationDto) { return this.consumer.promoteConversation(user.id, id, input); }
 @Post('external-services') createExternal(@CurrentUser() user: AuthenticatedUser, @Body() input: ExternalServiceDto) { return this.consumer.externalCreate(user.id, input); }
 @Delete('external-services/:id') removeExternal(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.consumer.externalRemove(user.id, id); }
 @Get('service-requests') requests(@CurrentUser() user: AuthenticatedUser, @Query('role') role?: string) { return this.consumer.requests(user.id, role); }
 @Post('service-requests') createRequest(@CurrentUser() user: AuthenticatedUser, @Body() input: ServiceRequestDto) { return this.consumer.requestCreate(user.id, input); }
 @Post('service-requests/:id/status') transition(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: RequestTransitionDto) { return this.consumer.transitionRequest(user.id, id, input); }
}
