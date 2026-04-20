import { appendFile } from 'node:fs/promises';

import { createLogger } from '@coin-cast/core';
import { NasdaqStockRepository } from '@coin-cast/market-stocks';

import { loadAppConfig } from '../config/env';

interface StockChunk {
  index: number;
  size: number;
  symbols: string;
}

const logger = createLogger('stock-chunk-preparer');

const parseChunkSize = (): number => {
  const parsed = Number(process.env.STOCK_SCAN_CHUNK_SIZE ?? 200);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 200;
};

const writeOutput = async (name: string, value: string): Promise<void> => {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    logger.info('GitHub Actions output unavailable; printing value to stdout', {
      name,
      value,
    });
    return;
  }

  await appendFile(outputPath, `${name}=${value}\n`);
};

const buildChunks = (symbols: string[], chunkSize: number): StockChunk[] => {
  const chunks: StockChunk[] = [];

  for (let index = 0; index < symbols.length; index += chunkSize) {
    const chunkSymbols = symbols.slice(index, index + chunkSize);
    chunks.push({
      index: Math.floor(index / chunkSize),
      size: chunkSymbols.length,
      symbols: chunkSymbols.join(','),
    });
  }

  return chunks;
};

const main = async (): Promise<void> => {
  const config = loadAppConfig();
  const chunkSize = parseChunkSize();
  const repository = new NasdaqStockRepository(
    config.nasdaqBaseUrl,
    config.apiRetryMaxAttempts,
    config.apiRetryInitialDelayMs,
    config.apiRetryMaxDelayMs,
    config.stockHistoryLoadConcurrency,
  );

  const assets = await repository.getUniverse(config.stockUniverseLimit);
  const symbols = assets.map((asset) => asset.symbol);
  const chunks = buildChunks(symbols, chunkSize);

  logger.info('Prepared stock scan chunks', {
    assetsSelected: symbols.length,
    chunkSize,
    chunkCount: chunks.length,
  });

  await writeOutput('chunk_matrix', JSON.stringify(chunks));
  await writeOutput('stock_symbols', symbols.join(','));
  await writeOutput('selected_count', String(symbols.length));
  await writeOutput('chunk_count', String(chunks.length));
};

void main().catch((error) => {
  logger.error('Failed to prepare stock scan chunks', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
