import { Body, Controller, Delete, Get, Post, Put, Req, BadRequestException } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { AiProviderConfigService } from './ai-provider-config.service';
export class SaveAiProviderDto { @IsIn(['deepseek-flash', 'deepseek-v4-pro']) model!: string; @IsIn(['AUTO', 'FAST', 'DEEP']) thinkingMode!: string; @IsOptional() @IsString() @Length(8, 256) apiKey?: string; }
@Controller('ai-service')
export class AiProviderConfigController {
 constructor(private readonly configs: AiProviderConfigService) {}
 @Get() get(@CurrentUser() user: AuthenticatedUser) { return this.configs.get(user.id); }
 @Put() save(@CurrentUser() user: AuthenticatedUser, @Body() input: SaveAiProviderDto, @Req() req: Request) { if (input.apiKey && !req.secure) throw new BadRequestException('API Key 只能通过 HTTPS 安全提交，请先连接安全服务器'); return this.configs.save(user.id, input); }
 @Post('test') test(@CurrentUser() user: AuthenticatedUser) { return this.configs.test(user.id); }
 @Delete() remove(@CurrentUser() user: AuthenticatedUser) { return this.configs.remove(user.id); }
}
