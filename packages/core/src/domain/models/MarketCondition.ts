export type MarketRegimeLabel = 'risk_on' | 'neutral' | 'risk_off';

export interface MarketCondition {
  label: MarketRegimeLabel;
  score: number;
  reasons: string[];
}
