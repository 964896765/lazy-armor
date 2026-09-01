import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/auth-context';
import { ConnectorsService } from './connectors.service';

@Public()
@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}
  @Get() list() { return this.connectors.list(); }
  @Get(':id') get(@Param('id') id: string) { return this.connectors.get(id); }
}
