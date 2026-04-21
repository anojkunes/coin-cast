import axios, { type AxiosInstance } from 'axios';

import {
  createLogger,
  type Candle,
  type MarketAsset,
  type MarketRepository,
  type OrderBookSnapshot,
} from '@coin-cast/core';
import { retryWithBackoff, sharedHttpAgentOptions } from '@coin-cast/http-utils';

interface KrakenTickerStats {
  c?: [string, string];
  v?: [string, string];
  o?: string;
}

interface KrakenAssetPair {
  altname?: string;
  wsname?: string;
  base?: string;
  quote?: string;
  status?: string;
}

interface KrakenTickerResponse {
  result?: Record<string, KrakenTickerStats>;
}

interface KrakenAssetPairsResponse {
  result?: Record<string, KrakenAssetPair>;
}

interface KrakenOhlcRow extends Array<number | string> {
  0: number;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: number;
  7: number;
}

interface KrakenOhlcResponse {
  result?: Record<string, KrakenOhlcRow[]>;
}

interface KrakenDepthLevel extends Array<string | number> {
  0: string;
  1: string;
  2: number | string;
}

interface KrakenDepthResponse {
  result?: Record<
    string,
    {
      bids?: KrakenDepthLevel[];
      asks?: KrakenDepthLevel[];
    }
  >;
}

interface KrakenPriceDirectoryEntry {
  symbol: string;
  url: string;
  slug: string;
  displayName: string;
}

const stablecoinSymbols = new Set([
  'USDT',
  'USDC',
  'DAI',
  'TUSD',
  'FDUSD',
  'PYUSD',
  'USDE',
  'FRAX',
  'USDP',
  'USTC',
  'LUSD',
]);

const parseBaseSymbol = (pair: KrakenAssetPair, pairKey: string): string => {
  if (pair.wsname?.includes('/')) {
    return pair.wsname.split('/')[0] ?? pairKey;
  }

  if (pair.altname) {
    return pair.altname.replace(/USD$|USDT$|EUR$|GBP$/i, '');
  }

  return pairKey;
};

const dedupeAssets = (assets: MarketAsset[]): MarketAsset[] => {
  const seen = new Set<string>();
  const result: MarketAsset[] = [];

  for (const asset of assets) {
    const key = asset.id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(asset);
  }

  return result;
};

const readNumber = (value: unknown): number => {
  const parsed = typeof value === 'string' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const extractSymbol = (text: string): string | null => {
  const tokens = text
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (first && first === last) {
    return first.toUpperCase();
  }

  return first?.toUpperCase() ?? null;
};

const priceSlugNoiseWords = new Set([
  'price',
  'prices',
  'chart',
  'charts',
  'to',
  'usd',
  'usdt',
  'eur',
  'gbp',
  'cad',
  'aud',
]);

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const humanizeSlug = (slug: string): string | null => {
  const tokens = slug
    .split('-')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => !priceSlugNoiseWords.has(token));

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => (/^\d+$/.test(token) ? token : titleCase(token))).join(' ');
};

const normalizeKrakenCode = (value: string | undefined): string | null => {
  const sanitized = (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!sanitized) {
    return null;
  }

  let normalized = sanitized;
  while (
    normalized.length > 3 &&
    (normalized.startsWith('X') || normalized.startsWith('Z')) &&
    /^[A-Z]/.test(normalized[1] ?? '')
  ) {
    normalized = normalized.slice(1);
  }

  return normalized;
};

const stripQuoteSuffix = (value: string | undefined): string | null => {
  const sanitized = (value ?? '').trim().toUpperCase();
  if (!sanitized) {
    return null;
  }

  return sanitized.replace(/USD$|USDT$|EUR$|GBP$|CAD$|AUD$/i, '') || null;
};

const collectAliases = (...values: Array<string | null | undefined>): string[] => {
  const aliases: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    aliases.push(trimmed);
  }

  return aliases;
};

interface CryptoAssetIdentity {
  name: string;
  aliases: string[];
}

export class KrakenMarketRepository implements MarketRepository {
  private readonly logger = createLogger('kraken-market-repository');

  private readonly http: AxiosInstance;
  private readonly webHttp: AxiosInstance;

