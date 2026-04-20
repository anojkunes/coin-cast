import { describe, expect, it } from 'vitest';

import type { MarketRepository, NewsFeed, NewsFeedRepository, MarketAsset } from '../src/index';

import { MarketSignalService, stockScanProfile } from '../src/index';

const createCandles = (startPrice: number, dipPrice: number, endPrice: number, count: number) => {
  const candles = [];
  const start = Date.UTC(2025, 0, 1);
  for (let index = 0; index < count; index += 1) {
    const ratio = index / Math.max(1, count - 1);
    const price =
      ratio < 0.35
        ? startPrice + (dipPrice - startPrice) * (ratio / 0.35)
        : dipPrice + (endPrice - dipPrice) * ((ratio - 0.35) / 0.65);
    candles.push({
      timestamp: start + index * 86_400_000,
      close: price,
      volume: 2_000_000 + index * 40_000,
    });
  }

  return candles;
};

class FakeMarketRepository implements MarketRepository {
  async getUniverse(): Promise<MarketAsset[]> {
    return [
      {
        id: 'MSFT',
        symbol: 'MSFT',
        name: 'Microsoft',
        assetClass: 'stock',
        marketSegment: 'stock',
        currentPriceUsd: 422.79,
        change24hPercent: 1.2,
        marketPageUrl: 'https://www.nasdaq.com/market-activity/stocks/msft',
        marketPageLabel: 'Nasdaq market page',
      },
    ];
  }

  async getHistoricalCandles(): Promise<Array<{ timestamp: number; close: number; volume: number }>> {
    return createCandles(100, 84, 220, 120);
  }

  async getOrderBook(): Promise<null> {
    return null;
  }
}

class FakeNewsRepository implements NewsFeedRepository {
  async getHeadlines(): Promise<NewsFeed[]> {
    return [
      {
        title: 'Microsoft rally accelerates after strong enterprise update',
        description: 'The stock is moving higher after another positive product update.',
        author: 'CoinCast',
        link: 'https://example.com',
        publishedAt: Date.now(),
      },
    ];
  }
}

describe('MarketSignalService with the stock profile', () => {
  it('produces a stock signal with the stock asset class profile', async () => {
    const service = new MarketSignalService(
      new FakeMarketRepository(),
      [new FakeNewsRepository()],
      stockScanProfile,
    );

    const result = await service.scan({
      universeLimit: 1,
      historyDays: 90,
      maxSignals: 5,
      actionableConfidence: 0.1,
    });

    expect(result.assetsScanned).toBe(1);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.assetClass).toBe('stock');
    expect(result.signals[0]?.symbol).toBe('MSFT');
    expect(result.signals[0]?.direction).toBe('bullish');
  });

  it('can scan with a pretrained stock model artifact', async () => {
    const service = new MarketSignalService(
      new FakeMarketRepository(),
      [new FakeNewsRepository()],
      stockScanProfile,
    );

    const scanOptions = {
      universeLimit: 1,
      historyDays: 90,
      maxSignals: 5,
      actionableConfidence: 0.1,
    };
    const pretrainedModel = await service.train(scanOptions);
    const result = await service.scan(scanOptions, {
      pretrainedModel,
    });

    expect(pretrainedModel.assetClass).toBe('stock');
    expect(pretrainedModel.samplesUsed).toBeGreaterThan(0);
    expect(result.assetsScanned).toBe(1);
    expect(result.signals).toHaveLength(1);
    expect(result.modelQuality.qualityLabel).toBe(pretrainedModel.modelQuality.qualityLabel);
  });
});
