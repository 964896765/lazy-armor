import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ApprovalService } from './approval.service';

@Injectable()
export class ApprovalExpiryService implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  constructor(private readonly approvals: ApprovalService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void this.approvals.expireDue().catch(() => undefined); }, 30_000);
    this.timer.unref();
  }
  onApplicationShutdown() { if (this.timer) clearInterval(this.timer); }
}
