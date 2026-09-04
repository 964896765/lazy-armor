import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { deviceAppConnections } from '@lazy-armor/database';
import { newId, supportedDeviceApp, type DeviceAppConnectionMode } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import type { CreateDeviceAppConnectionDto, UpdateDeviceAppConnectionDto } from './dto';

const IMPLEMENTED_MODES = new Set<DeviceAppConnectionMode>(['open_app']);
const ALLOWED_MODES = new Set<DeviceAppConnectionMode>(['open_app', 'deep_link', 'notification_read']);

@Injectable()
export class DeviceAppsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    const rows = await this.db.select().from(deviceAppConnections)
      .where(eq(deviceAppConnections.userId, userId))
      .orderBy(desc(deviceAppConnections.updatedAt));
    return rows.map((row) => this.toResponse(row));
  }

  async create(userId: string, input: CreateDeviceAppConnectionDto) {
    const app = supportedDeviceApp(input.packageName);
    if (!app) throw new BadRequestException('This Android app is not in the supported catalog');
    const modes = this.validateModes(input.packageName, input.modes);
    const now = new Date();
    const id = newId();
    try {
      await this.db.insert(deviceAppConnections).values({
        id,
        userId,
        deviceId: input.deviceId.trim(),
        packageName: app.packageName,
        displayName: app.displayName,
        enabled: 1,
        modesJson: modes,
        trustLevel: 'user_selected',
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isDuplicate(error)) throw new BadRequestException('This app is already connected on this device');
      throw error;
    }
    await this.audit.append({
      actorType: 'user',
      actorUserId: userId,
      action: 'DEVICE_APP_CONNECTION_CREATED',
      resourceType: 'device_app_connection',
      resourceId: id,
      userId,
      correlationId: id,
      changeSummary: `Added ${app.displayName} from the supported Android app catalog with modes: ${modes.join(', ')}`,
      source: 'api',
      result: 'success',
    });
    return this.get(userId, id);
  }

  async update(userId: string, id: string, input: UpdateDeviceAppConnectionDto) {
    const current = await this.getRow(userId, id);
    const nextModes = input.modes === undefined ? current.modesJson : this.validateModes(current.packageName, input.modes);
    const now = new Date();
    await this.db.update(deviceAppConnections).set({
      ...(input.enabled === undefined ? {} : { enabled: input.enabled ? 1 : 0 }),
      ...(input.modes === undefined ? {} : { modesJson: nextModes }),
      updatedAt: now,
    }).where(and(eq(deviceAppConnections.id, id), eq(deviceAppConnections.userId, userId)));
    await this.audit.append({
      actorType: 'user',
      actorUserId: userId,
      action: 'DEVICE_APP_CONNECTION_UPDATED',
      resourceType: 'device_app_connection',
      resourceId: id,
      userId,
      correlationId: id,
      changeSummary: `Updated ${current.displayName} Android app connection`,
      source: 'api',
      result: 'success',
    });
    return this.get(userId, id);
  }

  private async get(userId: string, id: string) {
    return this.toResponse(await this.getRow(userId, id));
  }

  private async getRow(userId: string, id: string) {
    const rows = await this.db.select().from(deviceAppConnections)
      .where(and(eq(deviceAppConnections.id, id), eq(deviceAppConnections.userId, userId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Device app connection not found');
    return rows[0];
  }

  private validateModes(packageName: string, requested: string[]): DeviceAppConnectionMode[] {
    const app = supportedDeviceApp(packageName);
    if (!app) throw new BadRequestException('This Android app is not in the supported catalog');
    const unique = [...new Set(requested)] as DeviceAppConnectionMode[];
    if (unique.length === 0) throw new BadRequestException('Select at least one available capability');
    for (const mode of unique) {
      if (!ALLOWED_MODES.has(mode)) throw new BadRequestException('Unsupported device app capability');
      const capability = app.capabilities.find((item) => item.mode === mode);
      if (!capability || capability.availability !== 'available' || !IMPLEMENTED_MODES.has(mode)) {
        throw new BadRequestException(`Capability ${mode} is not available for this app`);
      }
    }
    return unique;
  }

  private toResponse(row: typeof deviceAppConnections.$inferSelect) {
    return {
      id: row.id,
      deviceId: row.deviceId,
      packageName: row.packageName,
      displayName: row.displayName,
      enabled: row.enabled === 1,
      modes: row.modesJson,
      trustLevel: row.trustLevel,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function isDuplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}
