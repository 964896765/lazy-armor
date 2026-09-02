import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, Roles, type AuthenticatedUser } from '../common/auth-context';
import { TemplateConfigDto } from '../plans/dto';
import { NaturalLanguageTemplateDto, TemplateInstallDto, TemplateLifecycleDto } from './dto';
import { TemplatesService } from './templates.service';
import { UsageService } from '../usage/usage.service';
import { createHash } from 'node:crypto';
import { TemplateLifecycleService } from './template-lifecycle.service';

@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly usage: UsageService,
    private readonly lifecycle: TemplateLifecycleService,
  ) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Roles('super_admin', 'operations_readonly')
  @Get(':key/lifecycle')
  getLifecycle(@Param('key') key: string) {
    return this.lifecycle.get(key);
  }

  @Roles('super_admin')
  @Post(':key/lifecycle/submit-review')
  submitReview(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() input: TemplateLifecycleDto) {
    return this.lifecycle.transition(user.id, key, 'submit-review', input.reason);
  }

  @Roles('super_admin')
  @Post(':key/lifecycle/publish')
  publish(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() input: TemplateLifecycleDto) {
    return this.lifecycle.transition(user.id, key, 'publish', input.reason);
  }

  @Roles('super_admin')
  @Post(':key/lifecycle/suspend')
  suspend(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() input: TemplateLifecycleDto) {
    return this.lifecycle.transition(user.id, key, 'suspend', input.reason);
  }

  @Roles('super_admin')
  @Post(':key/lifecycle/deprecate')
  deprecate(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() input: TemplateLifecycleDto) {
    return this.lifecycle.transition(user.id, key, 'deprecate', input.reason);
  }

  @Get(':key')
  get(@Param('key') key: string) {
    return this.templates.get(key);
  }

  @Post('natural-language/parse')
  async parseNaturalLanguage(@CurrentUser() user: AuthenticatedUser, @Body() input: NaturalLanguageTemplateDto) {
    const result = this.templates.parseNaturalLanguage(input.query);
    await this.meterAi(user.id, input, result, 'parse');
    return result;
  }

  @Post('natural-language/install')
  async installFromNaturalLanguage(@CurrentUser() user: AuthenticatedUser, @Body() input: NaturalLanguageTemplateDto) {
    const result = await this.templates.installFromNaturalLanguage(user.id, input.query);
    await this.meterAi(user.id, input, result, 'install');
    return result;
  }

  @Post(':key/install')
  install(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() input: TemplateInstallDto) {
    return this.templates.install(user.id, key, input.config);
  }

  @Post('/plans/:id/version')
  createVersion(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: TemplateConfigDto) {
    return this.templates.createVersionFromTemplate(user.id, id, input.config);
  }

  private meterAi(userId: string, input: NaturalLanguageTemplateDto, output: unknown, operation: string) {
    const requestIdentity = input.requestId ?? createHash('sha256').update(input.query).digest('hex');
    const identity = createHash('sha256').update([userId, operation, requestIdentity].join(':')).digest('hex');
    return this.usage.recordAiUsage({
      userId,
      identity,
      inputUnits: input.query.length,
      outputUnits: JSON.stringify(output).length,
      provider: 'deterministic_fallback',
      resourceId: requestIdentity,
      billable: false,
    });
  }
}
