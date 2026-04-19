import { EMA, MACD, RSI } from '../../vendor/trading-signals/index.js';

import type { Candle } from '../../domain/models/Candle';
import type { MarketAsset } from '../../domain/models/MarketAsset';

export interface MarketSample {
  features: number[];
  label: number;
}

export interface MarketSnapshot {
  features: number[];
  priceUsd: number;
  change24hPercent: number;
  reasons: string[];
  relativeStrengthScore: number;
  volumeConfirmationScore: number;
  trendStrengthScore: number;
  longTermTrendScore: number;
  volatilityScore: number;
  rsiValue: number;
}

export interface BenchmarkCandles {
  primary: Candle[];
  secondary: Candle[];
  displayLabel: string;
}

const pctChange = (current: number, previous: number): number => {
  if (previous === 0) {
    return 0;
  }

  const value = (current - previous) / previous;
  return Number.isFinite(value) ? value : 0;
};

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / (values.length || 1);

const standardDeviation = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const slope = (values: number[]): number => {
  if (values.length < 2) {
    return 0;
  }

  const xMean = mean(values.map((_, index) => index));
  const yMean = mean(values);

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }

  return denominator === 0 ? 0 : numerator / denominator;
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
};

const normalize = (value: number, scale: number): number => {
  if (scale === 0) {
    return 0;
  }

  return clamp(value / scale, -1, 1);
};

const correlation = (left: number[], right: number[]): number => {
  const size = Math.min(left.length, right.length);
  if (size < 3) {
    return 0;
  }

  const leftSlice = left.slice(-size);
  const rightSlice = right.slice(-size);
  const leftMean = mean(leftSlice);
  const rightMean = mean(rightSlice);

  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < size; index += 1) {
    const leftDelta = leftSlice[index] - leftMean;
    const rightDelta = rightSlice[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }

  const denominator = Math.sqrt(leftVariance * rightVariance);
  const value = denominator === 0 ? 0 : numerator / denominator;
  return Number.isFinite(value) ? value : 0;
};

const returns = (candles: Candle[]): number[] => {
  const result: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    result.push(pctChange(candles[index].close, candles[index - 1].close));
  }

  return result;
};

const alignByTimestamp = (source: Candle[], target: Candle[]): Candle[] => {
  if (source.length === 0 || target.length === 0) {
    return [];
  }

  const targetByTimestamp = new Map(target.map((candle) => [candle.timestamp, candle] as const));
  const aligned: Candle[] = [];

  for (const candle of source) {
    const exact = targetByTimestamp.get(candle.timestamp);
    if (exact) {
      aligned.push(exact);
      continue;
    }

    let closest = target[0];
    let closestDistance = Math.abs(target[0].timestamp - candle.timestamp);

    for (const candidate of target) {
      const distance = Math.abs(candidate.timestamp - candle.timestamp);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }

    aligned.push(closest);
  }

  return aligned;
};

export class MarketFeatureBuilder {
  async buildSamples(
    candles: Candle[],
    asset?: MarketAsset,
    benchmarks?: BenchmarkCandles,
  ): Promise<MarketSample[]> {
    const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
    if (sorted.length < 30) {
      return [];
    }

    const alignedBenchmarks = this.alignBenchmarks(sorted, benchmarks);
    const candlesWithIndicators = await this.buildIndicators(sorted);
    const warmup = 21;
    const samples: MarketSample[] = [];

    for (let index = warmup; index < sorted.length - 1; index += 1) {
      samples.push({
        features: this.buildFeatureVector(sorted, candlesWithIndicators, alignedBenchmarks, index, asset),
        label: sorted[index + 1].close > sorted[index].close ? 1 : 0,
      });
    }

    return samples;
  }

