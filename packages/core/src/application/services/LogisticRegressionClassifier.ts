export interface LogisticRegressionOptions {
  learningRate?: number;
  iterations?: number;
  l2?: number;
}

interface FeatureScalerState {
  means: number[];
  stdDevs: number[];
}

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const standardDeviation = (values: number[], avg: number): number => {
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance) || 1;
};

export class LogisticRegressionClassifier {
  private weights: number[] = [];

  private bias = 0;

  private scaler: FeatureScalerState = { means: [], stdDevs: [] };

  fit(features: number[][], labels: number[], options: LogisticRegressionOptions = {}): void {
    if (features.length === 0) {
      throw new Error('Cannot train logistic regression without samples');
    }

    if (features.length !== labels.length) {
      throw new Error('Feature and label counts must match');
    }

    const featureCount = features[0]?.length ?? 0;
    if (featureCount === 0) {
      throw new Error('Feature vectors must not be empty');
    }

    this.scaler = this.computeScaler(features);
    const normalized = features.map((row) => this.normalize(row));
    const learningRate = options.learningRate ?? 0.05;
    const iterations = options.iterations ?? 500;
    const l2 = options.l2 ?? 0.001;

    this.weights = Array.from({ length: featureCount }, () => 0);
    this.bias = 0;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const gradientWeights = Array.from({ length: featureCount }, () => 0);
      let gradientBias = 0;

      for (let index = 0; index < normalized.length; index += 1) {
        const prediction = this.predictProbabilityNormalized(normalized[index]);
        const error = prediction - labels[index];

        gradientBias += error;
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
          gradientWeights[featureIndex] += error * normalized[index][featureIndex];
        }
      }

      const sampleCount = normalized.length;
      for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
        const regularizedGradient =
          gradientWeights[featureIndex] / sampleCount + l2 * this.weights[featureIndex];
        this.weights[featureIndex] -= learningRate * regularizedGradient;
      }

      this.bias -= learningRate * (gradientBias / sampleCount);
    }
  }

  predictProbability(features: number[]): number {
    if (this.weights.length === 0) {
      return 0.5;
    }

    return this.predictProbabilityNormalized(this.normalize(features));
  }

  isTrained(): boolean {
    return this.weights.length > 0;
  }

  private predictProbabilityNormalized(features: number[]): number {
    let score = this.bias;
    for (let index = 0; index < features.length; index += 1) {
      score += this.weights[index] * features[index];
    }

    return sigmoid(score);
  }

  private computeScaler(features: number[][]): FeatureScalerState {
    const featureCount = features[0].length;
    const means = Array.from({ length: featureCount }, (_, index) =>
      mean(features.map((row) => row[index])),
    );
    const stdDevs = Array.from({ length: featureCount }, (_, index) =>
      standardDeviation(
        features.map((row) => row[index]),
        means[index],
      ),
    );

    return { means, stdDevs };
  }

  private normalize(features: number[]): number[] {
    return features.map((value, index) => {
      const meanValue = this.scaler.means[index] ?? 0;
      const stdDev = this.scaler.stdDevs[index] ?? 1;
      return (value - meanValue) / stdDev;
    });
  }
}
