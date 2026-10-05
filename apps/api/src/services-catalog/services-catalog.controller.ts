import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Public, type AuthenticatedUser } from '../common/auth-context';
import { ServicesCatalogService } from './services-catalog.service';
import { PublishServiceDto, ServiceMediaDto, UpdateServiceOfferingDto } from './dto';
import { ServiceMediaService } from './service-media.service';

@Controller()
export class ServicesCatalogController {
  constructor(private readonly catalog: ServicesCatalogService, private readonly media: ServiceMediaService) {}
  @Post('service-media') upload(@CurrentUser() user: AuthenticatedUser, @Body() input: ServiceMediaDto) { return this.media.upload(user.id, input); }
  @Public() @Get('service-media/:id') async image(@Param('id', ParseUUIDPipe) id: string, @Res() response: Response) { const bytes = await this.media.publicImage(id); response.setHeader('Content-Type', 'image/jpeg'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-store'); response.send(bytes); }

  @Get('service-offerings')
  list() { return this.catalog.listPublished(); }
  @Get('my-service-offerings')
  mine(@CurrentUser() user: AuthenticatedUser) { return this.catalog.listOwned(user.id); }
  @Post('my-service-offerings/:id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateServiceOfferingDto) { return this.catalog.updateOwned(user.id, id, input); }

  @Get('service-provider-profile')
  profile(@CurrentUser() user: AuthenticatedUser) { return this.catalog.profileForUser(user.id); }
  @Post('service-offerings')
  publish(@CurrentUser() user: AuthenticatedUser, @Body() input: PublishServiceDto) { return this.catalog.publish(user.id, input); }
}
