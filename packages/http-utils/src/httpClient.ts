import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

export interface HttpAgentOptionsConfig {
  keepAlive?: boolean;
  maxSockets?: number;
  maxFreeSockets?: number;
}

export const createHttpAgentOptions = ({
  keepAlive = true,
  maxSockets = 10,
  maxFreeSockets = 10,
}: HttpAgentOptionsConfig = {}) => ({
  httpAgent: new HttpAgent({ keepAlive, maxSockets, maxFreeSockets }),
  httpsAgent: new HttpsAgent({ keepAlive, maxSockets, maxFreeSockets }),
});

export const sharedHttpAgentOptions = createHttpAgentOptions();
