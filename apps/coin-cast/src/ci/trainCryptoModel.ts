import { writeFile } from 'node:fs/promises';

import { createLogger, cryptoScanProfile, MarketSignalService } from '@coin-cast/core';
import { KrakenMarketRepository } from '@coin-cast/market-crypto';

import { loadAppConfig } from '../config/env';

const logger = createLogger('crypto-model-trainer');

const outputPath = (): string => process.env.KRAKEN_MODEL_OUTPUT_PATH?.trim() || 'crypto-model.json';

const main = async (): Promise<void> => {
  const config = loadAppConfig();
  const service = new MarketSignalService(
    new KrakenMarketRepository(
      config.krakenBaseUrl,
      config.apiRetryMaxAttempts,
      config.apiRetryInitialDelayMs,
      config.apiRetryMaxDelayMs,
    ),
    [],
    cryptoScanProfile,
  );

  const model = await service.train({
    universeLimit: config.krakenUniverseLimit,
    historyDays: config.krakenHistoryDays,
    symbolFilter: config.krakenSymbols,
    maxSignals: 5,
    actionableConfidence: 0.3,
  });

  await writeFile(outputPath(), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  logger.info('Crypto model artifact written', {
    outputPath: outputPath(),
    assetsTrained: model.assetsTrained,
    samplesUsed: model.samplesUsed,
    modelQuality: model.modelQuality.qualityLabel,
  });
};

void main().catch((error) => {
  logger.error('Failed to train crypto market model', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
