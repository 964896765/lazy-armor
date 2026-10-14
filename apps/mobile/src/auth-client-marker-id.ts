let marker:string|undefined;
// An anti-abuse hint, not an authentication secret or a trusted-device grant.
export function memoryAuthClientMarker(){
 if(!marker)marker=globalThis.crypto?.randomUUID?.()??`client-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
 return marker;
}
