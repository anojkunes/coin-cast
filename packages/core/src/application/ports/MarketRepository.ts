import type { Candle } from '../../domain/models/Candle';
import type { MarketAsset } from '../../domain/models/MarketAsset';
import type { OrderBookSnapshot } from '../../domain/models/OrderBook';

export interface MarketRepository {
  getUniverse(limit: number): Promise<MarketAsset[]>;
  getHistoricalCandles(asset: MarketAsset, days: number): Promise<Candle[]>;
  getOrderBook(asset: MarketAsset, depth?: number): Promise<OrderBookSnapshot | null>;
}
