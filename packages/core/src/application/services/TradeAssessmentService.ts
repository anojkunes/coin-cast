import type { AssetQuality } from '../../domain/models/AssetQuality';
import type { MarketCondition } from '../../domain/models/MarketCondition';
import type { SignalDirection } from '../../domain/models/MarketSignal';
import type { TradeAssessment } from '../../domain/models/TradeAssessment';

import type { MarketSnapshot } from './MarketFeatureBuilder';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const formatDuration = (hours: number): string => {
  if (hours < 12) {
    return 'intraday';
  }

  if (hours < 48) {
    return '1-2 days';
  }

  if (hours < 120) {
    return '3-5 days';
  }

  if (hours < 240) {
    return '1-2 weeks';
  }

  return '2+ weeks';
};

export interface TradeAssessmentInput {
  direction: SignalDirection;
  confidence: number;
  newsScore: number;
  quality: AssetQuality;
  marketCondition: MarketCondition;
  snapshot: Pick<
    MarketSnapshot,
    | 'relativeStrengthScore'
    | 'volumeConfirmationScore'
    | 'trendStrengthScore'
    | 'longTermTrendScore'
    | 'volatilityScore'
    | 'rsiValue'
  >;
  orderBookScore?: number;
}

export class TradeAssessmentService {
  evaluate(input: TradeAssessmentInput): TradeAssessment {
    const directionBias = input.direction === 'bullish' ? 1 : 0.92;
    const relativeStrengthBias = clamp(0.5 + input.snapshot.relativeStrengthScore * 5, 0, 1);
    const volumeBias = clamp(input.snapshot.volumeConfirmationScore / 1.5, 0, 1);
    const regimeBias = clamp(0.5 + input.marketCondition.score / 2, 0, 1);
    const qualityBias = input.quality.score;
    const trendBias = clamp(input.snapshot.trendStrengthScore, 0, 1);
    const longTrendBias = clamp(input.snapshot.longTermTrendScore, 0, 1);
    const momentumBias = clamp(1 - input.snapshot.volatilityScore, 0, 1);
    const orderBookBias = clamp(input.orderBookScore ?? 0.5, 0, 1);
    const directionAdjustedOrderBookBias =
      input.direction === 'bullish' ? orderBookBias : 1 - orderBookBias;

    const persistenceScore = clamp(
      trendBias * 0.2 +
        longTrendBias * 0.2 +
        momentumBias * 0.22 +
        regimeBias * 0.18 +
        qualityBias * 0.14 +
        relativeStrengthBias * 0.1 +
        volumeBias * 0.05 +
        directionAdjustedOrderBookBias * 0.05,
      0,
      1,
    );

    const exhaustionPenalty = clamp(
      Math.abs(input.snapshot.rsiValue - 50) / 50 * 0.25 +
        input.snapshot.volatilityScore * 0.25 +
        Math.max(0, input.snapshot.relativeStrengthScore < 0 ? 0.12 : 0) +
        Math.max(0, input.newsScore < -0.2 ? 0.08 : 0),
      0,
      0.5,
    );

    const durationScore = clamp((persistenceScore * directionBias) - exhaustionPenalty, 0, 1);
    const expectedDurationHours = Math.round(12 + durationScore * 240);
    const expectedDurationLabel = formatDuration(expectedDurationHours);

    const rawShortHorizonScore = clamp(
      input.direction === 'bullish'
        ? input.confidence * 0.4 +
          trendBias * 0.16 +
          longTrendBias * 0.06 +
          momentumBias * 0.18 +
          regimeBias * 0.08 +
          qualityBias * 0.04 +
          relativeStrengthBias * 0.05 +
          volumeBias * 0.03 +
          orderBookBias * 0.03 +
          Math.max(0, input.newsScore) * 0.04
        : (1 - input.confidence) * 0.4 +
          (1 - trendBias) * 0.16 +
          (1 - longTrendBias) * 0.06 +
          momentumBias * 0.18 +
          (1 - regimeBias) * 0.08 +
          qualityBias * 0.04 +
          (1 - relativeStrengthBias) * 0.05 +
          volumeBias * 0.03 +
          (1 - orderBookBias) * 0.03 +
          Math.max(0, -input.newsScore) * 0.04,
      0,
      1,
    );
    const fiveHourProbabilityUp = input.direction === 'bullish'
      ? clamp(rawShortHorizonScore, 0, 1)
      : clamp(1 - rawShortHorizonScore, 0, 1);

    const tradeSuitabilityScore = clamp(
      input.direction === 'bullish'
        ? input.confidence * 0.35 +
          qualityBias * 0.2 +
          regimeBias * 0.15 +
          relativeStrengthBias * 0.15 +
          volumeBias * 0.1 +
          orderBookBias * 0.05 +
          Math.max(0, input.newsScore) * 0.05
        : input.confidence * 0.2 +
          qualityBias * 0.15 +
          (1 - regimeBias) * 0.15 +
          (1 - relativeStrengthBias) * 0.15 +
          volumeBias * 0.1 +
          directionAdjustedOrderBookBias * 0.05 +
          Math.max(0, -input.newsScore) * 0.05,
      0,
      1,
    );

    const tradeVerdict =
      tradeSuitabilityScore >= 0.72
        ? 'good'
        : tradeSuitabilityScore >= 0.5
          ? 'mixed'
          : 'avoid';

    const actionRecommendation =
      tradeVerdict === 'good' && fiveHourProbabilityUp >= 0.6
        ? 'buy'
        : tradeVerdict === 'avoid' || fiveHourProbabilityUp <= 0.4
          ? 'avoid'
          : 'wait';

    const reasons: string[] = [
      `trend may persist for about ${expectedDurationLabel}`,
    ];

    if (input.direction === 'bullish') {
      reasons.push(
        tradeVerdict === 'good'
          ? 'long entry looks favorable'
          : 'long entry needs more confirmation',
      );
    } else {
      reasons.push(
        tradeVerdict === 'good'
          ? 'downside move looks durable'
          : 'downside move may be short-lived',
      );
    }

    if (qualityBias >= 0.8) {
      reasons.push('asset quality supports the setup');
    } else if (qualityBias < 0.5) {
      reasons.push('asset quality weakens the setup');
    }

    if (directionAdjustedOrderBookBias >= 0.65) {
      reasons.push('order book supports the bias');
    } else if (directionAdjustedOrderBookBias < 0.45) {
      reasons.push('order book does not support the bias');
    }

    if (regimeBias > 0.65) {
      reasons.push('broader market regime is supportive');
    } else if (regimeBias < 0.4) {
      reasons.push('broader market regime is defensive');
    }

    return {
      fiveHourProbabilityUp,
      actionRecommendation,
      expectedDurationHours,
      expectedDurationLabel,
      tradeSuitabilityScore,
      tradeVerdict,
      reasons: reasons.slice(0, 3),
    };
  }
}
