export interface OrderBookLevel {
  price: number;
  volume: number;
}

export interface OrderBookSnapshot {
  assetId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}
