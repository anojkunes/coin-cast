import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

export const sharedHttpAgentOptions = {
  httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 10 }),
  httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 10 }),
};
