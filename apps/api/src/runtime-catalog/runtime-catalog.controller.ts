import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { CompileScenarioDto } from './dto';
import { RuntimeCatalogRegistryService } from './runtime-catalog-registry.service';

@Controller()
export class RuntimeCatalogController {
  constructor(private readonly catalog: RuntimeCatalogRegistryService) {}
  @Get('domains') domains() { return this.catalog.listDomains(); }
  @Get('domains/:domain/scenarios') domainScenarios(@Param('domain') domain: string) { return this.catalog.listScenarios(domain); }
  @Get('scenarios/:key/readiness') readiness(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) { return this.catalog.readiness(user.id, key); }
  @Post('scenarios/:key/compile') compile(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string, @Body() input: CompileScenarioDto) { return this.catalog.compile(user.id, key, input); }
  @Get('scenarios/:key') scenario(@Param('key') key: string) { return this.catalog.getScenario(key); }
  @Get('resources') resources() { return this.catalog.listResources(); }
  @Get('resources/:type/facts') facts(@Param('type') type: string) { return this.catalog.factsForResource(type); }
  @Get('strategies') strategies() { return this.catalog.listStrategies(); }
}
