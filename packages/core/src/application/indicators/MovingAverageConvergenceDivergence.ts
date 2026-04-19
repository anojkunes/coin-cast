import { ExponentialMovingAverage } from './ExponentialMovingAverage';

export interface MovingAverageConvergenceDivergenceValue {
  histogram: number;
  macd: number;
  signal: number;
}

export class MovingAverageConvergenceDivergence {
  private readonly fastEma: ExponentialMovingAverage;

  private readonly slowEma: ExponentialMovingAverage;

  private readonly signalEma: ExponentialMovingAverage;

  constructor(
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number,
  ) {
    this.fastEma = new ExponentialMovingAverage(fastPeriod);
    this.slowEma = new ExponentialMovingAverage(slowPeriod);
    this.signalEma = new ExponentialMovingAverage(signalPeriod);
  }

  add(price: number): MovingAverageConvergenceDivergenceValue | null {
    const fast = this.fastEma.add(price);
    const slow = this.slowEma.add(price);
    if (fast == null || slow == null) {
      return null;
    }

    const macd = fast - slow;
    const signal = this.signalEma.add(macd);
    if (signal == null) {
      return null;
    }

    return {
      histogram: macd - signal,
      macd,
      signal,
    };
  }
}
