import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../common/auth-context';
import { ConnectorsService } from './connectors.service';

@Public()
@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}
  @Get() list(@Query('view') view?: 'public' | 'internal') { return this.connectors.list(view === 'internal' ? 'internal' : 'public'); }
  @Get(':id') get(@Param('id') id: string, @Query('view') view?: 'public' | 'internal') { return this.connectors.get(id, view === 'internal' ? 'internal' : 'public'); }
}
