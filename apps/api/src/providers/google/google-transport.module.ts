import { Module } from '@nestjs/common';
import { GOOGLE_TRANSPORT } from './google-http.client';
@Module({ providers: [{ provide: GOOGLE_TRANSPORT, useValue: (url: string, init: RequestInit) => fetch(url, init) }], exports: [GOOGLE_TRANSPORT] })
export class GoogleTransportModule {}
