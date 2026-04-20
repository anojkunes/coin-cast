import { writeFile } from 'node:fs/promises';

import { createLogger, MarketSignalService, stockScanProfile } from '@coin-cast/core';
import { NasdaqStockRepository } from '@coin-cast/market-stocks';

import { loadAppConfig } from '../config/env';

const logger = createLogger('stock-model-trainer');

const outputPath = (): string => process.env.STOCK_MODEL_OUTPUT_PATH?.trim() || 'stock-model.json';

const main = async (): Promise<void> => {
  const config = loadAppConfig();
  const service = new MarketSignalService(
    new NasdaqStockRepository(
      config.nasdaqBaseUrl,
      config.apiRetryMaxAttempts,
      config.apiRetryInitialDelayMs,
      config.apiRetryMaxDelayMs,
      config.stockHistoryLoadConcurrency,
    ),
    [],
    stockScanProfile,
  );

  const model = await service.train({
    universeLimit: config.stockUniverseLimit,
    historyDays: config.stockHistoryDays,
    historyLoadConcurrency: config.stockHistoryLoadConcurrency,
    symbolFilter: config.stockSymbols,
    maxSignals: 5,
    actionableConfidence: 0.28,
  });

  await writeFile(outputPath(), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  logger.info('Stock model artifact written', {
    outputPath: outputPath(),
    assetsTrained: model.assetsTrained,
    samplesUsed: model.samplesUsed,
    modelQuality: model.modelQuality.qualityLabel,
  });
};

void main().catch((error) => {
  logger.error('Failed to train stock market model', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
