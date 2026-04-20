import { describe, expect, it } from 'vitest';

import type { MarketRepository, NewsFeed, NewsFeedRepository, MarketAsset } from '../src/index';

import { MarketSignalService, cryptoScanProfile } from '../src/index';

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
      volume: 1_000_000 + index * 25_000,
    });
  }

  return candles;
};

class FakeMarketRepository implements MarketRepository {
  async getUniverse(): Promise<MarketAsset[]> {
    return [
      {
        id: 'XXBTZUSD',
        symbol: 'BTC',
        name: 'Bitcoin',
        assetClass: 'crypto',
        marketSegment: 'crypto',
        currentPriceUsd: 102_000,
        change24hPercent: 4.2,
      },
    ];
  }

  async getHistoricalCandles(): Promise<Array<{ timestamp: number; close: number; volume: number }>> {
    return createCandles(100, 84, 220, 120);
  }

  async getOrderBook(): Promise<{
    assetId: string;
    bids: Array<{ price: number; volume: number }>;
    asks: Array<{ price: number; volume: number }>;
  } | null> {
    return {
      assetId: 'XXBTZUSD',
      bids: [
        { price: 219, volume: 5_000 },
        { price: 218.5, volume: 4_500 },
      ],
      asks: [
        { price: 219.2, volume: 4_800 },
        { price: 219.6, volume: 4_200 },
      ],
    };
  }
}

class FakeNewsRepository implements NewsFeedRepository {
  async getHeadlines(): Promise<NewsFeed[]> {
    return [
      {
        title: 'Bitcoin rally surge breakout after partnership milestone',
        description: 'The market sees another bullish breakout with strong adoption.',
        author: 'CoinCast',
        link: 'https://example.com',
        publishedAt: Date.now(),
      },
    ];
  }
}

describe('MarketSignalService', () => {
  it('produces a bullish signal for a clear uptrend with positive news', async () => {
    const service = new MarketSignalService(
      new FakeMarketRepository(),
      [new FakeNewsRepository()],
      cryptoScanProfile,
    );

    const result = await service.scan({
      universeLimit: 1,
      historyDays: 90,
      maxSignals: 5,
      actionableConfidence: 0.1,
    });

    expect(result.assetsScanned).toBe(1);
    expect(result.signals).toHaveLength(1);
    expect(result.watchlist).toHaveLength(0);
    expect(result.ignoredAssets).toHaveLength(0);
    expect(result.modelQuality.samplesEvaluated).toBeGreaterThan(0);
    expect(result.signals[0]?.symbol).toBe('BTC');
    expect(result.signals[0]?.assetClass).toBe('crypto');
    expect(result.signals[0]?.direction).toBe('bullish');
    expect(result.signals[0]?.confidence).toBeGreaterThan(0.5);
    expect(result.signals[0]?.expectedDurationHours).toBeGreaterThan(0);
    expect(['good', 'mixed', 'avoid']).toContain(result.signals[0]?.tradeVerdict);
  });

  it('can scan with a pretrained crypto model artifact', async () => {
    const service = new MarketSignalService(
      new FakeMarketRepository(),
      [new FakeNewsRepository()],
      cryptoScanProfile,
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

    expect(pretrainedModel.assetClass).toBe('crypto');
    expect(pretrainedModel.samplesUsed).toBeGreaterThan(0);
    expect(result.assetsScanned).toBe(1);
    expect(result.signals).toHaveLength(1);
    expect(result.modelQuality.qualityLabel).toBe(pretrainedModel.modelQuality.qualityLabel);
  });
});