  constructor(
    baseUrl = process.env.KRAKEN_BASE_URL || 'https://api.kraken.com/0/public',
    private readonly maxRetries = Number(process.env.API_RETRY_MAX_ATTEMPTS || 10),
    private readonly initialRetryDelayMs = Number(process.env.API_RETRY_INITIAL_DELAY_MS || 1_000),
    private readonly maxRetryDelayMs = Number(process.env.API_RETRY_MAX_DELAY_MS || 30_000),
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15_000,
      ...sharedHttpAgentOptions,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CoinCastBot/1.0',
      },
    });
    this.webHttp = axios.create({
      baseURL: 'https://www.kraken.com',
      timeout: 15_000,
      ...sharedHttpAgentOptions,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'CoinCastBot/1.0',
      },
    });
  }

  async getUniverse(limit: number): Promise<MarketAsset[]> {
    this.logger.info('Requesting Kraken crypto universe', {
      endpoints: ['/AssetPairs', '/Ticker', '/prices'],
      limit,
    });
    const [pairsResponse, tickersResponse, priceDirectory] = await Promise.all([
      this.request<KrakenAssetPairsResponse>(() => this.http.get('/AssetPairs'), 'Kraken asset pairs'),
      this.request<KrakenTickerResponse>(() => this.http.get('/Ticker'), 'Kraken tickers'),
      this.loadPriceDirectory(),
    ]);

    const pairs = pairsResponse.result ?? {};
    const tickers = tickersResponse.result ?? {};

    const assets = Object.entries(pairs)
      .filter(([, pair]) => pair.status === 'online')
      .filter(([, pair]) => pair.quote?.toUpperCase() === 'ZUSD' || pair.wsname?.endsWith('/USD'))
      .map(([pairKey, pair]) => {
        const ticker = tickers[pairKey];
        const currentPrice = ticker?.c?.[0] ? Number(ticker.c[0]) : undefined;
        const volume = ticker?.v?.[1] ? Number(ticker.v[1]) : undefined;
        const open = ticker?.o ? Number(ticker.o) : undefined;
        const symbol = parseBaseSymbol(pair, pairKey).toUpperCase();
        const priceDirectoryEntry = this.findPriceDirectoryEntry(priceDirectory, pair, pairKey, symbol);
        const identity = this.buildAssetIdentity(pair, pairKey, symbol, priceDirectoryEntry);

        return {
          id: pairKey,
          symbol,
          name: identity.name,
          aliases: identity.aliases,
          assetClass: 'crypto',
          marketSegment: 'crypto',
          marketCapRank: undefined,
          currentPriceUsd: currentPrice,
          change24hPercent: open && currentPrice ? ((currentPrice - open) / open) * 100 : undefined,
          volume24hUsd: volume,
          marketPageUrl: priceDirectoryEntry?.url,
          marketPageLabel: 'Kraken market page',
        } satisfies MarketAsset;
      })
      .filter((asset) => asset.currentPriceUsd != null)
      .filter((asset) => !stablecoinSymbols.has(asset.symbol))
      .sort((left, right) => (right.volume24hUsd ?? 0) - (left.volume24hUsd ?? 0));

    const deduped = dedupeAssets(assets);
    const results = limit <= 0 ? deduped : deduped.slice(0, limit);
    this.logger.info('Kraken crypto universe loaded', {
      assetPairs: Object.keys(pairs).length,
      returnedAssets: results.length,
    });

    return results;
  }

  async getHistoricalCandles(asset: MarketAsset, days: number): Promise<Candle[]> {
    try {
      const response = await this.request<KrakenOhlcResponse>(
        () =>
          this.http.get('/OHLC', {
            params: {
              pair: asset.id,
              interval: 1440,
              since: this.sinceUnix(days),
            },
          }),
        `Kraken OHLC for ${asset.symbol}`,
      );

      const rows = response.result?.[asset.id] ?? [];

      return rows
        .map((row) => ({
          timestamp: row[0] * 1000,
          close: readNumber(row[4]),
          volume: readNumber(row[6]),
        }))
        .filter((candle) => Number.isFinite(candle.timestamp) && Number.isFinite(candle.close) && candle.close > 0);
    } catch (error) {
      this.logger.warn('Kraken historical candle request failed', {
        symbol: asset.symbol,
        endpoint: '/OHLC',
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getOrderBook(asset: MarketAsset, depth = 10): Promise<OrderBookSnapshot | null> {
    try {
      const response = await this.request<KrakenDepthResponse>(
        () =>
          this.http.get('/Depth', {
            params: {
              pair: asset.id,
              count: depth,
            },
          }),
        `Kraken depth for ${asset.symbol}`,
      );

      const book = response.result?.[asset.id];
      if (!book) {
        return null;
      }

      return {
        assetId: asset.id,
        bids: (book.bids ?? [])
          .map((level) => ({
            price: readNumber(level[0]),
            volume: readNumber(level[1]),
          }))
          .filter((level) => level.price > 0 && level.volume > 0),
        asks: (book.asks ?? [])
          .map((level) => ({
            price: readNumber(level[0]),
            volume: readNumber(level[1]),
          }))
          .filter((level) => level.price > 0 && level.volume > 0),
      };
    } catch (error) {
      this.logger.warn('Kraken order book request failed', {
        symbol: asset.symbol,
        endpoint: '/Depth',
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private sinceUnix(days: number): number {
    const now = Math.floor(Date.now() / 1000);
    return now - Math.max(1, days) * 86_400;
  }

  private findPriceDirectoryEntry(
    directory: Map<string, KrakenPriceDirectoryEntry>,
    pair: KrakenAssetPair,
    pairKey: string,
    symbol: string,
  ): KrakenPriceDirectoryEntry | undefined {
    const candidates = collectAliases(
      symbol,
      stripQuoteSuffix(pair.altname),
      normalizeKrakenCode(pair.base),
      normalizeKrakenCode(parseBaseSymbol(pair, pairKey)),
    );

    for (const candidate of candidates) {
      const entry = directory.get(candidate.toUpperCase());
      if (entry) {
        return entry;
      }
    }

    return undefined;
  }

  private buildAssetIdentity(
    pair: KrakenAssetPair,
    pairKey: string,
    symbol: string,
    priceDirectoryEntry?: KrakenPriceDirectoryEntry,
  ): CryptoAssetIdentity {
    const inferredName = priceDirectoryEntry?.displayName?.trim();
    const name = inferredName && inferredName.length > 0 ? inferredName : symbol;

    return {
      name,
      aliases: collectAliases(
        symbol,
        stripQuoteSuffix(pair.altname),
        normalizeKrakenCode(pair.base),
        normalizeKrakenCode(parseBaseSymbol(pair, pairKey)),
        priceDirectoryEntry?.symbol,
        inferredName,
      ),
    };
  }

  private async loadPriceDirectory(): Promise<Map<string, KrakenPriceDirectoryEntry>> {
    try {
      const html = await this.request<string>(
        () => this.webHttp.get('/prices'),
        'Kraken price directory',
      );

      const entries = new Map<string, KrakenPriceDirectoryEntry>();
      const regex = /<a[^>]+href="\/prices\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let match: RegExpExecArray | null = null;

      while ((match = regex.exec(html)) != null) {
        const slug = match[1];
        const text = stripHtml(match[2] ?? '');
        const symbol = extractSymbol(text);

        if (!slug || !symbol) {
          continue;
        }

        const candidate: KrakenPriceDirectoryEntry = {
          symbol,
          url: `https://www.kraken.com/prices/${slug}`,
          slug,
          displayName: humanizeSlug(slug) ?? symbol,
        };
        const existing = entries.get(symbol);
        if (!existing || candidate.slug.length > existing.slug.length) {
          entries.set(symbol, candidate);
        }
      }

      return new Map(Array.from(entries.values()).map((entry) => [entry.symbol.toUpperCase(), entry]));
    } catch {
      return new Map();
    }
  }

  private async request<T>(
    requestFn: () => Promise<{ data: T }>,
    context: string,
  ): Promise<T> {
    return retryWithBackoff(
      async () => {
        const response = await requestFn();
        return response.data;
      },
      {
        context,
        maxAttempts: this.maxRetries,
        initialDelayMs: this.initialRetryDelayMs,
        maxDelayMs: this.maxRetryDelayMs,
      },
    );
  }
}
