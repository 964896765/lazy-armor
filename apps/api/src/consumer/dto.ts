import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';
export class ConfirmActionProposalDto { @IsUUID() messageId!: string; @IsInt() @Min(0) version!: number; @IsBoolean() confirmed!: boolean; }
export class AttachArtifactDto { @IsUUID() artifactId!: string; @IsString() @Length(1,100) requestId!: string; }
export class RunConversationOnceDto { @IsUUID() planId!: string; @IsUUID() planVersionId!: string; @IsString() @Length(1, 100) requestId!: string; @IsObject() triggerPayload!: Record<string, unknown>; @IsBoolean() confirmed!: boolean; }
export class CreateConversationDto { @IsOptional() @IsString() @MaxLength(160) productTemplateKey?: string; @IsIn(['TEMPORARY', 'PLAN']) mode!: 'TEMPORARY' | 'PLAN'; @IsOptional() @IsString() @MaxLength(120) templateKey?: string; @IsOptional() @IsString() @MaxLength(120) scenarioKey?: string; @IsOptional() @IsUUID() draftId?: string; @IsOptional() @IsUUID() planId?: string; @IsOptional() @IsUUID() serviceOfferingId?: string; @IsOptional() @IsUUID() externalServiceId?: string; @IsOptional() @IsUUID() externalReferenceId?:string; @IsOptional() @IsString() @MaxLength(160) title?: string; }
export class ConversationMessageDto { @IsString() @Length(1, 12000) content!: string; @IsString() @Length(1, 100) requestId!: string; @IsInt() @Min(0) version!: number; @IsOptional() @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsUUID(undefined, { each: true }) attachmentIds?: string[]; }
export class ConversationAttachmentDto { @IsString() @Length(1, 160) fileName!: string; @IsIn(['text/plain', 'text/markdown', 'text/csv', 'application/json']) mimeType!: string; @IsString() @Length(1, 64000) contentBase64!: string; @IsString() @Length(1, 100) requestId!: string; }
export class ConfirmConversationPlanDto { @IsInt() @Min(0) version!: number; @IsBoolean() confirmed!: boolean; }
export class PromoteConversationDto { @IsInt() @Min(0) version!: number; }
export class ExternalServiceDto { @IsString() @Length(1, 160) title!: string; @IsString() @MaxLength(600) summary!: string; @IsString() @Length(1, 2000) sourceUrl!: string; @IsString() @Length(1, 100) sourcePlatform!: string; @IsOptional() @IsString() @Length(1, 40) category?: string; @IsOptional() @IsIn(['life','family','travel','health','work','other']) domain?: 'life'|'family'|'travel'|'health'|'work'|'other'; @IsIn(['SHARE', 'LINK', 'MANUAL']) importMethod!: string; @IsOptional() @IsString() @MaxLength(160) providerName?: string; @IsOptional() @IsString() @MaxLength(100) priceSnapshot?: string; }
export class ServiceRequestDto { @IsUUID() offeringId!: string; @IsString() @Length(1, 100) requestId!: string; @IsISO8601({ strict: true }) scheduledAt!: string; @IsString() @Length(1, 600) address!: string; @IsString() @MaxLength(600) requirement!: string; @IsString() @Length(1, 160) contact!: string; @IsBoolean() confirmed!: boolean; }
export class RequestTransitionDto { @IsIn(['BOOKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) status!: string; @IsInt() @Min(1) version!: number; }

export class SaveConversationDraftInputDto { @IsInt() @Min(0) version!: number; @IsString() @Length(1, 12000) content!: string; }

export class UpdateConversationHistoryDto { @IsInt() @Min(0) version!: number; @IsIn(['PIN', 'UNPIN', 'RENAME', 'ARCHIVE', 'DELETE']) action!: 'PIN' | 'UNPIN' | 'RENAME' | 'ARCHIVE' | 'DELETE'; @IsOptional() @IsString() @Length(1, 160) title?: string; }


export class ExternalReferenceDto extends ExternalServiceDto {
 @IsIn(['SERVICE','PRODUCT','PLACE','CONTENT','OTHER','DOCUMENT','EVENT']) kind!: 'SERVICE'|'PRODUCT'|'PLACE'|'CONTENT'|'OTHER'|'DOCUMENT'|'EVENT';
 @IsOptional() @IsString() @MaxLength(12000) rawText?: string;
 @IsOptional() @IsIn(['text/plain','text/html']) mimeType?: 'text/plain'|'text/html';
 @IsOptional() @IsUUID() evidenceArtifactId?: string;
}

export class ChangeUserEventDto {
 @IsInt() @Min(1) version!: number;
 @IsIn(['EDIT', 'POSTPONE', 'COMPLETE', 'CANCEL']) action!: 'EDIT' | 'POSTPONE' | 'COMPLETE' | 'CANCEL';
 @IsOptional() @IsObject() event?: Record<string, unknown>;
}
export class ProposeUserEventSyncChangeDto {
 @IsInt() @Min(1) version!: number;
}