  async buildSnapshot(
    candles: Candle[],
    asset?: MarketAsset,
    benchmarks?: BenchmarkCandles,
  ): Promise<MarketSnapshot | null> {
    const sorted = [...candles].sort((left, right) => left.timestamp - right.timestamp);
    if (sorted.length < 30) {
      return null;
    }

    const alignedBenchmarks = this.alignBenchmarks(sorted, benchmarks);
    const candlesWithIndicators = await this.buildIndicators(sorted);
    const index = sorted.length - 1;
    const features = this.buildFeatureVector(
      sorted,
      candlesWithIndicators,
      alignedBenchmarks,
      index,
      asset,
    );
    const context = this.buildContextScores(sorted, alignedBenchmarks, index, asset);
    const reasons = this.buildReasons(sorted, candlesWithIndicators, alignedBenchmarks, index, asset);
    const closes = sorted.map((candle) => candle.close);
    const ema7 = candlesWithIndicators.ema7[index] ?? closes[index];
    const ema21 = candlesWithIndicators.ema21[index] ?? closes[index];
    const ema50 = candlesWithIndicators.ema50[index] ?? closes[index];
    const rsiValue = this.readAlignedIndicator(candlesWithIndicators.rsi14, closes.length, index);
    const macdHistogram = this.readAlignedIndicator(
      candlesWithIndicators.macdHistogram,
      closes.length,
      index,
    );
    const recentReturns = this.collectReturns(closes, index, 14);
    const trendStrengthScore = clamp(
      Math.abs(pctChange(closes[index], ema21)) * 4 +
        Math.abs(pctChange(ema7, ema21)) * 8 +
        Math.abs(macdHistogram / (closes[index] || 1)) * 30,
      0,
      1,
    );
    const longTermTrendScore = clamp(
      Math.abs(pctChange(closes[index], ema50)) * 4 + Math.abs(slope(closes.slice(Math.max(0, index - 29), index + 1)) / closes[index]) * 20,
      0,
      1,
    );
    const volatilityScore = clamp(standardDeviation(recentReturns) / 0.12, 0, 1);

    return {
      features,
      priceUsd: sorted[index].close,
      change24hPercent: pctChange(sorted[index].close, sorted[Math.max(0, index - 1)].close) * 100,
      reasons,
      relativeStrengthScore: context.relativeStrengthScore,
      volumeConfirmationScore: context.volumeConfirmationScore,
      trendStrengthScore,
      longTermTrendScore,
      volatilityScore,
      rsiValue,
    };
  }

  private async buildIndicators(candles: Candle[]): Promise<{
    ema7: number[];
    ema21: number[];
    ema50: number[];
    rsi14: number[];
    macdHistogram: number[];
  }> {
    const closes = candles.map((candle) => candle.close);

    const ema7Indicator = new EMA(7);
    const ema21Indicator = new EMA(21);
    const ema50Indicator = new EMA(50);
    const rsi14Indicator = new RSI(14);
    const macdIndicator = new MACD(new EMA(12), new EMA(26), new EMA(9));

    const ema7: number[] = [];
    const ema21: number[] = [];
    const ema50: number[] = [];
    const rsi14: number[] = [];
    const macdHistogram: number[] = [];

    for (const close of closes) {
      const ema7Value = ema7Indicator.add(close);
      if (ema7Value != null) {
        ema7.push(ema7Value);
      }

      const ema21Value = ema21Indicator.add(close);
      if (ema21Value != null) {
        ema21.push(ema21Value);
      }

      const ema50Value = ema50Indicator.add(close);
      if (ema50Value != null) {
        ema50.push(ema50Value);
      }

      const rsiValue = rsi14Indicator.add(close);
      if (rsiValue != null) {
        rsi14.push(rsiValue);
      }

      const macdValue = macdIndicator.add(close);
      if (macdValue != null) {
        macdHistogram.push(macdValue.histogram);
      }
    }

    return {
      ema7,
      ema21,
      ema50,
      rsi14,
      macdHistogram,
    };
  }

