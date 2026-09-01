import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { TemplateConfigDto } from '../plans/dto';
import { NaturalLanguageTemplateDto, TemplateInstallDto } from './dto';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.templates.get(key);
  }

  @Post('natural-language/parse')
  parseNaturalLanguage(@Body() input: NaturalLanguageTemplateDto) {
    return this.templates.parseNaturalLanguage(input.query);
  }

  @Post('natural-language/install')
  installFromNaturalLanguage(@CurrentUser() user: AuthenticatedUser, @Body() input: NaturalLanguageTemplateDto) {
    return this.templates.installFromNaturalLanguage(user.id, input.query);
  }

  @Post(':key/install')
  install(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() input: TemplateInstallDto) {
    return this.templates.install(user.id, key, input.config);
  }

  @Post('/plans/:id/version')
  createVersion(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: TemplateConfigDto) {
    return this.templates.createVersionFromTemplate(user.id, id, input.config);
  }
}
