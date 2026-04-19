# Coin Cast

Coin Cast is a stateless TypeScript/Node market signal scanner built as an npm workspaces monorepo. It:

- pulls a dynamic crypto universe from Kraken's public REST market endpoints
- pulls a dynamic stock universe from Nasdaq's public screener and quote endpoints
- trains a lightweight logistic-regression model on recent market history
- adds free global market news search from GDELT
- runs crypto and stock scans as separate commands and sends the selected market output to Telegram one asset at a time

## Monorepo layout

The repo is split into small modules so the architecture is easier to follow and evolve:

- `apps/coin-cast`
  - application entrypoint and runtime wiring
- `packages/core`
  - domain models, ports, scoring services, and scan orchestration
- `packages/market-crypto`
  - Kraken adapter for crypto market data
- `packages/market-stocks`
  - Nasdaq adapter for stock market data
- `packages/news-gdelt`
  - GDELT news adapter
- `packages/notifications-telegram`
  - Telegram message formatting and delivery
- `packages/http-utils`
  - shared retry and HTTP client utilities

This structure keeps infrastructure adapters outside the core decisioning logic and makes the dependency flow explicit: app -> adapters/core, adapters -> core/http-utils, core -> no adapter packages.

## Documentation

- [Implementation guide](docs/implementation.md)
- [Sequence diagrams and supporting docs](docs/README.md)

## Run locally

1. Copy `.env.example` to `.env` and fill in the Telegram values.
2. Install dependencies.
3. Run one market at a time:
   - `npm run dev:crypto`
   - `npm run dev:stocks`

Useful workspace commands:

- `npm run dev:crypto`
- `npm run dev:stocks`
- `npm run start:crypto`
- `npm run start:stocks`
- `npm run build`
- `npm run typecheck`
- `npm test -- --run`
- `npm run lint`

## Environment

Required variables:

- `TELEGRAM_BASE_URL`
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional overrides:

- `KRAKEN_BASE_URL`
- `KRAKEN_UNIVERSE_LIMIT`
- `KRAKEN_HISTORY_DAYS`
- `NASDAQ_BASE_URL`
- `STOCK_UNIVERSE_LIMIT`
- `STOCK_HISTORY_DAYS`
- `GDELT_BASE_URL`
- `GDELT_TIMESPAN`
- `GDELT_MAX_RECORDS`
- `API_RETRY_MAX_ATTEMPTS`
- `API_RETRY_INITIAL_DELAY_MS`
- `API_RETRY_MAX_DELAY_MS`
- `TELEGRAM_MESSAGE_DELAY_MS`

`KRAKEN_UNIVERSE_LIMIT` defaults to `0`, which scans every available USD pair from Kraken.
`KRAKEN_HISTORY_DAYS` defaults to `180`. This widens the model lookback so trend signals are less sensitive to short-term noise.
`STOCK_UNIVERSE_LIMIT` defaults to `0`, which scans every stock returned by Nasdaq's screener. This is the heaviest run in the system and can take a long time because the app fetches historical candles per symbol.
`STOCK_HISTORY_DAYS` defaults to `180`. This widens the model lookback while still fitting comfortably inside Nasdaq's public historical endpoint.
`GDELT_TIMESPAN` defaults to `24h`. This keeps the news search recent without relying on feed syndication.
`GDELT_MAX_RECORDS` defaults to `50`. Raise it if you want more news coverage per scan, but expect more API work.
`API_RETRY_MAX_ATTEMPTS` defaults to `10`. `API_RETRY_INITIAL_DELAY_MS` defaults to `1000`. `API_RETRY_MAX_DELAY_MS` defaults to `30000`.
`TELEGRAM_MESSAGE_DELAY_MS` defaults to `30000`. Set it lower if you want faster Telegram delivery, or `0` to send immediately.

## GitHub Actions

The repo includes two separate scheduled workflows:

- `.github/workflows/crypto-scan.yml`
- `.github/workflows/stock-scan.yml`

Before enabling them on GitHub, add these repository or environment secrets:

- `TELEGRAM_BASE_URL`
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`

Both workflows reference the `telegram-production` environment so you can add required reviewers or other protection rules before the Telegram secrets are used.
