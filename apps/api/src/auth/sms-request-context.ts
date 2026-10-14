import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';

// Untrusted caller hints only. Neither a principal nor a trusted-device proof.
export interface SmsRequestHints { clientId?:string; userAgent?:string }
const hints=new AsyncLocalStorage<SmsRequestHints>();
export const currentSmsRequestHints=()=>hints.getStore();
export const withSmsRequestHints=<T>(value:SmsRequestHints,work:()=>T)=>hints.run(value,work);

@Injectable()
export class SmsRequestContextMiddleware implements NestMiddleware {
 use(req:Request,_res:Response,next:NextFunction) {
  withSmsRequestHints({clientId:req.header('x-auth-client-id'),userAgent:req.header('user-agent')},next);
 }
}
