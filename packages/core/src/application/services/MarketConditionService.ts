import type { Candle } from '../../domain/models/Candle';
import type { MarketCondition } from '../../domain/models/MarketCondition';

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

const pctChange = (current: number, previous: number): number =>
  previous === 0 ? 0 : (current - previous) / previous;

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

const standardDeviation = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

export class MarketConditionService {
  evaluate(
    primaryBenchmarkCandles: Candle[],
    secondaryBenchmarkCandles: Candle[],
    benchmarkDisplayLabel = 'the market benchmarks',
  ): MarketCondition {
    const benchmarkReturns = [
      this.totalReturn(primaryBenchmarkCandles, 7),
      this.totalReturn(secondaryBenchmarkCandles, 7),
    ];
    const benchmarkTrend = mean(benchmarkReturns);
    const benchmarkVolatility = mean([
      this.volatility(primaryBenchmarkCandles, 30),
      this.volatility(secondaryBenchmarkCandles, 30),
    ]);
    const primarySlope = slope(primaryBenchmarkCandles.slice(-14).map((candle) => candle.close));
    const secondarySlope = slope(secondaryBenchmarkCandles.slice(-14).map((candle) => candle.close));
    const regimeScore = this.computeScore(
      benchmarkTrend,
      benchmarkVolatility,
      primarySlope,
      secondarySlope,
    );

    if (regimeScore >= 0.35) {
      return {
        label: 'risk_on',
        score: regimeScore,
        reasons: [`${benchmarkDisplayLabel} trend is constructive`, 'benchmark volatility is manageable'],
      };
    }

    if (regimeScore <= -0.25) {
      return {
        label: 'risk_off',
        score: regimeScore,
        reasons: [`${benchmarkDisplayLabel} trend is weak`, 'benchmark volatility is elevated'],
      };
    }

    return {
      label: 'neutral',
      score: regimeScore,
      reasons: ['benchmark conditions are mixed'],
    };
  }

  private computeScore(
    benchmarkTrend: number,
    benchmarkVolatility: number,
    btcSlope: number,
    ethSlope: number,
  ): number {
    const trendComponent = Math.tanh((benchmarkTrend * 100) / 8);
    const slopeComponent = Math.tanh(((btcSlope + ethSlope) / 2) / 3_000);
    const volatilityComponent = Math.tanh((0.06 - benchmarkVolatility) / 0.04);

    return Math.max(-1, Math.min(1, trendComponent * 0.5 + slopeComponent * 0.3 + volatilityComponent * 0.2));
  }

  private totalReturn(candles: Candle[], windowSize: number): number {
    if (candles.length < windowSize + 1) {
      return 0;
    }

    const end = candles[candles.length - 1].close;
    const start = candles[candles.length - 1 - windowSize].close;
    return pctChange(end, start);
  }

  private volatility(candles: Candle[], windowSize: number): number {
    if (candles.length < 2) {
      return 0;
    }

    const recent = candles.slice(Math.max(1, candles.length - windowSize));
    const returns: number[] = [];
    for (let index = 1; index < recent.length; index += 1) {
      returns.push(pctChange(recent[index].close, recent[index - 1].close));
    }

    return standardDeviation(returns);
  }
}
