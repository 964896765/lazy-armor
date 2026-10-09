import {Controller,Get,Param,Post} from '@nestjs/common';
import {CurrentUser,type AuthenticatedUser} from '../common/auth-context';
import {RuntimeTargetsService} from './runtime-targets.service';
@Controller('runtime-targets')
export class RuntimeTargetsController {
 constructor(private readonly targets:RuntimeTargetsService){}
 @Get() list(@CurrentUser() user:AuthenticatedUser){return this.targets.refresh(user.id);}
 @Post('refresh') refresh(@CurrentUser() user:AuthenticatedUser){return this.targets.refresh(user.id);}
 @Get(':id') get(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string){return this.targets.get(user.id,id);}
}
