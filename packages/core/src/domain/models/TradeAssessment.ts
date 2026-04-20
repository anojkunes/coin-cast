export type TradeVerdict = 'good' | 'mixed' | 'avoid';

export interface TradeAssessment {
  fiveHourProbabilityUp: number;
  actionRecommendation: 'buy' | 'sell' | 'wait' | 'avoid';
  expectedDurationHours: number;
  expectedDurationLabel: string;
  tradeSuitabilityScore: number;
  tradeVerdict: TradeVerdict;
  reasons: string[];
}
