import axios, { type AxiosInstance } from 'axios';

import {
  createLogger,
  type Candle,
  type MarketAsset,
  type MarketRepository,
  type OrderBookSnapshot,
} from '@coin-cast/core';
import { createHttpAgentOptions, retryWithBackoff } from '@coin-cast/http-utils';

interface NasdaqApiEnvelope<T> {
  data?: T | null;
  message?: string | null;
  status?: {
    rCode?: number;
    bCodeMessage?: Array<{
      code?: number;
      errorMessage?: string;
    }> | null;
    developerMessage?: string | null;
  };
}

interface NasdaqScreenerRow {
  symbol?: string;
  name?: string;
  lastsale?: string;
  netchange?: string;
  pctchange?: string;
  marketCap?: string;
  volume?: string;
  sector?: string;
  url?: string;
}

interface NasdaqScreenerResponse {
  rows?: NasdaqScreenerRow[];
}

interface NasdaqHistoricalRow {
  date?: string;
  close?: string;
  volume?: string;
}

interface NasdaqHistoricalResponse {
  symbol?: string;
  totalRecords?: number;
  tradesTable?: {
    rows?: NasdaqHistoricalRow[];
  };
}

interface RankedStockAsset extends MarketAsset {
  marketCapUsd: number;
}

const excludedNamePattern =
  /\b(warrant|warrants|rights|units|unit\b|preferred|preference|notes|note\b|bond|debenture|ETF|ETN|fund)\b/i;

const parseNumber = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/[$,%\s]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseDate = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const [month, day, year] = value.split('/');
  const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

const buildNasdaqHeaders = (refererPath: string): Record<string, string> => ({
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: `https://www.nasdaq.com${refererPath}`,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
});

export class NasdaqStockRepository implements MarketRepository {
  private readonly logger = createLogger('nasdaq-stock-repository');

  private readonly http: AxiosInstance;

