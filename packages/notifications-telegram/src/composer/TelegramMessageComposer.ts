import type {
  IgnoredAssetSummary,
  MarketAssetClass,
  MarketSignal,
} from '@coin-cast/core';

interface MarketSectionSummary {
  assetClass: MarketAssetClass;
  scannedAt: Date;
  assetsScanned: number;
  signalCount: number;
  watchlistCount: number;
  ignoredCount: number;
}

const formatPercent = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const formatConfidence = (value: number): string => `${(value * 100).toFixed(1)}%`;

const formatDirection = (direction: MarketSignal['direction']): string =>
  direction === 'bullish' ? 'Likely up' : 'Likely down';

const directionEmoji = (direction: MarketSignal['direction']): string =>
  direction === 'bullish' ? '🟢📈✨' : '🔴📉⚠️';

const marketLabel = (assetClass: MarketAssetClass): string =>
  assetClass === 'crypto' ? 'Crypto' : 'Stocks';

const assetSingular = (assetClass: MarketAssetClass): string =>
  assetClass === 'crypto' ? 'coin' : 'stock';

const assetPlural = (assetClass: MarketAssetClass): string =>
  assetClass === 'crypto' ? 'coins' : 'stocks';

const sectionEmoji = (assetClass: MarketAssetClass): string =>
  assetClass === 'crypto' ? '🪙' : '📊';

const formatOrderBookLabel = (score: number): string => {
  if (score >= 0.7) {
    return 'Healthy';
  }

  if (score >= 0.5) {
    return 'Okay';
  }

  return 'Weak';
};

const formatVerdict = (verdict: MarketSignal['tradeVerdict']): string => {
  if (verdict === 'good') {
    return 'Good';
  }

  if (verdict === 'mixed') {
    return 'There may be something here, but trade at your own risk';
  }

  return 'Avoid';
};

const formatAction = (action: MarketSignal['actionRecommendation']): string => {
  if (action === 'buy') {
    return 'Buy';
  }

  if (action === 'wait') {
    return 'Wait';
  }

  return 'Avoid';
};

const confidenceLegend = [
  'Confidence guide:',
  '50% = no edge',
  '55-60% = mild edge',
  '60-70% = decent edge',
  '70%+ = stronger edge, but still not certain',
].join(' | ');

const formatMarketLinkLine = (
  signal: Pick<MarketSignal, 'marketPageUrl' | 'marketPageLabel'>,
): string | null => {
  if (!signal.marketPageUrl) {
    return null;
  }

  return `${signal.marketPageLabel ?? 'Market page'}: ${signal.marketPageUrl}`;
};

export class TelegramMessageComposer {
  composeRunIntro(assetClass: MarketAssetClass): string {
    const label = marketLabel(assetClass);

    return [
      `🛰️ Coin Cast ${label.toLowerCase()} scan`,
      `Market in this run: ${label}`,
      confidenceLegend,
      'Crypto and stocks are executed as separate runs.',
    ].join('\n');
  }

  composeSectionIntro(summary: MarketSectionSummary): string {
    const timestamp = summary.scannedAt.toISOString().replace('T', ' ').replace('Z', ' UTC');
    const label = marketLabel(summary.assetClass);
    const singular = assetSingular(summary.assetClass);

    const lines = [
      `${sectionEmoji(summary.assetClass)} ${label} scan`,
      `Time: ${timestamp}`,
      `Assets scanned: ${summary.assetsScanned} | Strong signals: ${summary.signalCount} | Watchlist: ${summary.watchlistCount} | Ignored shown: ${summary.ignoredCount}`,
    ];

    if (summary.signalCount === 0) {
      lines.push(`No strong ${label.toLowerCase()} signal passed the threshold in this run.`);
    }

    lines.push(`Each ${singular} is sent as its own Telegram message.`);

    return lines.join('\n');
  }

  composeIgnoredAsset(asset: IgnoredAssetSummary): string {
    return [
      `🚫 ${marketLabel(asset.assetClass)} | ${asset.symbol} (${asset.name})`,
      `Ignored because: ${asset.reason}`,
    ].join('\n');
  }

  composeIgnoredAssets(ignoredAssets: IgnoredAssetSummary[]): string[] {
    return ignoredAssets.map((asset) => this.composeIgnoredAsset(asset));
  }

