import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength, Min, Max } from 'class-validator';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/cursor-pagination';
import { SkillRepositoriesService } from './skill-repositories.service';
import { SkillSourceService } from './skill-source.service';
class SourcePreviewDto { @IsString() @MaxLength(2000) url!: string; }
class SourceImportDto extends SourcePreviewDto {
  @IsString() @MinLength(1) @MaxLength(160) requestId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) contentHash!: string;
}
class ImportDto { @IsObject() package!: Record<string, unknown>; }
class RepositoryVersionDto { @IsInt() @Min(1) version!: number; }
class RepositoryPlanningDto extends RepositoryVersionDto { @IsBoolean() enabled!: boolean; }
class RevisionDto extends RepositoryVersionDto { @IsObject() manifest!: Record<string, unknown>; }
class RepositoryPageDto extends CursorPageDto { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) override limit = 10; }
@Controller('plans')
export class PlanSkillReferencesController {
  constructor(private readonly repositories: SkillRepositoriesService) {}
  @Get(':id/methods') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.repositories.forPlan(user.id, id); }
}

@Controller('skill-repositories')
export class SkillRepositoriesController {
  constructor(private readonly repositories: SkillRepositoriesService, private readonly sources: SkillSourceService) {}
  @Post('preview') preview(@Body() input: SourcePreviewDto) { return this.sources.preview(input.url); }
  @Post('from-url') fromUrl(@CurrentUser() user: AuthenticatedUser, @Body() input: SourceImportDto) { return this.sources.import(user.id, input); }
  @Get() list(@CurrentUser() user: AuthenticatedUser, @Query() query: RepositoryPageDto) { return this.repositories.list(user.id, query); }
  @Post() import(@CurrentUser() user: AuthenticatedUser, @Body() input: ImportDto) { return this.repositories.import(user.id, input.package); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) { return this.repositories.get(user.id, id); }
  @Post(':id/planning') change(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: RepositoryPlanningDto) { return this.repositories.change(user.id, id, input.version, input.enabled); }
  @Delete(':id') archive(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: RepositoryVersionDto) { return this.repositories.change(user.id, id, input.version, false, true); }
  @Get(':id/entries/:entryId/revisions') history(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string, @Query() query: RepositoryPageDto) { return this.repositories.history(user.id, id, entryId, query); }
  @Post(':id/entries/:entryId/revisions') revise(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string, @Body() input: RevisionDto) { return this.repositories.revise(user.id, id, entryId, input.version, input.manifest); }
}
