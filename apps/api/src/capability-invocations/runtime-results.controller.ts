import {Body,Controller,Get,Param,Post,Query} from '@nestjs/common';
import {IsInt,IsString,Matches,Min} from 'class-validator';
import {CurrentUser,type AuthenticatedUser} from '../common/auth-context';
import {RuntimeResultsService} from './runtime-results.service';
class AckResultDto {@IsString() @Matches(/^[a-f0-9]{64}$/) ackToken!:string;@IsString() @Matches(/^[a-f0-9]{64}$/) resultHash!:string;@IsInt() @Min(1) authorityEpoch!:number;}
@Controller('runtime-results')
export class RuntimeResultsController {
 constructor(private readonly results:RuntimeResultsService){}
 @Get() resume(@CurrentUser() user:AuthenticatedUser,@Query('after') after?:string){return this.results.resume(user.id,after===undefined?0:Number(after));}
 @Get(':id/payload') payload(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string){return this.results.payload(user.id,id);}
 @Post(':id/deliver') deliver(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string){return this.results.deliver(user.id,id);}
 @Post(':id/ack') ack(@CurrentUser() user:AuthenticatedUser,@Param('id') id:string,@Body() input:AckResultDto){return this.results.acknowledge(user.id,id,input);}
}