  constructor(
    baseUrl = process.env.NASDAQ_BASE_URL || 'https://api.nasdaq.com/api',
    private readonly maxRetries = Number(process.env.API_RETRY_MAX_ATTEMPTS || 10),
    private readonly initialRetryDelayMs = Number(process.env.API_RETRY_INITIAL_DELAY_MS || 1_000),
    private readonly maxRetryDelayMs = Number(process.env.API_RETRY_MAX_DELAY_MS || 30_000),
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 20_000,
      ...createHttpAgentOptions({
        keepAlive: false,
        maxSockets: 2,
        maxFreeSockets: 0,
      }),
      headers: {
        ...buildNasdaqHeaders('/market-activity/stocks/screener'),
      },
    });
  }

  async getUniverse(limit: number): Promise<MarketAsset[]> {
    this.logger.info('Requesting Nasdaq stock universe', {
      endpoint: '/screener/stocks',
      limit,
    });
    const response = await this.request<NasdaqScreenerResponse>(
      () =>
        this.http.get('/screener/stocks', {
          params: {
            tableonly: 'true',
            download: 'true',
          },
          headers: buildNasdaqHeaders('/market-activity/stocks/screener'),
        }),
      'Nasdaq stock screener',
    );

    const rows = response.rows ?? [];
    const filtered = rows
      .map((row) => this.toRankedAsset(row))
      .filter((asset): asset is RankedStockAsset => asset != null);

    const rankBySymbol = new Map(
      [...filtered]
        .sort((left, right) => right.marketCapUsd - left.marketCapUsd)
        .map((asset, index) => [asset.symbol, index + 1] as const),
    );

    const ranked = filtered
      .map((asset) => {
        const { marketCapUsd, ...rest } = asset;
        void marketCapUsd;

        return {
          ...rest,
          marketCapRank: rankBySymbol.get(asset.symbol),
        };
      })
      .sort((left, right) => (right.volume24hUsd ?? 0) - (left.volume24hUsd ?? 0));

    const results = limit <= 0 ? ranked : ranked.slice(0, limit);
    this.logger.info('Nasdaq stock universe loaded', {
      rowsReceived: rows.length,
      rankedAssets: ranked.length,
      assetsReturned: results.length,
      limitApplied: limit > 0,
    });

    return results;
  }

  async getHistoricalCandles(asset: MarketAsset, days: number): Promise<Candle[]> {
    try {
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime());
      fromDate.setUTCDate(fromDate.getUTCDate() - Math.max(30, days));

      const response = await this.request<NasdaqHistoricalResponse>(
        () =>
          this.http.get(`/quote/${encodeURIComponent(asset.symbol)}/historical`, {
            params: {
              assetclass: asset.marketSegment === 'etf' ? 'etf' : 'stocks',
              fromdate: toIsoDate(fromDate),
              todate: toIsoDate(toDate),
              limit: Math.max(60, days + 30),
            },
            headers: buildNasdaqHeaders(
              `/market-activity/${asset.marketSegment === 'etf' ? 'etf' : 'stocks'}/${asset.symbol.toLowerCase()}`,
            ),
          }),
        `Nasdaq historical prices for ${asset.symbol}`,
      );

      const candles = (response.tradesTable?.rows ?? [])
        .map((row) => {
          const timestamp = parseDate(row.date);
          if (timestamp == null) {
            return null;
          }

          return {
            timestamp,
            close: parseNumber(row.close),
            volume: parseNumber(row.volume),
          } satisfies Candle;
        })
        .filter((candle): candle is Candle => candle != null && candle.close > 0)
        .sort((left, right) => left.timestamp - right.timestamp);

      return candles;
    } catch (error) {
      this.logger.warn('Nasdaq historical candle request failed', {
        symbol: asset.symbol,
        endpoint: '/quote/:symbol/historical',
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getOrderBook(): Promise<OrderBookSnapshot | null> {
    return null;
  }

  private toRankedAsset(row: NasdaqScreenerRow): RankedStockAsset | null {
    const symbol = row.symbol?.trim().toUpperCase();
    const name = row.name?.trim();
    const currentPriceUsd = parseNumber(row.lastsale);
    const change24hPercent = parseNumber(row.pctchange);
    const volume24hUsd = parseNumber(row.volume);
    const marketCapUsd = parseNumber(row.marketCap);

    if (!symbol || !name || currentPriceUsd <= 0 || volume24hUsd <= 0 || marketCapUsd <= 0) {
      return null;
    }

    if (symbol.includes('^') || excludedNamePattern.test(name)) {
      return null;
    }

    return {
      id: symbol,
      symbol,
      name,
      assetClass: 'stock',
      marketSegment: 'stock',
      currentPriceUsd,
      change24hPercent,
      volume24hUsd,
      marketPageUrl: row.url ? `https://www.nasdaq.com${row.url}` : `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}`,
      marketPageLabel: 'Nasdaq market page',
      marketCapUsd,
    };
  }

  private async request<T>(
    operation: () => Promise<{ data: NasdaqApiEnvelope<T> }>,
    description: string,
  ): Promise<T> {
    this.logger.debug('Calling Nasdaq API', {
      description,
    });
    const envelope = await retryWithBackoff(
      async () => {
        const response = await operation();
        const developerMessage = response.data.status?.developerMessage;
        const errorMessages =
          response.data.status?.bCodeMessage?.map((message) => message.errorMessage).filter(Boolean) ?? [];

        if (response.data.status?.rCode && response.data.status.rCode >= 400) {
          throw new Error(
            `${description} failed with Nasdaq API status ${response.data.status.rCode}: ${errorMessages.join('; ') || developerMessage || 'unknown error'}`,
          );
        }

        if (response.data.data == null) {
          throw new Error(
            `${description} returned empty data: ${errorMessages.join('; ') || developerMessage || 'unknown error'}`,
          );
        }

        return response.data.data;
      },
      {
        context: description,
        maxAttempts: this.maxRetries,
        initialDelayMs: this.initialRetryDelayMs,
        maxDelayMs: this.maxRetryDelayMs,
      },
    );

    this.logger.debug('Nasdaq API call completed', {
      description,
    });
    return envelope;
  }
}
