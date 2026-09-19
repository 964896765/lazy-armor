import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { LazyArmorMcpToolService } from './lazy-armor-mcp-tools';

/**
 * Lazy Armor MCP Server (first wave: low-risk read tools only).
 *
 * Every tool call binds an authenticated user and enforces ownership isolation
 * through the existing services (get_truth can never read another user's data
 * by UUID). Forbidden tools (execute/approve/pay/delete/publish/secret/raw
 * evidence) are simply not present.
 */
@Controller('mcp/lazy-armor')
export class LazyArmorMcpController {
  constructor(private readonly tools: LazyArmorMcpToolService) {}

  @Get('tools')
  listTools() {
    return { tools: this.tools.listTools() };
  }

  @Post('call')
  async call(@CurrentUser() user: AuthenticatedUser, @Body() body: { toolName?: string; arguments?: Record<string, unknown> }) {
    const toolName = body?.toolName;
    const args = body?.arguments ?? {};
    if (typeof toolName !== 'string' || !toolName.trim()) throw new BadRequestException('toolName is required');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new BadRequestException('arguments must be an object');
    return { result: await this.tools.call(user.id, toolName, args) };
  }
}
