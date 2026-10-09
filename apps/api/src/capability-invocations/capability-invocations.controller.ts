import {RuntimeTasksService} from './runtime-tasks.service';
import {Controller,Get,Param} from '@nestjs/common';
import {CurrentUser,type AuthenticatedUser} from '../common/auth-context';
import {CapabilityInvocationsService} from './capability-invocations.service';
@Controller('capability-invocations')
export class CapabilityInvocationsController {
 constructor(private readonly invocations:CapabilityInvocationsService,private readonly tasks:RuntimeTasksService){}
 @Get() list(@CurrentUser() user:AuthenticatedUser){return this.invocations.list(user.id);}
 @Get(':id/runtime') runtime(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string){return this.tasks.list(user.id,id);}
 @Get(':id') get(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string){return this.invocations.get(user.id,id);}
}
