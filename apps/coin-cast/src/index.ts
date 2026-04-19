import { createLogger } from '@coin-cast/core';

import { createCoinCastApp } from './config/createApp';
import { loadAppConfig } from './config/env';
import { parseMarketRunMode } from './config/marketRunMode';

const logger = createLogger('coin-cast-app');

const main = async (): Promise<void> => {
  const marketToRun = parseMarketRunMode();
  logger.info('Booting Coin Cast application', {
    market: marketToRun,
    ci: process.env.CI === 'true',
    nodeEnv: process.env.NODE_ENV ?? 'undefined',
  });

  const app = createCoinCastApp(loadAppConfig(), {
    marketToRun,
  });
  const result = await app.run();
  logger.info('Coin Cast application completed', {
    market: marketToRun,
    dispatchedMessages: result.dispatchedMessages,
    scannedAt: result.scannedAt.toISOString(),
  });
};

void main().catch((error) => {
  logger.error('Coin Cast run failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
