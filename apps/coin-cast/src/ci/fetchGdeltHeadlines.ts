import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createLogger, type MarketAssetClass, type NewsFeed } from '@coin-cast/core';
import {
  GdeltNewsFeedRepository,
  cryptoGdeltQueries,
  stockGdeltQueries,
} from '@coin-cast/news-gdelt';

import { loadAppConfig } from '../config/env';

interface CachedHeadlinesArtifact {
  market: MarketAssetClass;
  fetchedAt: string;
  headlines: NewsFeed[];
}

const logger = createLogger('gdelt-headline-fetcher');

const parseMarket = (): MarketAssetClass => {
  const requested = process.argv[2]?.trim().toLowerCase();
  if (requested === 'crypto' || requested === 'stock') {
    return requested;
  }

  throw new Error(`Expected market argument "crypto" or "stock", received "${requested ?? ''}"`);
};

const resolveOutputPath = (market: MarketAssetClass): string =>
  process.env.GDELT_HEADLINES_PATH?.trim() || `.artifacts/gdelt/${market}-headlines.json`;

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

const main = async (): Promise<void> => {
  const config = loadAppConfig();
  const market = parseMarket();
  const outputPath = resolveOutputPath(market);
  const queries = market === 'crypto' ? cryptoGdeltQueries : stockGdeltQueries;
  const repository = new GdeltNewsFeedRepository(
    config.gdeltBaseUrl,
    config.gdeltTimespan,
    config.gdeltMaxRecords,
    config.apiRetryMaxAttempts,
    config.apiRetryInitialDelayMs,
    config.apiRetryMaxDelayMs,
    queries,
  );

  const headlines = await repository.getHeadlines();
  const artifact: CachedHeadlinesArtifact = {
    market,
    fetchedAt: new Date().toISOString(),
    headlines,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(artifact, null, 2), 'utf8');

  logger.info('Cached GDELT headlines for workflow reuse', {
    market,
    outputPath,
    headlines: headlines.length,
  });

  await writeOutput('headline_count', String(headlines.length));
  await writeOutput('headline_artifact_path', outputPath);
};

void main().catch((error) => {
  logger.error('Failed to fetch GDELT headlines', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
