import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ReadEvidenceService } from './read-evidence.service';
import { StructuredReadService } from './structured-read.service';
import { StructuredReadRequestDto } from './dto';
import type { StructuredReadRequest } from '@lazy-armor/plan-schema';

@Controller('structured-reads')
export class StructuredReadController {
  constructor(
    private readonly structuredRead: StructuredReadService,
    private readonly evidence: ReadEvidenceService,
  ) {}

  @Post()
  async read(@CurrentUser() user: AuthenticatedUser, @Body() input: StructuredReadRequestDto) {
    const request = toStructuredReadRequest(user.id, input);
    if ((input.sourceType === 'FILE' || input.sourceType === 'PDF_PAGE') && input.content) {
      return this.structuredRead.readFile(user.id, request, Buffer.from(input.content, 'base64'), input.fileName ?? 'file', input.mimeType ?? 'application/octet-stream');
    }
    return this.structuredRead.structuredRead(user.id, request);
  }

  @Get('evidence')
  listEvidence(@CurrentUser() user: AuthenticatedUser) {
    return this.evidence.list(user.id);
  }
}

function toStructuredReadRequest(userId: string, input: StructuredReadRequestDto): StructuredReadRequest {
  return {
    requestId: input.requestId,
    userId,
    sourceType: input.sourceType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    providerKey: input.providerKey ?? null,
    connectionId: input.connectionId ?? null,
    deviceId: input.deviceId ?? null,
    packageName: input.packageName ?? null,
    appReadSessionId: input.appReadSessionId ?? null,
    pageRange: input.pageRange ?? null,
    structuredSelector: input.structuredSelector ?? null,
    resourceHint: input.resourceHint ?? null,
    requestedFields: input.requestedFields,
    fieldExpectations: input.fieldExpectations,
  };
}
