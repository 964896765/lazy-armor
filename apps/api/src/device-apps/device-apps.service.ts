import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {appCapabilityAvailability,localCapabilityAvailability} from '@lazy-armor/plan-schema';
import { deviceAppConnections,localCapabilityStates,trustedDevices } from '@lazy-armor/database';
import { deviceAppCapabilities, deviceAppCatalogMetadata, deviceAppIntegration, isGenericDeviceAppMode, newId, type DeviceAppConnectionMode } from '@lazy-armor/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { TrustedDevicesService } from '../trusted-devices/trusted-devices.service';
import type { CreateDeviceAppConnectionDto, UpdateDeviceAppConnectionDto } from './dto';

const IMPLEMENTED_MODES = new Set<DeviceAppConnectionMode>(['open_app', 'notification_read','receive_share']);

@Injectable()
export class DeviceAppsService {
  constructor(
    @Inject(DATABASE) private readonly db: InjectedDatabase,
    private readonly audit: AuditService,
    private readonly trustedDevices: TrustedDevicesService,
  ) {}

  async list(userId: string) {
    const rows = await this.db.select().from(deviceAppConnections)
      .where(eq(deviceAppConnections.userId, userId))
      .orderBy(desc(deviceAppConnections.updatedAt));
    return Promise.all(rows.map((row) => this.toResponse(row)));
  }

