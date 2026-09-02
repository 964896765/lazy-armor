import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ChangePlanStatusDto, PlanDefinitionDto } from './dto';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() input: PlanDefinitionDto) { return this.plans.create(user.id, input); }
  @Get() list(@CurrentUser() user: AuthenticatedUser) { return this.plans.list(user.id); }
  @Get(':id') get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.plans.get(user.id, id); }
  @Get(':id/versions') versions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.plans.listVersions(user.id, id); }
  @Get(':id/versions/:version') version(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('version', ParseIntPipe) version: number) { return this.plans.getVersion(user.id, id, version); }
  @Post(':id/versions') createVersion(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: PlanDefinitionDto) { return this.plans.createVersion(user.id, id, input); }
  @Post(':id/versions/:version/apply') apply(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('version', ParseIntPipe) version: number) { return this.plans.applyVersion(user.id, id, version); }
  @Post(':id/connections/resolve') resolveConnections(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.plans.resolveAvailableConnections(user.id, id); }
  @Post(':id/status') status(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() input: ChangePlanStatusDto) { return this.plans.changeStatus(user.id, id, input.status); }
}
