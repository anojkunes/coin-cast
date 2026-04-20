import { readFile } from 'node:fs/promises';

import type {
  MarketAssetClass,
  MarketSignal,
  NewsFeedRepository,
  PretrainedMarketModel,
  ScanOptions,
} from '@coin-cast/core';
import {
  MarketSignalService,
  createLogger,
  cryptoScanProfile,
  stockScanProfile,
} from '@coin-cast/core';
import { KrakenMarketRepository } from '@coin-cast/market-crypto';
import { NasdaqStockRepository } from '@coin-cast/market-stocks';
import { GdeltNewsFeedRepository } from '@coin-cast/news-gdelt';
import { TelegramMessageComposer } from '@coin-cast/notifications-telegram';

import { telegramRepository } from './NotificationRepositoryConfig';
import type { AppConfig } from './env';

export interface CoinCastApp {
  run: () => Promise<{
    dispatchedMessages: number;
    scannedAt: Date;
  }>;
}

export interface CoinCastAppOptions {
  marketToRun: MarketAssetClass;
}

interface MarketRuntime {
  assetClass: MarketAssetClass;
  scanOptions: ScanOptions;
  signalService: MarketSignalService;
}

const logger = createLogger('coin-cast-runner');

const createNewsRepositories = (config: AppConfig): NewsFeedRepository[] => [
  new GdeltNewsFeedRepository(
    config.gdeltBaseUrl,
    config.gdeltTimespan,
    config.gdeltMaxRecords,
    config.apiRetryMaxAttempts,
    config.apiRetryInitialDelayMs,
    config.apiRetryMaxDelayMs,
  ),
];

const createCryptoScanOptions = (config: AppConfig): ScanOptions => ({
  universeLimit: config.krakenUniverseLimit,
  historyDays: config.krakenHistoryDays,
  symbolFilter: config.krakenSymbols,
  maxSignals: 5,
  actionableConfidence: 0.3,
});

const createStockScanOptions = (config: AppConfig): ScanOptions => ({
  universeLimit: config.stockUniverseLimit,
  historyDays: config.stockHistoryDays,
  historyLoadConcurrency: config.stockHistoryLoadConcurrency,
  symbolFilter: config.stockSymbols,
  maxSignals: 5,
  actionableConfidence: 0.28,
});

const isActionableSignal = (signal: MarketSignal): boolean =>
  signal.tradeVerdict === 'good' && signal.actionRecommendation !== 'wait';

const loadPretrainedModel = async (path: string): Promise<PretrainedMarketModel> => {
  const contents = await readFile(path, 'utf8');
  return JSON.parse(contents) as PretrainedMarketModel;
};

const createMarketRuntime = (
  config: AppConfig,
  marketToRun: MarketAssetClass,
  newsRepositories: NewsFeedRepository[],
): MarketRuntime => {
  if (marketToRun === 'crypto') {
    return {
      assetClass: 'crypto',
      scanOptions: createCryptoScanOptions(config),
      signalService: new MarketSignalService(
        new KrakenMarketRepository(
          config.krakenBaseUrl,
          config.apiRetryMaxAttempts,
          config.apiRetryInitialDelayMs,
          config.apiRetryMaxDelayMs,
        ),
        newsRepositories,
        cryptoScanProfile,
      ),
    };
  }

  return {
    assetClass: 'stock',
    scanOptions: createStockScanOptions(config),
    signalService: new MarketSignalService(
      new NasdaqStockRepository(
        config.nasdaqBaseUrl,
        config.apiRetryMaxAttempts,
        config.apiRetryInitialDelayMs,
        config.apiRetryMaxDelayMs,
        config.stockHistoryLoadConcurrency,
      ),
      newsRepositories,
      stockScanProfile,
    ),
  };
};

export const createCoinCastApp = (
  config: AppConfig,
  options: CoinCastAppOptions,
): CoinCastApp => {
  const newsRepositories = createNewsRepositories(config);
  const notificationRepository = telegramRepository(config);
  const messageComposer = new TelegramMessageComposer();
  const marketRuntime = createMarketRuntime(
    config,
    options.marketToRun,
    newsRepositories,
  );

  return {
    async run() {
      const runStartedAt = Date.now();
      let queuedMessages = 0;
      let dispatchedMessages = 0;
      let dispatchQueue = Promise.resolve();
      const pretrainedModelPath =
        marketRuntime.assetClass === 'crypto'
          ? config.krakenModelArtifactPath
          : config.stockModelArtifactPath;
      const pretrainedModel = pretrainedModelPath
        ? await loadPretrainedModel(pretrainedModelPath)
        : undefined;

      const enqueueSignalNotification = (signal: MarketSignal, scannedAt: Date): void => {
        if (!isActionableSignal(signal)) {
          return;
        }

        const message = messageComposer.composeSignal(signal, scannedAt);
        queuedMessages += 1;
        const messageNumber = queuedMessages;

        dispatchQueue = dispatchQueue.then(async () => {
          if (dispatchedMessages > 0 && config.telegramMessageDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, config.telegramMessageDelayMs));
          }

          logger.info('Dispatching Telegram message', {
            market: marketRuntime.assetClass,
            messageNumber,
            messageLength: message.length,
            symbol: signal.symbol,
            direction: signal.direction,
            actionRecommendation: signal.actionRecommendation,
          });

          await notificationRepository.send(message);
          dispatchedMessages += 1;
        });
      };

      logger.info('Running market scan', {
        market: marketRuntime.assetClass,
        scanOptions: marketRuntime.scanOptions,
        pretrainedModelLoaded: pretrainedModel != null,
      });
      const scanStartedAt = Date.now();
      const result = await marketRuntime.signalService.scan(
        marketRuntime.scanOptions,
        {
          pretrainedModel,
          hooks: {
            onSignal: (signal, context) => {
              enqueueSignalNotification(signal, context.scannedAt);
            },
          },
        },
      );
      const scanDurationMs = Date.now() - scanStartedAt;

      logger.info('Market scan completed; awaiting queued Telegram delivery', {
        market: marketRuntime.assetClass,
        assetsScanned: result.assetsScanned,
        signals: result.signals.length,
        watchlist: result.watchlist.length,
        ignoredAssets: result.ignoredAssets.length,
        queuedMessages,
        scanDurationMs,
      });

      const dispatchStartedAt = Date.now();
      await dispatchQueue;

      if (dispatchedMessages === 0) {
        logger.info('No Telegram messages were dispatched for this run', {
          market: marketRuntime.assetClass,
        });
      }

      const dispatchDurationMs = Date.now() - dispatchStartedAt;
      logger.info('Market run finished', {
        market: marketRuntime.assetClass,
        scannedAt: result.scannedAt.toISOString(),
        dispatchedMessages,
        queuedMessages,
        scanDurationMs,
        dispatchDurationMs,
        totalDurationMs: Date.now() - runStartedAt,
      });

      return {
        dispatchedMessages,
        scannedAt: result.scannedAt,
      };
    },
  };
};
