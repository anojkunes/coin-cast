import { describe, expect, it } from 'vitest';

import { TelegramMessageComposer } from '../src/index';

describe('TelegramMessageComposer', () => {
  it('formats individual watchlist and signal messages', () => {
    const composer = new TelegramMessageComposer();

    const scannedAt = new Date('2026-04-10T20:00:00.000Z');
    const runIntro = composer.composeRunIntro('crypto');
    const sectionIntro = composer.composeSectionIntro({
      assetClass: 'crypto',
      scannedAt,
      assetsScanned: 12,
      signalCount: 1,
      watchlistCount: 1,
      ignoredCount: 1,
    });
    const ignored = composer.composeIgnoredAssets([
      {
        assetId: 'ignored-1',
        assetClass: 'stock',
        symbol: 'IGN',
        name: 'Ignored One',
        reason: 'confidence 18% below alert threshold 31%',
      },
    ]);
    const signal = composer.composeSignal(
      {
        assetId: 'bitcoin',
        assetClass: 'crypto',
        symbol: 'BTC',
        name: 'Bitcoin',
        direction: 'bullish',
        confidence: 0.82,
        fiveHourProbabilityUp: 0.82,
        actionRecommendation: 'buy',
        expectedDurationHours: 72,
        expectedDurationLabel: '3-5 days',
        tradeSuitabilityScore: 0.84,
        tradeVerdict: 'good',
        modelProbabilityUp: 0.77,
        newsScore: 0.4,
        qualityScore: 0.9,
        marketConditionScore: 0.7,
        relativeStrengthScore: 0.08,
        priceUsd: 101_234.567,
        change24hPercent: 3.42,
        marketPageUrl: 'https://www.kraken.com/prices/bitcoin',
        marketPageLabel: 'Kraken market page',
        reasons: ['price is above short- and medium-term trend', 'news sentiment is positive'],
      },
      scannedAt,
    );

    expect(runIntro).toContain('🛰️ Coin Cast crypto scan');
    expect(runIntro).toContain('Market in this run: Crypto');
    expect(runIntro).toContain('Crypto and stocks are executed as separate runs.');
    expect(sectionIntro).toContain('🪙 Crypto scan');
    expect(sectionIntro).toContain('Assets scanned: 12 | Strong signals: 1 | Watchlist: 1 | Ignored shown: 1');
    expect(ignored).toHaveLength(1);
    expect(ignored[0]).toContain('🚫 Stocks | IGN (Ignored One)');
    expect(ignored[0]).toContain('Ignored because: confidence 18% below alert threshold 31%');
    const watchlistMessages = composer.composeWatchlistSignals(
      [
        {
          assetId: 'watch1',
          assetClass: 'stock',
          symbol: 'W1',
          name: 'Watch One',
          direction: 'bearish',
          confidence: 0.41,
          fiveHourProbabilityUp: 0.39,
          actionRecommendation: 'wait',
          expectedDurationHours: 48,
          expectedDurationLabel: '1-2 days',
          tradeSuitabilityScore: 0.49,
          tradeVerdict: 'mixed',
          modelProbabilityUp: 0.48,
          newsScore: -0.1,
          qualityScore: 0.52,
          marketConditionScore: 0.4,
          relativeStrengthScore: -0.03,
          priceUsd: 1.23,
          change24hPercent: -2.3,
          reasons: ['close to threshold', 'momentum is mixed'],
        },
      ],
      scannedAt,
    );
    expect(watchlistMessages).toHaveLength(1);
    expect(watchlistMessages[0]).toContain('👀 Stocks watchlist candidate');
    expect(watchlistMessages[0]).toContain('W1 (Watch One)');
    expect(signal).toContain('🟢📈✨ BTC (Bitcoin)');
    expect(signal).toContain('Market: Crypto');
    expect(signal).toContain('Forecast for next 5h: Likely up 82.0%');
    expect(signal).toContain('Best action now: Buy');
    expect(signal).toContain('Kraken market page: https://www.kraken.com/prices/bitcoin');
    expect(signal).toContain('Recent price change: +3.42% | Price: $101234.5670');
    expect(signal).toContain(
      'Window: 2026-04-10 20:00:00.000 UTC -> 2026-04-11 01:00:00.000 UTC',
    );
    expect(signal).toContain('Confidence: 82.0% | Trade quality: Good');

    const stockSignal = composer.composeSignal(
      {
        assetId: 'msft',
        assetClass: 'stock',
        symbol: 'MSFT',
        name: 'Microsoft',
        direction: 'bullish',
        confidence: 0.71,
        fiveHourProbabilityUp: 0.73,
        actionRecommendation: 'buy',
        expectedDurationHours: 48,
        expectedDurationLabel: '1-2 days',
        tradeSuitabilityScore: 0.78,
        tradeVerdict: 'good',
        modelProbabilityUp: 0.69,
        newsScore: 0.12,
        qualityScore: 0.88,
        marketConditionScore: 0.64,
        relativeStrengthScore: 0.05,
        priceUsd: 422.79,
        change24hPercent: 1.21,
        marketPageUrl: 'https://www.nasdaq.com/market-activity/stocks/msft',
        marketPageLabel: 'Nasdaq market page',
        reasons: ['outperforming SPY and QQQ'],
      },
      scannedAt,
    );

    expect(stockSignal).toContain('Market: Stocks');
    expect(stockSignal).toContain('Nasdaq market page: https://www.nasdaq.com/market-activity/stocks/msft');

    const noLinkSignal = composer.composeSignal(
      {
        assetId: 'no-link',
        assetClass: 'stock',
        symbol: 'NRL',
        name: 'No Link',
        direction: 'bearish',
        confidence: 0.6,
        fiveHourProbabilityUp: 0.2,
        actionRecommendation: 'avoid',
        expectedDurationHours: 48,
        expectedDurationLabel: '1-2 days',
        tradeSuitabilityScore: 0.3,
        tradeVerdict: 'avoid',
        modelProbabilityUp: 0.4,
        newsScore: 0,
        qualityScore: 0.5,
        marketConditionScore: 0.5,
        relativeStrengthScore: 0,
        priceUsd: 1,
        change24hPercent: -1,
        reasons: ['example'],
      },
      scannedAt,
    );

    expect(noLinkSignal).not.toContain('Market page:');
  });
});
