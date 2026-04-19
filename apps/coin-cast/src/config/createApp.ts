import type {
  MarketAssetClass,
  NewsFeedRepository,
  ScanOptions,
  ScanResult,
} from '@coin-cast/core';
import {
  MarketSignalService,
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
    message: string;
    scannedAt: Date;
  }>;
}

export interface CoinCastAppOptions {
  marketToRun: MarketAssetClass;
}

interface MarketRunResult {
  assetClass: MarketAssetClass;
  result: ScanResult;
}

interface MarketRuntime {
  assetClass: MarketAssetClass;
  scanOptions: ScanOptions;
  signalService: MarketSignalService;
}

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

const buildMessages = (
  composer: TelegramMessageComposer,
  marketResult: MarketRunResult,
): string[] => {
  const { assetClass, result } = marketResult;
  const messages = [composer.composeRunIntro(assetClass)];

  messages.push(
    composer.composeSectionIntro({
      assetClass,
      scannedAt: result.scannedAt,
      assetsScanned: result.assetsScanned,
      signalCount: result.signals.length,
      watchlistCount: result.watchlist.length,
      ignoredCount: result.ignoredAssets.length,
    }),
  );
  messages.push(...composer.composeIgnoredAssets(result.ignoredAssets));

  const watchlistMessage = composer.composeWatchlist(result.watchlist, result.scannedAt);
  if (watchlistMessage) {
    messages.push(watchlistMessage);
  }

  messages.push(...composer.composeSignals(result.signals, result.scannedAt));

  return messages.filter(Boolean);
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
      const result = await marketRuntime.signalService.scan(
        marketRuntime.scanOptions,
      );

      const messages = buildMessages(messageComposer, {
        assetClass: marketRuntime.assetClass,
        result,
      });

      for (let index = 0; index < messages.length; index += 1) {
        if (index > 0 && config.telegramMessageDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.telegramMessageDelayMs));
        }

        const message = messages[index];
        if (!message) {
          continue;
        }
        await notificationRepository.send(message);
      }

      return {
        message: messages.join('\n\n'),
        scannedAt: result.scannedAt,
      };
    },
  };
};