  private buildFeatureVector(
    candles: Candle[],
    indicators: {
      ema7: number[];
      ema21: number[];
      ema50: number[];
      rsi14: number[];
      macdHistogram: number[];
    },
    benchmarks: {
      primary: Candle[];
      secondary: Candle[];
      displayLabel: string;
    },
    index: number,
    asset?: MarketAsset,
  ): number[] {
    const closes = candles.map((candle) => candle.close);
    const volumes = candles.map((candle) => candle.volume);
    const close = closes[index];

    const return1d = index >= 1 ? pctChange(close, closes[index - 1]) : 0;
    const return3d = index >= 3 ? pctChange(close, closes[index - 3]) : 0;
    const return7d = index >= 7 ? pctChange(close, closes[index - 7]) : 0;
    const return14d = index >= 14 ? pctChange(close, closes[index - 14]) : 0;
    const return30d = index >= 30 ? pctChange(close, closes[index - 30]) : 0;
    const return60d = index >= 60 ? pctChange(close, closes[index - 60]) : 0;

    const sma7 = mean(closes.slice(Math.max(0, index - 6), index + 1));
    const sma21 = mean(closes.slice(Math.max(0, index - 20), index + 1));
    const ema7 = indicators.ema7[index] ?? close;
    const ema21 = indicators.ema21[index] ?? close;
    const ema50 = indicators.ema50[index] ?? close;

    const rsiValue = this.readAlignedIndicator(indicators.rsi14, closes.length, index);
    const macdHistogram = this.readAlignedIndicator(indicators.macdHistogram, closes.length, index);

    const recentReturns = this.collectReturns(closes, index, 30);
    const recentVolumes = volumes.slice(Math.max(0, index - 13), index + 1);
    const recentHigh = Math.max(...closes.slice(Math.max(0, index - 29), index + 1));
    const recentLow = Math.min(...closes.slice(Math.max(0, index - 29), index + 1));
    const benchmarkFeatures = this.buildBenchmarkFeatures(candles, benchmarks, index);
    const qualityFeatures = this.buildQualityFeatures(volumes, index, asset);

    return [
      normalize(return1d, 0.25),
      normalize(return3d, 0.4),
      normalize(return7d, 0.7),
      normalize(return14d, 1),
      normalize(return30d, 1.5),
      normalize(return60d, 2.5),
      normalize(pctChange(close, sma7), 0.2),
      normalize(pctChange(close, sma21), 0.3),
      normalize(pctChange(close, ema7), 0.2),
      normalize(pctChange(close, ema21), 0.3),
      normalize(pctChange(close, ema50), 0.5),
      clamp((rsiValue - 50) / 50, -1, 1),
      normalize(macdHistogram / (close || 1), 0.02),
      normalize(standardDeviation(recentReturns), 0.08),
      normalize(pctChange(volumes[index], mean(recentVolumes)), 0.8),
      normalize(pctChange(close, recentLow), 0.9),
      normalize(pctChange(recentHigh, close), 0.9),
      normalize(slope(closes.slice(Math.max(0, index - 6), index + 1)) / (close || 1), 0.01),
      ...benchmarkFeatures,
      ...qualityFeatures,
    ];
  }

  private buildReasons(
    candles: Candle[],
    indicators: {
      ema7: number[];
      ema21: number[];
      ema50: number[];
      rsi14: number[];
      macdHistogram: number[];
    },
    benchmarks: {
      primary: Candle[];
      secondary: Candle[];
      displayLabel: string;
    },
    index: number,
    asset?: MarketAsset,
  ): string[] {
    const closes = candles.map((candle) => candle.close);
    const close = closes[index];
    const ema7 = indicators.ema7[index] ?? close;
    const ema21 = indicators.ema21[index] ?? close;
    const ema50 = indicators.ema50[index] ?? close;
    const rsiValue = this.readAlignedIndicator(indicators.rsi14, closes.length, index);
    const macdHistogram = this.readAlignedIndicator(indicators.macdHistogram, closes.length, index);
    const benchmarkContext = this.buildBenchmarkContext(candles, benchmarks, index);
    const qualityContext = this.buildQualityContext(candles.map((candle) => candle.volume), index, asset);

    const reasons: string[] = [];

    if (close > ema7 && ema7 > ema21) {
      reasons.push('price is above short- and medium-term trend');
    }

    if (close > ema50 && ema21 > ema50) {
      reasons.push('price is above the longer-term trend');
    }

    if (rsiValue < 35) {
      reasons.push('RSI suggests oversold conditions');
    } else if (rsiValue > 65) {
      reasons.push('RSI suggests strong upside momentum');
    }

    if (macdHistogram > 0) {
      reasons.push('MACD histogram is positive');
    }

    const recentSlope = slope(closes.slice(Math.max(0, index - 6), index + 1));
    if (recentSlope > 0) {
      reasons.push('recent slope is upward');
    } else if (recentSlope < 0) {
      reasons.push('recent slope is downward');
    }

    const benchmarkLabel = benchmarks.displayLabel || 'the market benchmarks';
    if (benchmarkContext.relativeStrength > 0.02) {
      reasons.push(`outperforming ${benchmarkLabel}`);
    } else if (benchmarkContext.relativeStrength < -0.02) {
      reasons.push(`lagging ${benchmarkLabel}`);
    }

    if (qualityContext.score < 0.45) {
      reasons.push('liquidity is weak');
    } else if (qualityContext.score > 0.8) {
      reasons.push('liquidity is healthy');
    }

    const longSlope = slope(closes.slice(Math.max(0, index - 29), index + 1));
    if (longSlope > 0) {
      reasons.push('longer-term slope is upward');
    } else if (longSlope < 0) {
      reasons.push('longer-term slope is downward');
    }

    return reasons.slice(0, 4);
  }

