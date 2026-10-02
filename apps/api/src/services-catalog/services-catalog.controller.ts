import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ServicesCatalogService } from './services-catalog.service';

@Controller()
export class ServicesCatalogController {
  constructor(private readonly catalog: ServicesCatalogService) {}

  @Get('service-offerings')
  list() { return this.catalog.listPublished(); }

  @Get('service-provider-profile')
  profile(@CurrentUser() user: AuthenticatedUser) { return this.catalog.profileForUser(user.id); }
}
