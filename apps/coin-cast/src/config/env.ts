export interface AppConfig {
  krakenBaseUrl: string;
  krakenUniverseLimit: number;
  krakenHistoryDays: number;
  krakenSymbols?: string[];
  krakenModelArtifactPath?: string;
  nasdaqBaseUrl: string;
  stockUniverseLimit: number;
  stockHistoryDays: number;
  stockHistoryLoadConcurrency: number;
  stockSymbols?: string[];
  stockModelArtifactPath?: string;
  apiRetryMaxAttempts: number;
  apiRetryInitialDelayMs: number;
  apiRetryMaxDelayMs: number;
  telegramMessageDelayMs: number;
  gdeltBaseUrl: string;
  gdeltTimespan: string;
  gdeltMaxRecords: number;
}

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is not defined`);
  }

  return value;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseSymbolList = (value: string | undefined): string[] | undefined => {
  if (!value) {
    return undefined;
  }

  const symbols = value
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  return symbols.length > 0 ? symbols : undefined;
};

export const loadAppConfig = (): AppConfig => ({
  krakenBaseUrl: required('KRAKEN_BASE_URL', 'https://api.kraken.com/0/public'),
  krakenUniverseLimit: parseNonNegativeNumber(process.env.KRAKEN_UNIVERSE_LIMIT, 0),
  krakenHistoryDays: parseNumber(process.env.KRAKEN_HISTORY_DAYS, 180),
  krakenSymbols: parseSymbolList(process.env.KRAKEN_SYMBOLS),
  krakenModelArtifactPath: process.env.KRAKEN_MODEL_ARTIFACT_PATH?.trim() || undefined,
  nasdaqBaseUrl: required('NASDAQ_BASE_URL', 'https://api.nasdaq.com/api'),
  stockUniverseLimit: parseNonNegativeNumber(process.env.STOCK_UNIVERSE_LIMIT, 0),
  stockHistoryDays: parseNumber(process.env.STOCK_HISTORY_DAYS, 180),
  stockHistoryLoadConcurrency: parseNumber(process.env.STOCK_HISTORY_LOAD_CONCURRENCY, 8),
  stockSymbols: parseSymbolList(process.env.STOCK_SYMBOLS),
  stockModelArtifactPath: process.env.STOCK_MODEL_ARTIFACT_PATH?.trim() || undefined,
  apiRetryMaxAttempts: parseNumber(process.env.API_RETRY_MAX_ATTEMPTS, 10),
  apiRetryInitialDelayMs: parseNumber(process.env.API_RETRY_INITIAL_DELAY_MS, 1000),
  apiRetryMaxDelayMs: parseNumber(process.env.API_RETRY_MAX_DELAY_MS, 30000),
  telegramMessageDelayMs: parseNonNegativeNumber(process.env.TELEGRAM_MESSAGE_DELAY_MS, 1000),
  gdeltBaseUrl: required('GDELT_BASE_URL', 'https://api.gdeltproject.org/api/v2/doc/doc'),
  gdeltTimespan: required('GDELT_TIMESPAN', '24h'),
  gdeltMaxRecords: parseNumber(process.env.GDELT_MAX_RECORDS, 50),
});
