import {RealityPipelineModule} from '../reality-pipeline/reality-pipeline.module';
import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { AuditModule } from '../audit/audit.module';
import { ArtifactService } from './artifact.service';
import { ArtifactExtractorService } from './artifact-extractor.service';
class ImportArtifactDto {
 @IsString() @Length(1,160) fileName!: string;
 @IsIn(['text/plain','text/markdown','text/csv','application/json','text/html','image/png','image/jpeg','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']) mimeType!: string;
 @IsString() @Length(1,2666668) contentBase64!: string;
 @IsString() @Length(1,100) requestId!: string;
}
@Controller('artifacts')
class ArtifactController {
 constructor(private readonly artifacts: ArtifactService) {}
 @Post() import(@CurrentUser() user: AuthenticatedUser, @Body() input: ImportArtifactDto) { return this.artifacts.import(user.id,input); }
 @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id',ParseUUIDPipe) id: string) { return this.artifacts.get(user.id,id); }
}
@Module({ imports:[AuditModule,RealityPipelineModule], providers:[ArtifactService,ArtifactExtractorService], controllers:[ArtifactController], exports:[ArtifactService,ArtifactExtractorService] })
export class ArtifactModule {}