  private buildContextScores(
    candles: Candle[],
    benchmarks: {
      primary: Candle[];
      secondary: Candle[];
      displayLabel: string;
    },
    index: number,
    asset?: MarketAsset,
  ): {
    relativeStrengthScore: number;
    volumeConfirmationScore: number;
  } {
    const benchmarkContext = this.buildBenchmarkContext(candles, benchmarks, index);
    const qualityContext = this.buildQualityContext(candles.map((candle) => candle.volume), index, asset);

    return {
      relativeStrengthScore: benchmarkContext.relativeStrength,
      volumeConfirmationScore: qualityContext.volumeConfirmation,
    };
  }

  private buildBenchmarkFeatures(
    candles: Candle[],
    benchmarks: {
      primary: Candle[];
      secondary: Candle[];
      displayLabel: string;
    },
    index: number,
  ): number[] {
    const benchmarkContext = this.buildBenchmarkContext(candles, benchmarks, index);
    return [
      normalize(benchmarkContext.relativeStrength, 0.2),
      normalize(benchmarkContext.relativeStrengthTrend, 0.1),
      normalize(benchmarkContext.benchmarkCorrelation, 1),
      normalize(benchmarkContext.benchmarkMomentum, 0.15),
    ];
  }

  private buildQualityFeatures(volumes: number[], index: number, asset?: MarketAsset): number[] {
    const quality = this.buildQualityContext(volumes, index, asset);
    return [
      normalize(quality.volumeConfirmation, 2),
      clamp(quality.score * 2 - 1, -1, 1),
      normalize(quality.volumeStability, 0.6),
      normalize(quality.marketCapScore, 1),
    ];
  }

  private buildBenchmarkContext(
    candles: Candle[],
    benchmarks: {
      primary: Candle[];
      secondary: Candle[];
      displayLabel: string;
    },
    index: number,
  ): {
    relativeStrength: number;
    relativeStrengthTrend: number;
    benchmarkCorrelation: number;
    benchmarkMomentum: number;
  } {
    const alignedPrimary = alignByTimestamp(candles.slice(0, index + 1), benchmarks.primary);
    const alignedSecondary = alignByTimestamp(candles.slice(0, index + 1), benchmarks.secondary);
    if (alignedPrimary.length < 2 || alignedSecondary.length < 2) {
      return {
        relativeStrength: 0,
        relativeStrengthTrend: 0,
        benchmarkCorrelation: 0,
        benchmarkMomentum: 0,
      };
    }

    const assetCloses = candles.slice(0, index + 1).map((candle) => candle.close);
    const primaryCloses = alignedPrimary.map((candle) => candle.close);
    const secondaryCloses = alignedSecondary.map((candle) => candle.close);

    const asset1d = pctChange(assetCloses.at(-1) ?? 0, assetCloses.at(-2) ?? 0);
    const primary1d = pctChange(primaryCloses.at(-1) ?? 0, primaryCloses.at(-2) ?? 0);
    const secondary1d = pctChange(secondaryCloses.at(-1) ?? 0, secondaryCloses.at(-2) ?? 0);

    const asset7d = assetCloses.length >= 8 ? pctChange(assetCloses.at(-1) ?? 0, assetCloses.at(-8) ?? 0) : 0;
    const primary7d = primaryCloses.length >= 8 ? pctChange(primaryCloses.at(-1) ?? 0, primaryCloses.at(-8) ?? 0) : 0;
    const secondary7d =
      secondaryCloses.length >= 8 ? pctChange(secondaryCloses.at(-1) ?? 0, secondaryCloses.at(-8) ?? 0) : 0;

    const asset30d = assetCloses.length >= 31 ? pctChange(assetCloses.at(-1) ?? 0, assetCloses.at(-31) ?? 0) : 0;
    const primary30d =
      primaryCloses.length >= 31 ? pctChange(primaryCloses.at(-1) ?? 0, primaryCloses.at(-31) ?? 0) : 0;
    const secondary30d =
      secondaryCloses.length >= 31 ? pctChange(secondaryCloses.at(-1) ?? 0, secondaryCloses.at(-31) ?? 0) : 0;

    const assetReturns = returns(candles.slice(0, index + 1));
    const primaryReturns = returns(alignedPrimary);
    const secondaryReturns = returns(alignedSecondary);
    const combinedBenchmarkReturns = primaryReturns.map((value, returnIndex) =>
      (value + (secondaryReturns[returnIndex] ?? value)) / 2,
    );

    const relativeStrength =
      ((asset1d - (primary1d + secondary1d) / 2) +
        (asset7d - (primary7d + secondary7d) / 2) +
        (asset30d - (primary30d + secondary30d) / 2)) /
      3;
    const benchmarkCorrelation = correlation(assetReturns.slice(-14), combinedBenchmarkReturns.slice(-14));
    const benchmarkMomentum =
      ((primary30d + secondary30d) / 2 + (primary7d + secondary7d) / 2 + (primary1d + secondary1d) / 2) / 3;
    const relativeStrengthTrend = slope([
      asset1d - primary1d,
      asset7d - primary7d,
      asset30d - primary30d,
      asset1d - secondary1d,
      asset7d - secondary7d,
      asset30d - secondary30d,
    ]);

    return {
      relativeStrength,
      relativeStrengthTrend,
      benchmarkCorrelation,
      benchmarkMomentum,
    };
  }

