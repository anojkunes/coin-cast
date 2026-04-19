import type { MarketSample } from './MarketFeatureBuilder';
import { LogisticRegressionClassifier } from './LogisticRegressionClassifier';

export interface ModelQualityReport {
  samplesEvaluated: number;
  validationAccuracy: number;
  validationPrecision: number;
  validationRecall: number;
  brierScore: number;
  calibrationFactor: number;
  recommendedConfidenceFloor: number;
  qualityLabel: 'strong' | 'steady' | 'weak' | 'insufficient';
}

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / (values.length || 1);

const formatQualityLabel = (qualityScore: number): ModelQualityReport['qualityLabel'] => {
  if (qualityScore >= 0.75) {
    return 'strong';
  }

  if (qualityScore >= 0.55) {
    return 'steady';
  }

  if (qualityScore >= 0.35) {
    return 'weak';
  }

  return 'insufficient';
};

export class ModelQualityService {
  evaluate(sampleSets: MarketSample[][]): ModelQualityReport {
    const metrics = sampleSets.flatMap((samples) => this.evaluateSampleSet(samples));

    if (metrics.length === 0) {
      return {
        samplesEvaluated: 0,
        validationAccuracy: 0.5,
        validationPrecision: 0.5,
        validationRecall: 0.5,
        brierScore: 0.25,
        calibrationFactor: 0.9,
        recommendedConfidenceFloor: 0.35,
        qualityLabel: 'insufficient',
      };
    }

    const samplesEvaluated = metrics.length;
    const validationAccuracy = mean(metrics.map((metric) => metric.correct ? 1 : 0));
    const truePositive = metrics.filter((metric) => metric.prediction === 1 && metric.label === 1).length;
    const falsePositive = metrics.filter((metric) => metric.prediction === 1 && metric.label === 0).length;
    const falseNegative = metrics.filter((metric) => metric.prediction === 0 && metric.label === 1).length;
    const validationPrecision = truePositive + falsePositive === 0 ? 0.5 : truePositive / (truePositive + falsePositive);
    const validationRecall = truePositive + falseNegative === 0 ? 0.5 : truePositive / (truePositive + falseNegative);
    const brierScore = mean(
      metrics.map((metric) => {
        const value = (metric.probability - metric.label) ** 2;
        return Number.isFinite(value) ? value : 0;
      }),
    );
    const accuracyScore = clamp((validationAccuracy - 0.5) / 0.3, 0, 1);
    const precisionScore = clamp((validationPrecision - 0.5) / 0.3, 0, 1);
    const recallScore = clamp((validationRecall - 0.5) / 0.3, 0, 1);
    const brierScoreQuality = clamp(1 - brierScore / 0.25, 0, 1);
    const coverageScore = clamp(samplesEvaluated / 150, 0, 1);
    const qualityScore =
      accuracyScore * 0.35 +
      precisionScore * 0.2 +
      recallScore * 0.15 +
      brierScoreQuality * 0.2 +
      coverageScore * 0.1;
    const calibrationFactor = clamp(0.82 + qualityScore * 0.3, 0.82, 1.12);
    const recommendedConfidenceFloor = clamp(0.24 + (1 - qualityScore) * 0.16, 0.24, 0.42);

    return {
      samplesEvaluated,
      validationAccuracy,
      validationPrecision,
      validationRecall,
      brierScore,
      calibrationFactor,
      recommendedConfidenceFloor,
      qualityLabel: formatQualityLabel(qualityScore),
    };
  }

  private evaluateSampleSet(samples: MarketSample[]): Array<{
    correct: boolean;
    prediction: number;
    label: number;
    probability: number;
  }> {
    if (samples.length < 30) {
      return [];
    }

    const splitIndex = Math.max(20, Math.floor(samples.length * 0.7));
    if (splitIndex >= samples.length - 4) {
      return [];
    }

    const trainSamples = samples.slice(0, splitIndex);
    const validationSamples = samples.slice(splitIndex);
    const labels = trainSamples.map((sample) => sample.label);
    if (new Set(labels).size < 2) {
      return [];
    }

    const model = new LogisticRegressionClassifier();
    model.fit(
      trainSamples.map((sample) => sample.features),
      labels,
      {
        learningRate: 0.05,
        iterations: 300,
        l2: 0.001,
      },
    );

    return validationSamples.map((sample) => {
      const probability = model.predictProbability(sample.features);
      if (!Number.isFinite(probability)) {
        return null;
      }
      const prediction = probability >= 0.5 ? 1 : 0;
      return {
        correct: prediction === sample.label,
        prediction,
        label: sample.label,
        probability,
      };
    }).filter((metric): metric is { correct: boolean; prediction: number; label: number; probability: number } => metric !== null);
  }
}
