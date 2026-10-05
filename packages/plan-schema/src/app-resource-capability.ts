export const ACQUISITION_MODES=['NOTIFICATION','SHARE','APP_READ_SESSION','STRUCTURED_READ','ARTIFACT/VISION','OPEN_APP','DEEP_LINK'] as const;
export type AcquisitionMode=typeof ACQUISITION_MODES[number];
export interface AppCapabilityEvidence {
 installed:boolean; systemPermission:'GRANTED'|'DENIED'|'UNKNOWN'; userGrant:boolean;
 adapterImplemented:boolean; healthy:boolean; checkedAt:number|null; evidenceRefs:readonly string[];
 restricted?:'UNSUPPORTED'|'SPECIAL_PERMISSION'|'PLATFORM_RESTRICTED';
}
/** Per-operation authority; connection.enabled cannot stand in for this evidence. */
export function appCapabilityAvailability(e:AppCapabilityEvidence,now:number):'AVAILABLE'|'UNAVAILABLE'|'PERMISSION_REQUIRED'|'DISABLED'|'UNKNOWN'|'UNSUPPORTED'|'SPECIAL_PERMISSION'|'PLATFORM_RESTRICTED' {
 if(e.restricted)return e.restricted;
 if(!e.installed||!e.adapterImplemented)return 'UNAVAILABLE';
 if(!e.userGrant)return 'DISABLED';
 if(e.systemPermission==='DENIED')return 'PERMISSION_REQUIRED';
 if(e.systemPermission!=='GRANTED'||e.checkedAt===null||e.checkedAt>now+1000||now-e.checkedAt>300000||!e.evidenceRefs.length)return 'UNKNOWN';
 if(!e.healthy)return 'UNAVAILABLE';
 return 'AVAILABLE';
}
export interface AppCapabilityProfile {profileId:string;packageName:string;discoveryEvidenceRef:string;modes:readonly AcquisitionMode[];parserVersion:string|null;phoneEvidenceRefs:readonly string[];}
/** A registry entry without actual package discovery and evidence cannot enable an enhancement. */
export function appProfileVerified(profile:AppCapabilityProfile):boolean{return !!profile.discoveryEvidenceRef&&!!profile.parserVersion&&profile.phoneEvidenceRefs.length>0;}
