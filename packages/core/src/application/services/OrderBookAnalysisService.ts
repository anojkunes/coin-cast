import type { OrderBookSnapshot } from '../../domain/models/OrderBook';

export interface OrderBookAnalysis {
  score: number;
  spreadPercent: number;
  imbalance: number;
  depthUsd: number;
  reasons: string[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

export class OrderBookAnalysisService {
  evaluate(snapshot: OrderBookSnapshot): OrderBookAnalysis {
    if (snapshot.bids.length === 0 || snapshot.asks.length === 0) {
      return {
        score: 0.5,
        spreadPercent: 0,
        imbalance: 0,
        depthUsd: 0,
        reasons: ['order book is too thin to judge'],
      };
    }

    const bestBid = Math.max(...snapshot.bids.map((level) => level.price));
    const bestAsk = Math.min(...snapshot.asks.map((level) => level.price));
    const midPrice = mean([bestBid, bestAsk]);
    const spreadPercent = midPrice === 0 ? 0 : ((bestAsk - bestBid) / midPrice) * 100;

    const bidDepthUsd = snapshot.bids.reduce((sum, level) => sum + level.price * level.volume, 0);
    const askDepthUsd = snapshot.asks.reduce((sum, level) => sum + level.price * level.volume, 0);
    const depthUsd = bidDepthUsd + askDepthUsd;
    const imbalance = depthUsd === 0 ? 0 : (bidDepthUsd - askDepthUsd) / depthUsd;

    const spreadScore = clamp(1 - spreadPercent / 0.8, 0, 1);
    const depthScore = clamp(Math.log10(Math.max(depthUsd, 1)) / 7, 0, 1);
    const imbalanceScore = clamp(0.5 + imbalance / 2, 0, 1);
    const score = clamp(spreadScore * 0.45 + depthScore * 0.3 + imbalanceScore * 0.25, 0, 1);

    const reasons: string[] = [];
    if (spreadPercent < 0.15) {
      reasons.push('order book spread is tight');
    } else if (spreadPercent > 0.6) {
      reasons.push('order book spread is wide');
    }

    if (depthUsd > 10_000_000) {
      reasons.push('order book depth is strong');
    } else if (depthUsd < 1_000_000) {
      reasons.push('order book depth is thin');
    }

    if (imbalance > 0.15) {
      reasons.push('bid depth is heavier than ask depth');
    } else if (imbalance < -0.15) {
      reasons.push('ask depth is heavier than bid depth');
    }

    return {
      score,
      spreadPercent,
      imbalance,
      depthUsd,
      reasons: reasons.slice(0, 3),
    };
  }
}
