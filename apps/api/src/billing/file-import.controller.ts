import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthenticatedUser } from '../common/auth-context';
import { ImportBillingFileDto } from './dto';
import { FileImportService } from './file-import.service';

@Controller('file-imports')
export class FileImportController {
  constructor(private readonly files: FileImportService) {}

  @Post('billing')
  importBilling(@CurrentUser() user: AuthenticatedUser, @Body() input: ImportBillingFileDto) {
    return this.files.importBillingFile(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.files.list(user.id);
  }
}
