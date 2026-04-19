export class RelativeStrengthIndex {
  private previousPrice: number | null = null;

  private averageGain: number | null = null;

  private averageLoss: number | null = null;

  private gains: number[] = [];

  private losses: number[] = [];

  constructor(private readonly period: number) {
    if (!Number.isInteger(period) || period <= 0) {
      throw new Error('RSI period must be a positive integer');
    }
  }

  add(price: number): number | null {
    if (this.previousPrice == null) {
      this.previousPrice = price;
      return null;
    }

    const change = price - this.previousPrice;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    this.previousPrice = price;

    if (this.averageGain == null || this.averageLoss == null) {
      this.gains.push(gain);
      this.losses.push(loss);

      if (this.gains.length < this.period) {
        return null;
      }

      this.averageGain =
        this.gains.reduce((total, current) => total + current, 0) / this.period;
      this.averageLoss =
        this.losses.reduce((total, current) => total + current, 0) / this.period;
    } else {
      this.averageGain = ((this.averageGain * (this.period - 1)) + gain) / this.period;
      this.averageLoss = ((this.averageLoss * (this.period - 1)) + loss) / this.period;
    }

    if (this.averageLoss === 0) {
      return 100;
    }

    const relativeStrength = this.averageGain / this.averageLoss;
    return 100 - (100 / (1 + relativeStrength));
  }
}
