# Coin Cast Implementation Guide

Coin Cast is a stateless crypto scanner built for scheduled runs. It does one job per execution:

1. discover a coin universe
2. pull market, order book, and news context
3. score each coin
4. turn the result into a Telegram message stream

The design is intentionally small and explicit. The goal is to keep it easy to reason about when an API fails, when the model is weak, or when the universe is noisy.

## Why this shape

### Stateless execution

The app runs as a cron job and does not persist state.

Reasons:
- cheaper to operate
- easier to redeploy
- no schema migrations
- no stale state to repair
- failures are isolated to one run

This is the right trade-off while the scanner is still exploratory and the signal logic is evolving quickly.

### Clean architecture

The code is split into:
- `domain` for stable business models
- `application` for scoring, ranking, and message composition
- `adapter` for external APIs such as Kraken, GDELT, and Telegram
- `config` for wiring
- `shared` for HTTP retries and keep-alive clients

Reasons:
- the scoring logic stays testable without network calls
- adapters can change without rewriting the domain model
- Telegram formatting can be reused by future bots or channels
- external API churn is contained in one layer

### Free-only data sources

The current implementation uses free public sources only:
- Kraken for market data, order books, and public prices pages
- GDELT for broad crypto news search

Reasons:
- no paid dependency
- easier to run on a cron budget
- easier to experiment while usage is still uncertain

## How the scan works

### 1. Universe discovery

Kraken is queried for tradable USD pairs. The repository also fetches Kraken’s public prices page to attach a real chart link when Kraken exposes one.

Why this matters:
- the scanner is not limited to a hardcoded coin list
- the universe can grow or shrink with the market
- the Telegram message can deep-link to the coin page when available

### 2. Market history and order book

For every asset, the scanner loads:
- daily historical candles
- current order book depth
- current price and 24h movement

Why this matters:
- candles drive trend and volatility features
- order book depth helps filter thin or distorted markets
- the model is less likely to trust low-quality coins

### 3. News ingestion

GDELT is used as a free broad news search layer.

Why this matters:
- it adds a non-price signal without depending on RSS feeds
- it can capture listings, hacks, partnerships, unlocks, and other market-moving events
- news is an input, not the only decision-maker

### 4. Feature and score generation

The app combines:
- technical trend
- market regime
- relative strength against BTC and ETH
- order book quality
- liquidity and asset quality
- news sentiment

Why this matters:
- one weak source does not dominate the result
- bullish or bearish calls become more explainable
- the scanner can stay conservative when the model is uncertain

### 5. Short-horizon prediction

The output is framed as a 5-hour forecast with an action recommendation.

Why this matters:
- it matches the product goal better than a generic “bullish/bearish” label
- users want “what should I do now” more than raw probability numbers
- the time window keeps the message actionable

### 6. Telegram delivery

Telegram gets:
- an intro message
- ignored coins as separate messages
- watchlist coins as separate messages
- signals as separate messages

Why this matters:
- the user sees the important guidance first
- bad or weak coins do not get mixed into the main signal stream
- each coin can be inspected independently
- delivery stays simple for scheduled runs

## Algorithm Map

The table below ties each reported number back to the code that computes it.
For the technical indicators, the app now uses the maintained `trading-signals` library release, vendored into `src/vendor/trading-signals`, so the scanner does not depend on the older `@ixjb94/indicators` package.

