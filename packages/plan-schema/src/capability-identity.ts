/** Explicit semantic mappings only. Unknown aliases remain unknown; no name inference. */
export const CAPABILITY_IDENTITY_REVISION='canonical-capability-v1';
export const CAPABILITY_IDENTITIES=[
 'calendar.event.read','calendar.event.create','calendar.event.update','calendar.event.delete',
 'app.launch','app.deep_link.open','app.notification.read','app.share.receive','app.structured_read','app.ui.observe','app.ui.interact',
 'email.read','email.metadata.read','email.labels.read','email.draft.create','email.send',
 'document.read','file.read','file.write','location.read','browser.navigate','browser.extract','browser.download',
 'service.booking.request','service.fulfillment.confirm','contacts.read','media.pick','camera.capture','clipboard.read_on_demand','notification.send','microphone.transcribe','background.device_task','network.status','battery.status','app.usage.read'
] as const;
export const CAPABILITY_ALIASES:Readonly<Record<string,string>>={
 READ_CALENDAR_EVENT:'calendar.event.read','calendar.read':'calendar.event.read',CREATE_CALENDAR_EVENT:'calendar.event.create','calendar.create':'calendar.event.create',UPDATE_CALENDAR_EVENT:'calendar.event.update','calendar.update':'calendar.event.update','calendar.delete':'calendar.event.delete',
 open_app:'app.launch','app.open':'app.launch',notification_read:'app.notification.read','notification.read':'app.notification.read',receive_share:'app.share.receive','share.read':'app.share.receive','share.receive':'app.share.receive',deep_link:'app.deep_link.open','deep_link.open':'app.deep_link.open',structured_read:'app.structured_read',
 READ_EMAIL_BODY:'email.read',READ_EMAIL_METADATA:'email.metadata.read',READ_EMAIL_LABELS:'email.labels.read',CREATE_EMAIL_DRAFT:'email.draft.create',SEND_EMAIL:'email.send',FEISHU_DOC_READ:'document.read',
 'files.read':'file.read','location.foreground':'location.read','appusage.read':'app.usage.read','voice.input':'microphone.transcribe','background.task':'background.device_task'
};
export function canonicalCapabilityId(key:string):string|null{return (CAPABILITY_IDENTITIES as readonly string[]).includes(key)?key:Object.hasOwn(CAPABILITY_ALIASES,key)?CAPABILITY_ALIASES[key]!:null;}
export function capabilityIdentity(key:string){return {canonicalCapabilityId:canonicalCapabilityId(key),sourceCapabilityKey:key,identityRevision:CAPABILITY_IDENTITY_REVISION};}
export function sameCapabilityIdentity(a:string,b:string){return a===b||(canonicalCapabilityId(a)!==null&&canonicalCapabilityId(a)===canonicalCapabilityId(b));}