  private buildQualityContext(
    volumes: number[],
    index: number,
    asset?: MarketAsset,
  ): {
    score: number;
    volumeConfirmation: number;
    volumeStability: number;
    marketCapScore: number;
  } {
    const currentVolume = volumes[index] ?? 0;
    const recentVolumes = volumes.slice(Math.max(0, index - 13), index + 1);
    const averageVolume = mean(recentVolumes);
    const volumeConfirmation = averageVolume === 0 ? 0 : currentVolume / averageVolume;
    const volumeStability = recentVolumes.length < 3 ? 0 : standardDeviation(recentVolumes) / (averageVolume || 1);
    const marketCapScore = asset?.marketCapRank == null ? 0 : Math.max(0, 1 - asset.marketCapRank / 1000);

    let score = 1;
    if (volumeConfirmation < 0.8) {
      score -= 0.15;
    }
    if (volumeConfirmation > 1.2) {
      score += 0.1;
    }
    if (volumeStability > 0.75) {
      score -= 0.15;
    }
    if (asset?.marketCapRank != null && asset.marketCapRank <= 100) {
      score += 0.1;
    }

    return {
      score: clamp(score, 0, 1),
      volumeConfirmation,
      volumeStability,
      marketCapScore,
    };
  }

  private collectReturns(closes: number[], index: number, windowSize: number): number[] {
    const start = Math.max(1, index - windowSize + 1);
    const returns: number[] = [];

    for (let current = start; current <= index; current += 1) {
      returns.push(pctChange(closes[current], closes[current - 1]));
    }

    return returns;
  }

  private readAlignedIndicator(values: number[], totalLength: number, index: number): number {
    if (values.length === 0) {
      return 0;
    }

    const offset = totalLength - values.length;
    const alignedIndex = index - offset;
    if (alignedIndex < 0 || alignedIndex >= values.length) {
      const fallback = values[values.length - 1] ?? 0;
      return Number.isFinite(fallback) ? fallback : 0;
    }

    const value = values[alignedIndex] ?? 0;
    return Number.isFinite(value) ? value : 0;
  }

  private alignBenchmarks(
    candles: Candle[],
    benchmarks?: BenchmarkCandles,
  ): {
    primary: Candle[];
    secondary: Candle[];
    displayLabel: string;
  } {
    if (!benchmarks) {
      return { primary: [], secondary: [], displayLabel: 'the market benchmarks' };
    }

    return {
      primary: alignByTimestamp(candles, benchmarks.primary),
      secondary: alignByTimestamp(candles, benchmarks.secondary),
      displayLabel: benchmarks.displayLabel,
    };
  }
}
