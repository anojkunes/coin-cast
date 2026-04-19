import type { AssetQuality } from '../../domain/models/AssetQuality';
import type { Candle } from '../../domain/models/Candle';
import type { MarketAsset } from '../../domain/models/MarketAsset';

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

const pctChange = (current: number, previous: number): number =>
  previous === 0 ? 0 : (current - previous) / previous;

const standardDeviation = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export class AssetQualityService {
  evaluate(asset: MarketAsset, candles: Candle[]): AssetQuality {
    if (candles.length < 30) {
      return {
        score: 0.15,
        reasons: ['limited price history'],
      };
    }

    const closes = candles.map((candle) => candle.close);
    const volumes = candles.map((candle) => candle.volume);
    const recentVolumes = volumes.slice(-14);
    const recentReturns = closes.slice(-14).map((close, index, array) =>
      index === 0 ? 0 : pctChange(close, array[index - 1]),
    );
    const avgVolume = mean(recentVolumes);
    const zeroVolumeDays = recentVolumes.filter((volume) => volume <= 0).length;
    const volatility = standardDeviation(recentReturns);
    const marketCapRank = asset.marketCapRank ?? 9999;

    let score = 1;
    const reasons: string[] = [];

    if (avgVolume < 500_000) {
      score -= 0.35;
      reasons.push('low recent trading volume');
    } else if (avgVolume < 5_000_000) {
      score -= 0.15;
      reasons.push('moderate trading volume');
    }

    if (zeroVolumeDays > 2) {
      score -= 0.2;
      reasons.push('thin volume consistency');
    }

    if (volatility > 0.18) {
      score -= 0.2;
      reasons.push('high short-term volatility');
    } else if (volatility < 0.04) {
      score += 0.05;
      reasons.push('stable short-term volatility');
    }

    if (marketCapRank <= 100) {
      score += 0.15;
      reasons.push('top market-cap tier');
    } else if (marketCapRank > 500) {
      score -= 0.1;
      reasons.push('lower market-cap tier');
    }

    if ((asset.change24hPercent ?? 0) > 25) {
      score -= 0.1;
      reasons.push('recent move is already stretched');
    }

    return {
      score: clamp(score, 0, 1),
      reasons: reasons.slice(0, 3),
    };
  }
}
