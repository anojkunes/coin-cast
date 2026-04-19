export class ExponentialMovingAverage {
  private readonly multiplier: number;

  private sampleCount = 0;

  private currentValue: number | null = null;

  private warmupValues: number[] = [];

  constructor(private readonly period: number) {
    if (!Number.isInteger(period) || period <= 0) {
      throw new Error('EMA period must be a positive integer');
    }

    this.multiplier = 2 / (period + 1);
  }

  add(value: number): number | null {
    this.sampleCount += 1;

    if (this.currentValue == null) {
      this.warmupValues.push(value);
      if (this.warmupValues.length < this.period) {
        return null;
      }

      const sum = this.warmupValues.reduce((total, current) => total + current, 0);
      this.currentValue = sum / this.period;
      return this.currentValue;
    }

    this.currentValue = (value - this.currentValue) * this.multiplier + this.currentValue;
    return this.currentValue;
  }
}
