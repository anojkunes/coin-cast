import { createCoinCastApp } from './config/createApp';
import { loadAppConfig } from './config/env';
import { parseMarketRunMode } from './config/marketRunMode';

const main = async (): Promise<void> => {
  const app = createCoinCastApp(loadAppConfig(), {
    marketToRun: parseMarketRunMode(),
  });
  const result = await app.run();
  console.log(result.message);
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