| Part of the output | What it calculates | Implementation | Algorithm reference |
|---|---|---|---|
| Universe and chart links | Loads Kraken tradable USD pairs and attaches a Kraken chart URL when the public prices page exposes one | [KrakenRepositoryImpl](../src/adapter/out/repository/api/KrakenRepositoryImpl.ts) | [Kraken prices and charts](https://support.kraken.com/hc/en-us/articles/201893698-trading-prices-and-charts-for-kraken) |
| Candles and indicators | Builds EMA(7/21/50), RSI(14), MACD(12/26/9), slopes, recent returns, correlation, and a normalized feature vector | [MarketFeatureBuilder](../src/application/service/MarketFeatureBuilder.ts) | [trading-signals on npm](https://www.npmjs.com/package/trading-signals), [GitHub repo](https://github.com/bennycode/trading-signals) |
| Market regime | Combines BTC/ETH 7-day return, 30-day volatility, and slope into a `risk_on` / `neutral` / `risk_off` score using `tanh` | [MarketConditionService](../src/application/service/MarketConditionService.ts) | Custom regime heuristic in code |
| Asset quality | Scores average volume, zero-volume days, short-term volatility, market-cap tier, and stretched recent moves | [AssetQualityService](../src/application/service/AssetQualityService.ts) | Custom liquidity / quality heuristic in code |
| News sentiment | Counts positive and negative crypto keywords, weights them by relevance and recency, then clamps the final score to `[-1, 1]` | [NewsSentimentScorer](../src/application/service/NewsSentimentScorer.ts) | [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) |
| Order book quality | Measures spread, USD depth, and bid/ask imbalance to score how tradable the market looks | [OrderBookAnalysisService](../src/application/service/OrderBookAnalysisService.ts) | [Kraken level 2 book](https://docs.kraken.com/api/docs/websocket-v2/book/) |
| Direction model | Trains a logistic-regression classifier with feature standardization, gradient descent, and L2 regularization | [LogisticRegressionClassifier](../src/application/service/LogisticRegressionClassifier.ts) | [LogisticRegression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html), [StandardScaler](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.StandardScaler.html) |
| Model validation | Uses a walk-forward holdout split, then computes accuracy, precision, recall, Brier score, calibration, and a confidence floor | [ModelQualityService](../src/application/service/ModelQualityService.ts) | [TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html) |
| 5-hour forecast and action | Blends direction, confidence, quality, regime, relative strength, volume, order book, and news into `fiveHourProbabilityUp`, duration, and `buy` / `wait` / `avoid` | [TradeAssessmentService](../src/application/service/TradeAssessmentService.ts) | Custom scoring and action heuristics in code |
| Final scan assembly | Orchestrates all repositories and services into signals, watchlist, and ignored coins | [CryptoSignalService](../src/application/service/CryptoSignalService.ts) | Orchestration layer, no external formula |

## Why the current model is lightweight

The current model is intentionally not TensorFlow-based.

Reasons:
- tabular, heuristic features are often better served by simple classifiers first
- the dataset is not yet stable enough to justify a deep model
- the scanner still needs explainable outputs more than opaque accuracy
- a small model is cheaper and easier to debug in Node

## Why there is no database yet

The app does not store historical runs.

Reasons:
- keeps the system lightweight
- avoids storage and retention complexity
- avoids migration work while the feature set is still changing

## Failure handling

The code is designed to degrade gracefully:
- API calls retry with exponential backoff
- failed coins are skipped instead of crashing the run
- watchlist and ignored coins are separated from strong signals
- Telegram messages are sent one by one with pacing

Why this matters:
- a scheduled job should finish cleanly even if one data source is noisy
- partial output is better than no output

## When a database becomes necessary

Add a database when one or more of these become true:

- you want backtesting across many historical runs
- you need persistent performance metrics by coin, day, or strategy
- you want to learn from past alerts and outcomes
- you want to store feature snapshots for offline model training
- you want deduplication so the same alert is not sent repeatedly

At that point, a small store like SQLite is enough for early experimentation. A larger store only becomes necessary once the volume of historical data or analytics grows.

## When TensorFlow becomes necessary

TensorFlow is worth adding only if the problem moves beyond simple tabular scoring.

That happens when:
- you have enough labeled history
- the feature space becomes large and non-linear
- the current model is plateauing after backtesting
- you need sequence-aware prediction from longer windows

Until then, TensorFlow would add complexity without guaranteeing better results.

## Future roadmap

Near-term:
- reusable internal packages for Telegram, Kraken, GDELT, and shared HTTP
- stronger data validation for thin or weird markets
- better explanation text for bullish and bearish cases

Medium-term:
- persistent historical alert log
- backtest report per signal type
- alert deduplication
- model calibration tracking

Long-term:
- offline training pipeline
- TensorFlow or another deeper model if the data justifies it
- optional database-backed analytics layer

## Formula Appendix

This section gives the plain math behind the main calculations.

### EMA

Exponential moving average is computed recursively:

`EMA_t = alpha * price_t + (1 - alpha) * EMA_(t-1)`

Where:
- `alpha = 2 / (period + 1)`
- `price_t` is the latest close
- the prior EMA seeds the series

In Coin Cast, EMA(7), EMA(21), and EMA(50) are used as short, medium, and longer trend anchors.

Code: [MarketFeatureBuilder](../src/application/service/MarketFeatureBuilder.ts)

### RSI

Relative Strength Index compares average gains and losses over a rolling window:

`RS = average_gain / average_loss`

`RSI = 100 - 100 / (1 + RS)`

Interpretation in this app:
- low RSI can indicate oversold pressure
- high RSI can indicate stretched upside

Code: [MarketFeatureBuilder](../src/application/service/MarketFeatureBuilder.ts)

### MACD

MACD is the difference between two EMAs:

`MACD line = EMA(12) - EMA(26)`

`Signal line = EMA(MACD line, 9)`

`Histogram = MACD line - Signal line`

In this app, the histogram is used as a momentum input and as one of the reasons text signals.

Code: [MarketFeatureBuilder](../src/application/service/MarketFeatureBuilder.ts)

### Logistic regression probability

The direction model turns the feature vector into a probability with:

`z = w · x + b`

`p(up) = 1 / (1 + e^-z)`

During training, weights are adjusted with gradient descent and L2 regularization.

Code: [LogisticRegressionClassifier](../src/application/service/LogisticRegressionClassifier.ts)

### Final 5-hour prediction blend

The final forecast is not a single model output. It is a weighted blend of:
- model confidence
- trend strength
- long-term trend
- momentum
- market regime
- asset quality
- relative strength
- volume confirmation
- order book score
- news sentiment

The action recommendation is then derived from the blended score:
- `buy` when the setup is strong and the 5-hour up probability is high
- `wait` when the setup is mixed
- `avoid` when the setup is weak or the probability is low

Code: [TradeAssessmentService](../src/application/service/TradeAssessmentService.ts)

## Sequence diagrams

### End-to-end scan

- [End-to-end scan source](diagrams/end-to-end-scan.seqdiag)

### Per-coin scoring

- [Per-coin scoring source](diagrams/per-coin-scoring.seqdiag)

### Telegram delivery

- [Telegram delivery source](diagrams/telegram-delivery.seqdiag)
