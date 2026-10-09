import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/cursor-pagination';
import { CreateMemoryDto, DeleteMemoryDto, EditMemoryDto, MemorySettingsDto } from './dto';
import { MemoryService } from './memory.service';
@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}
  @Get('settings') settings(@CurrentUser() user: AuthenticatedUser) { return this.memory.settings(user.id); }
  @Patch('settings') changeSettings(@CurrentUser() user: AuthenticatedUser, @Body() input: MemorySettingsDto) { return this.memory.changeSettings(user.id, input); }
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) { return this.memory.list(user.id, query); }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateMemoryDto) { return this.memory.create(user.id, input); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.memory.get(user.id, id); }
  @Patch(':id') edit(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: EditMemoryDto) { return this.memory.edit(user.id, id, input); }
  @Delete(':id') remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: DeleteMemoryDto) { return this.memory.remove(user.id, id, input.version); }
}