  composeWatchlist(watchlist: MarketSignal[], scannedAt: Date): string | null {
    if (watchlist.length === 0) {
      return null;
    }

    const firstSignal = watchlist[0];
    if (!firstSignal) {
      return null;
    }

    const timestamp = scannedAt.toISOString().replace('T', ' ').replace('Z', ' UTC');
    const lines: string[] = [
      `👀 ${marketLabel(firstSignal.assetClass)} watchlist`,
      `Time: ${timestamp}`,
      `Near-pass ${assetPlural(firstSignal.assetClass)}: ${watchlist.length}`,
      '',
    ];

    for (const signal of watchlist) {
      const emoji = directionEmoji(signal.direction);
      const label = formatDirection(signal.direction);
      const change = signal.change24hPercent ?? 0;

      lines.push(`${emoji} ${signal.symbol} (${signal.name}) - ${label} ${formatConfidence(signal.fiveHourProbabilityUp)}`);
      const chartLine = formatMarketLinkLine(signal);
      if (chartLine) {
        lines.push(chartLine);
      }
      lines.push(
        `Recent price change: ${formatPercent(change)} | Best action now: ${formatAction(signal.actionRecommendation)}`,
      );
      if (signal.orderBookScore != null) {
        lines.push(
          `Order book: ${formatOrderBookLabel(signal.orderBookScore)} | spread: ${signal.orderBookSpreadPercent?.toFixed(2) ?? 'n/a'}% | imbalance: ${(signal.orderBookImbalance ?? 0).toFixed(2)}`,
        );
      }
      lines.push(`Why close: ${signal.reasons.slice(0, 2).join('; ')}`);
      lines.push('');
    }

    return lines.join('\n').trim();
  }

  composeWatchlistSignal(signal: MarketSignal, scannedAt?: Date): string {
    return [
      `👀 ${marketLabel(signal.assetClass)} watchlist candidate`,
      this.composeSignal(signal, scannedAt),
    ].join('\n');
  }

  composeWatchlistSignals(watchlist: MarketSignal[], scannedAt?: Date): string[] {
    return watchlist.map((signal) => this.composeWatchlistSignal(signal, scannedAt));
  }

  composeSignal(signal: MarketSignal, scannedAt?: Date): string {
    const change = signal.change24hPercent ?? 0;
    const price = signal.priceUsd == null ? 'n/a' : signal.priceUsd.toFixed(4);
    const trendLabel = formatDirection(signal.direction);
    const emoji = directionEmoji(signal.direction);
    const now = scannedAt ?? new Date();
    const windowStart = new Date(now.getTime());
    const windowEnd = new Date(now.getTime() + 5 * 3_600_000);
    const windowStartText = windowStart.toISOString().replace('T', ' ').replace('Z', ' UTC');
    const windowEndText = windowEnd.toISOString().replace('T', ' ').replace('Z', ' UTC');

    const lines: string[] = [
      `${emoji} ${signal.symbol} (${signal.name})`,
      `Market: ${marketLabel(signal.assetClass)}`,
      `Forecast for next 5h: ${trendLabel} ${formatConfidence(signal.fiveHourProbabilityUp)}`,
      `Best action now: ${formatAction(signal.actionRecommendation)}`,
      `Window: ${windowStartText} -> ${windowEndText}`,
      `Recent price change: ${formatPercent(change)} | Price: $${price}`,
      `Confidence: ${formatConfidence(signal.confidence)} | Trade quality: ${formatVerdict(signal.tradeVerdict)} | Score: ${(signal.tradeSuitabilityScore ?? 0).toFixed(2)}`,
      `News score: ${(signal.newsScore ?? 0).toFixed(2)} | Model up-probability: ${formatConfidence(signal.modelProbabilityUp)}`,
      `Quality score: ${(signal.qualityScore ?? 0).toFixed(2)} | Market regime: ${(signal.marketConditionScore ?? 0).toFixed(2)} | Relative strength: ${(signal.relativeStrengthScore ?? 0).toFixed(2)}`,
    ];

    if (signal.orderBookScore != null) {
      lines.push(
        `Order book: ${formatOrderBookLabel(signal.orderBookScore)} | spread: ${signal.orderBookSpreadPercent?.toFixed(2) ?? 'n/a'}% | imbalance: ${(signal.orderBookImbalance ?? 0).toFixed(2)}`,
      );
    }

    const chartLine = formatMarketLinkLine(signal);
    if (chartLine) {
      lines.splice(4, 0, chartLine);
    }

    if (signal.reasons.length > 0) {
      lines.push(`Why: ${signal.reasons.join('; ')}`);
    }

    return lines.join('\n').trim();
  }

  composeSignals(signals: MarketSignal[], scannedAt?: Date): string[] {
    return signals.map((signal) => this.composeSignal(signal, scannedAt));
  }
}
