import { lookup } from 'node:dns/promises';
import { publicAddress } from '../connectors/public-json.connector';

export async function resolvePublicHost(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PUBLIC_DNS_TIMEOUT')), 5000); }),
    ]);
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('PRIVATE_SOURCE_ADDRESS');
    return addresses;
  } finally { if (timer) clearTimeout(timer); }
}
