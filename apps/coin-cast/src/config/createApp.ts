import type {
  MarketAssetClass,
  NewsFeedRepository,
  ScanOptions,
  ScanResult,
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
  maxSignals: 5,
  actionableConfidence: 0.3,
});

const createStockScanOptions = (config: AppConfig): ScanOptions => ({
  universeLimit: config.stockUniverseLimit,
  historyDays: config.stockHistoryDays,
  maxSignals: 5,
  actionableConfidence: 0.28,
});

const getDispatchableMessageCount = (result: ScanResult): number =>
  result.ignoredAssets.length + result.watchlist.length + result.signals.length;

function* streamMessages(
  composer: TelegramMessageComposer,
  result: ScanResult,
): Generator<string> {
  for (const message of composer.composeIgnoredAssets(result.ignoredAssets)) {
    yield message;
  }

  for (const message of composer.composeWatchlistSignals(result.watchlist, result.scannedAt)) {
    yield message;
  }

  for (const message of composer.composeSignals(result.signals, result.scannedAt)) {
    yield message;
  }
}

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
      logger.info('Running market scan', {
        market: marketRuntime.assetClass,
        scanOptions: marketRuntime.scanOptions,
      });
      const result = await marketRuntime.signalService.scan(
        marketRuntime.scanOptions,
      );
      const totalMessages = getDispatchableMessageCount(result);

      logger.info('Prepared Telegram messages', {
        market: marketRuntime.assetClass,
        messages: totalMessages,
        assetsScanned: result.assetsScanned,
        signals: result.signals.length,
        watchlist: result.watchlist.length,
        ignoredAssets: result.ignoredAssets.length,
      });

      let dispatchedMessages = 0;

      for (const message of streamMessages(messageComposer, result)) {
        if (dispatchedMessages > 0 && config.telegramMessageDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.telegramMessageDelayMs));
        }

        dispatchedMessages += 1;
        logger.info('Dispatching Telegram message', {
          market: marketRuntime.assetClass,
          messageNumber: dispatchedMessages,
          totalMessages,
          messageLength: message.length,
        });
        await notificationRepository.send(message);
      }

      if (dispatchedMessages === 0) {
        logger.info('No Telegram messages were dispatched for this run', {
          market: marketRuntime.assetClass,
        });
      }

      logger.info('Market run finished', {
        market: marketRuntime.assetClass,
        scannedAt: result.scannedAt.toISOString(),
        dispatchedMessages,
      });

      return {
        dispatchedMessages,
        scannedAt: result.scannedAt,
      };
    },
  };
};
