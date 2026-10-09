export interface DeliveredRuntimeResult {id:string;userId:string;invocationId:string;targetId:string;authorityEpoch:number;resultHash:string;resumeCursor:string;ackToken:string;[key:string]:unknown;}
export interface RuntimeResultInboxStore {load(owner:string):Promise<{cursor:string;receipts:Record<string,DeliveredRuntimeResult>}>;save(owner:string,state:{cursor:string;receipts:Record<string,DeliveredRuntimeResult>}):Promise<void>;}
export interface RuntimeResultTransport {resume(cursor:string):Promise<Array<{id:string;resumeCursor:string;fenced?:boolean}>>;deliver(id:string):Promise<DeliveredRuntimeResult>;ack(id:string,input:{ackToken:string;resultHash:string;authorityEpoch:number}):Promise<unknown>;}
/** Transport ACK means durable local receipt, never user approval or verified reality. */
export async function syncRuntimeResultInbox(owner:string,store:RuntimeResultInboxStore,transport:RuntimeResultTransport){
 const state=await store.load(owner);
 if(!/^\d+$/.test(state.cursor)||!Number.isSafeInteger(Number(state.cursor)))throw new Error('INVALID_RESULT_CURSOR');
 const acknowledge=(receipt:DeliveredRuntimeResult)=>transport.ack(receipt.id,{ackToken:receipt.ackToken,resultHash:receipt.resultHash,authorityEpoch:receipt.authorityEpoch});
 for(const receipt of Object.values(state.receipts)){try{await acknowledge(receipt);state.cursor=String(Math.max(Number(state.cursor),Number(receipt.resumeCursor)));delete state.receipts[receipt.id];await store.save(owner,state);}catch(error){const status=(error as {status?:number}).status;if(status===403||status===404||status===409){delete state.receipts[receipt.id];await store.save(owner,state);}else throw error;}}
 for(const descriptor of await transport.resume(state.cursor)){
  if(!/^\d+$/.test(descriptor.resumeCursor)||!Number.isSafeInteger(Number(descriptor.resumeCursor)))throw new Error('INVALID_RESULT_CURSOR');
  if(descriptor.fenced){state.cursor=String(Math.max(Number(state.cursor),Number(descriptor.resumeCursor)));await store.save(owner,state);continue;}
  const receipt=await transport.deliver(descriptor.id);
  if(receipt.userId!==owner||receipt.id!==descriptor.id||receipt.resumeCursor!==descriptor.resumeCursor||!Number.isSafeInteger(receipt.authorityEpoch)||receipt.authorityEpoch<1||!/^([a-f0-9]{64})$/.test(receipt.resultHash)||!/^([a-f0-9]{64})$/.test(receipt.ackToken))throw new Error('INVALID_RUNTIME_RESULT_RECEIPT');
  const previous=state.receipts[receipt.id];if(previous&&(previous.resultHash!==receipt.resultHash||previous.invocationId!==receipt.invocationId||previous.authorityEpoch!==receipt.authorityEpoch))throw new Error('RESULT_IDENTITY_CONFLICT');
  state.receipts[receipt.id]=receipt;
  // Storage failure must stop before ACK. Retry/restart uses exactly the saved receipt.
  await store.save(owner,state);
  await acknowledge(receipt);
  delete state.receipts[receipt.id];state.cursor=String(Math.max(Number(state.cursor),Number(receipt.resumeCursor)));await store.save(owner,state);
 }
}