  async create(userId: string, input: CreateDeviceAppConnectionDto, signedTrustedDeviceId: string) {
    if (!input.launchable) throw new BadRequestException('Only a launchable app discovered on this device can be connected');
    if (input.trustedDeviceId !== signedTrustedDeviceId) throw new ForbiddenException('A device app connection must be created by the same trusted device named in its signed request');
    const deviceId = input.deviceId.trim();
    const trustedDevice = await this.trustedDevices.assertActive(userId, input.trustedDeviceId, deviceId);
    const packageName = input.packageName.trim();
    const displayName = input.displayName.trim();
    const modes = this.validateModes(packageName, input.modes);
    const integration = deviceAppIntegration(packageName);
    const now = new Date();
    const id = newId();
    try {
      await this.db.insert(deviceAppConnections).values({
        id,
        userId,
        deviceId,
        trustedDeviceId: trustedDevice.id,
        packageName,
        displayName,
        connectionType: 'generic',
        integrationKey: integration?.integrationKey ?? null,
        versionName: input.versionName?.trim() || null,
        versionCode: input.versionCode ?? null,
        launchable: 1,
        discoveryFingerprint: input.discoveryFingerprint,
        enabled: 1,
        modesJson: modes,
        trustLevel: trustedDevice.trustLevel,
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
      changeSummary: integration ? `Created a generic discovered app with an inactive catalog hint ${integration.integrationKey}` : 'Created a device-reported generic app connection',
      source: 'api',
      result: 'success',
    });
    return this.get(userId, id);
  }

  async refreshDiscovery(userId:string,id:string,input:CreateDeviceAppConnectionDto,signedDeviceId:string){
    const row=await this.getRow(userId,id);
    if(row.trustedDeviceId!==signedDeviceId||input.trustedDeviceId!==signedDeviceId||input.deviceId!==row.deviceId||input.packageName!==row.packageName)throw new ForbiddenException('Discovery must match the existing app and device');
    await this.trustedDevices.assertActive(userId,signedDeviceId,row.deviceId);
    const now=new Date();
    await this.db.update(deviceAppConnections).set({launchable:input.launchable?1:0,versionName:input.versionName??null,versionCode:input.versionCode??null,discoveryFingerprint:input.discoveryFingerprint,lastSeenAt:now,updatedAt:now}).where(and(eq(deviceAppConnections.id,id),eq(deviceAppConnections.userId,userId)));
    await this.audit.append({actorType:'user',actorUserId:userId,userId,action:'DEVICE_APP_DISCOVERY_REFRESHED',resourceType:'device_app_connection',resourceId:id,source:'api',result:'success',after:{installed:input.launchable,discoveryFingerprint:input.discoveryFingerprint},changeSummary:'Refreshed signed device discovery; user grants remain independently managed'});
    return this.get(userId,id);
  }

  async update(userId: string, id: string, input: UpdateDeviceAppConnectionDto) {
    const current = await this.getRow(userId, id);
    const nextModes = input.modes === undefined ? current.modesJson : this.validateModes(current.packageName, input.modes);
    if (input.enabled === true || nextModes.includes('notification_read')) {
      if (!current.trustedDeviceId) throw new ForbiddenException('Enabling a device app connection requires a trusted device');
      await this.trustedDevices.assertActive(userId, current.trustedDeviceId, current.deviceId);
    }
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
      changeSummary: 'Updated a device app connection state or user-selected permissions',
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
    const unique = [...new Set(requested)] as DeviceAppConnectionMode[];
    if (unique.length === 0) throw new BadRequestException('Select at least one available operation');
    const capabilities = new Map(deviceAppCapabilities(packageName).map((item) => [item.mode, item]));
    for (const mode of unique) {
      const capability = capabilities.get(mode);
      if (!capability || capability.availability !== 'available' || !IMPLEMENTED_MODES.has(mode)) {
        throw new BadRequestException(`Operation ${mode} is not currently available for this app`);
      }
      if (!isGenericDeviceAppMode(mode)) throw new BadRequestException('Enhanced app operations are not currently available');
    }
    return unique;
  }

  private async toResponse(row: typeof deviceAppConnections.$inferSelect) {
    const catalog = deviceAppCatalogMetadata(row.packageName);
    const installed = row.launchable === 1;
    const authorized = row.enabled === 1 && row.modesJson.length > 0;
    const device=row.trustedDeviceId?(await this.db.select().from(trustedDevices).where(and(eq(trustedDevices.id,row.trustedDeviceId),eq(trustedDevices.userId,row.userId))).limit(1))[0]:undefined;
    const states=row.trustedDeviceId?await this.db.select().from(localCapabilityStates).where(and(eq(localCapabilityStates.trustedDeviceId,row.trustedDeviceId),eq(localCapabilityStates.userId,row.userId))):[];
    const active=device?.status==='active'&&!device.revokedAt;
    const native=states.find(s=>s.capability==='notification.read');
    const healthy=!!active;
    const now=Date.now();
    const capabilities=['open_app','notification_read','receive_share','deep_link','app_read_session','structured_read','vision','execute'].map(key=>{
     const notification=key==='notification_read';const open=key==='open_app';const share=key==='receive_share';const state=share?states.find(s=>s.capability==='share.read'):native;
     const implemented=open||notification||share;
     const permission=notification||share?state?.systemPermission??'UNKNOWN':open?'GRANTED':'UNKNOWN';
     const userGrant=row.enabled===1&&row.modesJson.includes(key as DeviceAppConnectionMode)&&(!(notification||share)||state?.userGrant===true);
     const checkedAt=notification||share?state&&row.lastSeenAt?Math.min(state.checkedAt.getTime(),row.lastSeenAt.getTime()):null:open?row.lastSeenAt?.getTime()??null:null;
     const evidenceRefs=(notification||share)&&state?[state.evidenceRef,`discovery:${row.discoveryFingerprint}`]:open?[`discovery:${row.discoveryFingerprint}`]:[];
     const evidence={installed:installed&&!!active,systemPermission:permission as 'GRANTED'|'DENIED'|'UNKNOWN',userGrant,adapterImplemented:implemented,healthy:!!active&&(!(notification||share)||state?.health==='HEALTHY'),checkedAt,evidenceRefs,...(key==='execute'?{restricted:'UNSUPPORTED' as const}:{})};
     return {key,acquisitionMode:({open_app:'OPEN_APP',notification_read:'NOTIFICATION',receive_share:'SHARE',deep_link:'DEEP_LINK',app_read_session:'APP_READ_SESSION',structured_read:'STRUCTURED_READ',vision:'ARTIFACT/VISION'} as Record<string,string>)[key]??null,...evidence,status:appCapabilityAvailability(evidence,now)};
    });
    return {
      id: row.id,
      deviceId: row.deviceId,
      trustedDeviceId: row.trustedDeviceId,
      packageName: row.packageName,
      displayName: row.displayName,
      connectionType: 'generic',
      integrationKey: row.integrationKey,
      versionName: row.versionName,
      versionCode: row.versionCode,
      launchable: row.launchable === 1,
      enabled: row.enabled === 1,
      modes: row.modesJson,
      trustLevel: row.trustLevel,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      capabilities,
      capability: {
        installed,
        supported: catalog.supported,
        authorized,
        healthy,
        availabilityScope:'PER_OPERATION_ONLY',
        sourceCapabilities: catalog.sourceCapabilities,
        actionCapabilities: catalog.actionCapabilities,
        riskClass: catalog.riskClass,
        verificationMethod: catalog.verificationMethod,
        notificationReadable: catalog.notificationReadable,
        shareReadable: catalog.shareReadable,
        appReadSessionSupported: catalog.appReadSessionSupported,
        structuredReadSupported: catalog.structuredReadSupported,
        visionFallbackAllowed: catalog.visionFallbackAllowed,
      },
    };
  }
}

function isDuplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}
