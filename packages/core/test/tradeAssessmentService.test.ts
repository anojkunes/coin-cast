import { describe, expect, it } from 'vitest';

import { TradeAssessmentService } from '../src/index';

describe('TradeAssessmentService', () => {
  it('marks a strong bearish 5-hour setup as sell', () => {
    const service = new TradeAssessmentService();

    const result = service.evaluate({
      direction: 'bearish',
      confidence: 0.98,
      newsScore: -1,
      quality: {
        score: 1,
        reasons: [],
      },
      marketCondition: {
        label: 'risk_off',
        score: -1,
        reasons: [],
      },
      snapshot: {
        relativeStrengthScore: -0.2,
        volumeConfirmationScore: 2,
        trendStrengthScore: 1,
        longTermTrendScore: 1,
        volatilityScore: 0.05,
        rsiValue: 28,
      },
      orderBookScore: 0,
    });

    expect(result.tradeVerdict).toBe('good');
    expect(result.fiveHourProbabilityUp).toBeLessThanOrEqual(0.4);
    expect(result.actionRecommendation).toBe('sell');
  });
});
