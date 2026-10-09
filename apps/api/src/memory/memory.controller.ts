import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/cursor-pagination';
import { ConfirmMemoryCandidateDto, CreateMemoryDto, CreateMemoryRelationDto, DeleteMemoryDto, EditMemoryDto, ListMemoryCandidatesDto, MemoryReferenceDto, MemorySettingsDto } from './dto';
import { MemoryGraphService } from './memory-graph.service';
import { MemoryCandidatesService } from './memory-candidates.service';
import { MemoryService } from './memory.service';
@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService, private readonly candidates: MemoryCandidatesService, private readonly graph: MemoryGraphService) {}
  @Get('settings') settings(@CurrentUser() user: AuthenticatedUser) { return this.memory.settings(user.id); }
  @Patch('settings') changeSettings(@CurrentUser() user: AuthenticatedUser, @Body() input: MemorySettingsDto) { return this.memory.changeSettings(user.id, input); }
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) { return this.memory.list(user.id, query); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateMemoryDto) { return this.memory.create(user.id, input); }
  @Get('candidates') candidatesList(@CurrentUser() user: AuthenticatedUser, @Query() input: ListMemoryCandidatesDto) { return this.candidates.list(user.id, input); }
  @Get('candidates/:id') candidate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.candidates.get(user.id, id); }
  @Post('candidates/:id/confirm') confirmCandidate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: ConfirmMemoryCandidateDto) { return this.candidates.confirm(user.id, id, input); }
  @Post('candidates/:id/dismiss') dismissCandidate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: DeleteMemoryDto) { return this.candidates.dismiss(user.id, id, input.version); }
  @Get(':id/reference') reference(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: MemoryReferenceDto) { return this.memory.reference(user.id, id, query.version); }
  @Get(':id/relations') relations(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: CursorPageDto) { return this.graph.list(user.id, id, query); }
  @Post(':id/relations') relate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: CreateMemoryRelationDto) { return this.graph.create(user.id, id, input); }
  @Delete('relations/:id') unrelate(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: DeleteMemoryDto) { return this.graph.remove(user.id, id, input.version); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.memory.get(user.id, id); }
  @Patch(':id') edit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: EditMemoryDto) { return this.memory.edit(user.id, id, input); }
  @Delete(':id') remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: DeleteMemoryDto) { return this.memory.remove(user.id, id, input.version); }
}
