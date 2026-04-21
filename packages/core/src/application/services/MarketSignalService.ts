import type { NewsFeed } from '../../domain/models/NewsFeed';
import type { AssetQuality } from '../../domain/models/AssetQuality';
import type { MarketSignal } from '../../domain/models/MarketSignal';
import type { MarketCondition } from '../../domain/models/MarketCondition';
import type { MarketAsset, MarketAssetClass } from '../../domain/models/MarketAsset';
import type { OrderBookSnapshot } from '../../domain/models/OrderBook';
import type { MarketRepository } from '../ports/MarketRepository';
import type { NewsFeedRepository } from '../ports/NewsFeedRepository';

import { createLogger } from '../logging/logger';
import { AssetQualityService } from './AssetQualityService';
import {
  LogisticRegressionClassifier,
  type SerializedLogisticRegressionClassifier,
} from './LogisticRegressionClassifier';
import {
  MarketFeatureBuilder,
  type BenchmarkCandles,
  type MarketSample,
} from './MarketFeatureBuilder';
import { MarketConditionService } from './MarketConditionService';
import { ModelQualityService, type ModelQualityReport } from './ModelQualityService';
import { NewsSentimentScorer } from './NewsSentimentScorer';
import { OrderBookAnalysisService } from './OrderBookAnalysisService';
import { TradeAssessmentService } from './TradeAssessmentService';
import type { SignalScanProfile } from './scanProfiles';
import { cryptoScanProfile } from './scanProfiles';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';

export interface ScanOptions {
  universeLimit: number;
  historyDays: number;
  historyLoadConcurrency?: number;
  symbolFilter?: string[];
  maxSignals: number;
  actionableConfidence: number;
}

export interface ScanResult {
  scannedAt: Date;
  assetsScanned: number;
  samplesUsed: number;
  signals: MarketSignal[];
  watchlist: MarketSignal[];
  ignoredAssets: IgnoredAssetSummary[];
  headlinesUsed: number;
  modelQuality: ModelQualityReport;
}

export interface IgnoredAssetSummary {
  assetId: string;
  assetClass: MarketAssetClass;
  symbol: string;
  name: string;
  reason: string;
}

interface ScanHookContext {
  scannedAt: Date;
}

export interface ScanHooks {
  onSignal?: (signal: MarketSignal, context: ScanHookContext) => Promise<void> | void;
  onWatchlist?: (signal: MarketSignal, context: ScanHookContext) => Promise<void> | void;
}

export interface PretrainedMarketModel {
  assetClass: MarketAssetClass;
  trainedAt: string;
  assetsTrained: number;
  samplesUsed: number;
  model: SerializedLogisticRegressionClassifier;
  modelQuality: ModelQualityReport;
}

export interface ScanExecutionOptions {
  hooks?: ScanHooks;
  pretrainedModel?: PretrainedMarketModel;
}

const DEFAULT_LOAD_CONCURRENCY = 5;
const DEFAULT_STOCK_HISTORY_LOAD_CONCURRENCY = 2;
const elapsedMs = (startedAt: number): number => Date.now() - startedAt;

export class MarketSignalService {
  private readonly logger = createLogger('market-signal-service');

  private readonly featureBuilder = new MarketFeatureBuilder();

  private readonly assetQualityService = new AssetQualityService();

  private readonly marketConditionService = new MarketConditionService();

  private readonly modelQualityService = new ModelQualityService();

  private readonly orderBookAnalysisService = new OrderBookAnalysisService();

  private readonly newsSentimentScorer = new NewsSentimentScorer();

  private readonly tradeAssessmentService = new TradeAssessmentService();

  constructor(
    private readonly marketRepository: MarketRepository,
    private readonly newsRepositories: NewsFeedRepository[],
    private readonly profile: SignalScanProfile = cryptoScanProfile,
  ) {}

  async train(options: ScanOptions): Promise<PretrainedMarketModel> {
    const trainingStartedAt = Date.now();
    const assets = await this.loadAssets(options);
    const candlesByAsset = await this.loadHistoricalCandles(
      assets,
      options.historyDays,
      options.historyLoadConcurrency,
    );
    const benchmarkCandles = await this.loadBenchmarkCandles(options.historyDays);
    const { allSamples, sampleByAsset } = await this.prepareSamples(
      assets,
      candlesByAsset,
      benchmarkCandles,
    );
    const model = this.trainModel(allSamples);
    const modelQuality = this.modelQualityService.evaluate(Array.from(sampleByAsset.values()));

    this.logger.info('Pretrained market model prepared', {
      market: this.profile.assetClass,
      assetsTrained: sampleByAsset.size,
      samplesUsed: allSamples.length,
      modelQuality: modelQuality.qualityLabel,
      durationMs: elapsedMs(trainingStartedAt),
    });

    return {
      assetClass: this.profile.assetClass,
      trainedAt: new Date().toISOString(),
      assetsTrained: sampleByAsset.size,
      samplesUsed: allSamples.length,
      model: model.serialize(),
      modelQuality,
    };
  }

  async scan(options: ScanOptions, execution: ScanExecutionOptions = {}): Promise<ScanResult> {
    const hooks = execution.hooks ?? {};
    const pretrainedModel = execution.pretrainedModel;

    if (pretrainedModel && pretrainedModel.assetClass !== this.profile.assetClass) {
      throw new Error(
        `Pretrained model asset class ${pretrainedModel.assetClass} does not match ${this.profile.assetClass}`,
      );
    }

    const scanStartedAt = Date.now();
    const scannedAt = new Date();
    this.logger.info('Starting market scan', {
      market: this.profile.assetClass,
      universeLimit: options.universeLimit,
      historyDays: options.historyDays,
      maxSignals: options.maxSignals,
      actionableConfidence: options.actionableConfidence,
      repository: this.marketRepository.constructor.name,
    });

    const universeLoadStartedAt = Date.now();
    const assets = await this.loadAssets(options);
    this.logger.info('Universe loaded', {
      market: this.profile.assetClass,
      assetsDiscovered: assets.length,
      durationMs: elapsedMs(universeLoadStartedAt),
    });

    const historicalLoadStartedAt = Date.now();
    const candlesByAsset = await this.loadHistoricalCandles(
      assets,
      options.historyDays,
      options.historyLoadConcurrency,
    );
    this.logger.info('Historical candle stage finished', {
      market: this.profile.assetClass,
      assetsRequested: assets.length,
      durationMs: elapsedMs(historicalLoadStartedAt),
    });

    const benchmarkLoadStartedAt = Date.now();
    const benchmarkCandles = await this.loadBenchmarkCandles(options.historyDays);
    this.logger.info('Benchmark candle stage finished', {
      market: this.profile.assetClass,
      durationMs: elapsedMs(benchmarkLoadStartedAt),
    });

    const orderBookLoadStartedAt = Date.now();
    const orderBooksByAsset = await this.loadOrderBooks(assets);
    this.logger.info('Order book stage finished', {
      market: this.profile.assetClass,
      durationMs: elapsedMs(orderBookLoadStartedAt),
    });

    const marketCondition = this.marketConditionService.evaluate(
      benchmarkCandles.primary,
      benchmarkCandles.secondary,
      benchmarkCandles.displayLabel,
    );

    const headlineLoadStartedAt = Date.now();
    const headlines = await this.loadHeadlines();
    this.logger.info('Headline stage finished', {
      market: this.profile.assetClass,
      durationMs: elapsedMs(headlineLoadStartedAt),
    });

    const samplePreparationStartedAt = Date.now();
    const { allSamples, sampleByAsset, qualityByAsset } = await this.prepareSamples(
      assets,
      candlesByAsset,
      benchmarkCandles,
    );

    this.logger.info('Prepared training samples', {
      market: this.profile.assetClass,
      assetsWithSamples: sampleByAsset.size,
      totalSamples: allSamples.length,
      durationMs: elapsedMs(samplePreparationStartedAt),
    });

    const modelTrainingStartedAt = Date.now();
    const model = pretrainedModel
      ? LogisticRegressionClassifier.deserialize(pretrainedModel.model)
      : this.trainModel(allSamples);
    const modelQuality = pretrainedModel?.modelQuality
      ?? this.modelQualityService.evaluate(Array.from(sampleByAsset.values()));
    const samplesUsed = pretrainedModel?.samplesUsed ?? allSamples.length;
    this.logger.info('Model evaluation stage finished', {
      market: this.profile.assetClass,
      samplesEvaluated: modelQuality.samplesEvaluated,
      pretrainedModelLoaded: pretrainedModel != null,
      durationMs: elapsedMs(modelTrainingStartedAt),
    });

    const signals: MarketSignal[] = [];
    const watchlist: MarketSignal[] = [];
    const ignoredAssets: IgnoredAssetSummary[] = [];
    const calibrationFactor = modelQuality.samplesEvaluated === 0 ? 1 : modelQuality.calibrationFactor;
    const confidenceFloor =
      modelQuality.samplesEvaluated === 0
        ? options.actionableConfidence
        : Math.max(options.actionableConfidence, modelQuality.recommendedConfidenceFloor);

    const signalAssemblyStartedAt = Date.now();
    for (const asset of assets) {
      const candles = candlesByAsset.get(asset.id) ?? [];
      const snapshot = await this.featureBuilder.buildSnapshot(candles, asset, benchmarkCandles);
      const samples = sampleByAsset.get(asset.id);
      const quality = qualityByAsset.get(asset.id);
      const orderBook = orderBooksByAsset.get(asset.id);
      const orderBookAnalysis = orderBook
        ? this.orderBookAnalysisService.evaluate(orderBook)
        : null;

      if (!snapshot || !samples || samples.length === 0 || !quality) {
        ignoredAssets.push({
          assetId: asset.id,
          assetClass: asset.assetClass,
          symbol: asset.symbol,
          name: asset.name,
          reason: !snapshot
            ? 'price history unavailable after retries or not enough history'
            : !samples || samples.length === 0
              ? `not enough training samples for this ${this.profile.assetNounSingular}`
              : 'quality data unavailable',
        });
        continue;
      }

      const technicalProbability = model.predictProbability(snapshot.features);
      const newsSentiment = this.newsSentimentScorer.score(asset, headlines);
      const bullishProbability = this.calibrateProbability(
        this.combineSignals(
          technicalProbability,
          newsSentiment.score,
          quality,
          marketCondition,
          snapshot.relativeStrengthScore,
          snapshot.volumeConfirmationScore,
        ),
        calibrationFactor,
      );
      const orderBookProbability = orderBookAnalysis == null ? 0.5 : orderBookAnalysis.score;
      const adjustedBullishProbability = this.calibrateProbability(
        bullishProbability * 0.9 + orderBookProbability * 0.1,
        1,
      );
      const direction = adjustedBullishProbability >= 0.5 ? 'bullish' : 'bearish';
      const confidence =
        direction === 'bullish' ? adjustedBullishProbability : 1 - adjustedBullishProbability;
      const edge = Math.abs(adjustedBullishProbability - 0.5) * 2;
      const assessment = this.tradeAssessmentService.evaluate({
        direction,
        confidence,
        newsScore: newsSentiment.score,
        quality,
        marketCondition,
        snapshot,
        orderBookScore: orderBookProbability,
      });

      const signal: MarketSignal = {
        assetId: asset.id,
        assetClass: asset.assetClass,
        symbol: asset.symbol,
        name: asset.name,
        direction,
        confidence,
        fiveHourProbabilityUp: assessment.fiveHourProbabilityUp,
        actionRecommendation: assessment.actionRecommendation,
        expectedDurationHours: assessment.expectedDurationHours,
        expectedDurationLabel: assessment.expectedDurationLabel,
        tradeSuitabilityScore: assessment.tradeSuitabilityScore,
        tradeVerdict: assessment.tradeVerdict,
        modelProbabilityUp: technicalProbability,
        newsScore: newsSentiment.score,
        qualityScore: quality.score,
        marketConditionScore: marketCondition.score,
        relativeStrengthScore: snapshot.relativeStrengthScore,
        orderBookScore: orderBookAnalysis?.score,
        orderBookSpreadPercent: orderBookAnalysis?.spreadPercent,
        orderBookImbalance: orderBookAnalysis?.imbalance,
        priceUsd: snapshot.priceUsd,
        change24hPercent: asset.change24hPercent,
        marketPageUrl: asset.marketPageUrl,
        marketPageLabel: asset.marketPageLabel,
        reasons: this.buildReasons(
          technicalProbability,
          snapshot.reasons,
          newsSentiment.score,
          newsSentiment.matchedHeadlines,
          quality,
          marketCondition,
          snapshot.relativeStrengthScore,
          snapshot.volumeConfirmationScore,
          orderBookAnalysis?.reasons ?? [],
        ),
      };

      if (edge < confidenceFloor) {
        const watchlistFloor = Math.max(0.12, confidenceFloor * 0.65);
        if (edge >= watchlistFloor) {
          watchlist.push(signal);
          await hooks.onWatchlist?.(signal, { scannedAt });
        } else {
          ignoredAssets.push({
            assetId: asset.id,
            assetClass: asset.assetClass,
            symbol: asset.symbol,
            name: asset.name,
            reason: `confidence ${Math.round(edge * 100)}% below alert threshold ${Math.round(
              confidenceFloor * 100,
            )}%`,
          });
        }
        continue;
      }

      signals.push(signal);
      await hooks.onSignal?.(signal, { scannedAt });
    }

    signals.sort((left, right) => right.confidence - left.confidence);
    watchlist.sort((left, right) => right.confidence - left.confidence);

    this.logger.info('Market scan completed', {
      market: this.profile.assetClass,
      assetsScanned: assets.length,
      samplesUsed,
      signals: signals.length,
      watchlist: watchlist.length,
      ignoredAssets: ignoredAssets.length,
      headlinesUsed: headlines.length,
      modelQuality: modelQuality.qualityLabel,
      signalAssemblyDurationMs: elapsedMs(signalAssemblyStartedAt),
      totalDurationMs: elapsedMs(scanStartedAt),
    });

    return {
      scannedAt,
      assetsScanned: assets.length,
      samplesUsed,
      signals: signals.slice(0, options.maxSignals),
      watchlist: watchlist.slice(0, options.maxSignals),
      ignoredAssets: ignoredAssets.slice(0, options.maxSignals),
      headlinesUsed: headlines.length,
      modelQuality,
    };
  }

  private async loadAssets(options: ScanOptions): Promise<MarketAsset[]> {
    const requestedSymbols = options.symbolFilter?.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean) ?? [];
    const universeLimit = requestedSymbols.length > 0 ? 0 : options.universeLimit;
    const discovered = await this.marketRepository.getUniverse(universeLimit);

    if (requestedSymbols.length === 0) {
      return discovered;
    }

    const requestedSet = new Set(requestedSymbols);
    const filtered = discovered.filter((asset) => requestedSet.has(asset.symbol.toUpperCase()));
    const foundSymbols = new Set(filtered.map((asset) => asset.symbol.toUpperCase()));
    const missingSymbols = requestedSymbols.filter((symbol) => !foundSymbols.has(symbol));

    this.logger.info('Applied symbol filter to market universe', {
      market: this.profile.assetClass,
      requestedSymbols: requestedSymbols.length,
      matchedAssets: filtered.length,
      missingSymbols: missingSymbols.length,
      missingSample: missingSymbols.slice(0, 10),
    });

    return filtered;
  }

  private async prepareSamples(
    assets: MarketAsset[],
    candlesByAsset: Map<string, Awaited<ReturnType<MarketRepository['getHistoricalCandles']>>>,
    benchmarkCandles: BenchmarkCandles,
  ): Promise<{
    allSamples: MarketSample[];
    sampleByAsset: Map<string, MarketSample[]>;
    qualityByAsset: Map<string, AssetQuality>;
  }> {
    const allSamples: MarketSample[] = [];
    const sampleByAsset = new Map<string, MarketSample[]>();
    const qualityByAsset = new Map<string, AssetQuality>();

    for (const asset of assets) {
      const candles = candlesByAsset.get(asset.id) ?? [];
      const quality = this.assetQualityService.evaluate(asset, candles);
      const samples = await this.featureBuilder.buildSamples(candles, asset, benchmarkCandles);
      if (samples.length === 0) {
        continue;
      }

      qualityByAsset.set(asset.id, quality);
      sampleByAsset.set(asset.id, samples);
      allSamples.push(...samples);
    }

    return {
      allSamples,
      sampleByAsset,
      qualityByAsset,
    };
  }

  private trainModel(samples: MarketSample[]): LogisticRegressionClassifier {
    const model = new LogisticRegressionClassifier();

    if (samples.length === 0) {
      this.logger.warn('Skipping model training because no samples were produced', {
        market: this.profile.assetClass,
      });
      return model;
    }

    const labels = samples.map((sample) => sample.label);
    if (new Set(labels).size < 2) {
      this.logger.warn('Skipping model training because labels do not contain both classes', {
        market: this.profile.assetClass,
        sampleCount: samples.length,
      });
      return model;
    }

    this.logger.info('Training logistic regression model', {
      market: this.profile.assetClass,
      sampleCount: samples.length,
    });
    model.fit(
      samples.map((sample) => sample.features),
      labels,
      {
        learningRate: 0.05,
        iterations: 500,
        l2: 0.001,
      },
    );

    return model;
  }

  private async loadHistoricalCandles(
    assets: MarketAsset[],
    historyDays: number,
    concurrencyOverride?: number,
  ): Promise<Map<string, Awaited<ReturnType<MarketRepository['getHistoricalCandles']>>>> {
    const concurrency = this.getHistoricalLoadConcurrency(concurrencyOverride);
    const progressInterval = this.getProgressInterval(assets.length);
    let completed = 0;
    let assetsWithHistory = 0;

    this.logger.info('Loading historical candles', {
      market: this.profile.assetClass,
      assets: assets.length,
      historyDays,
      concurrency,
    });

    const entries = await mapWithConcurrency(
      assets,
      concurrency,
      async (asset) => {
        const candles = await this.marketRepository.getHistoricalCandles(asset, historyDays);
        completed += 1;
        if (candles.length > 0) {
          assetsWithHistory += 1;
        }

        if (
          completed <= Math.min(3, assets.length) ||
          completed % progressInterval === 0 ||
          completed === assets.length
        ) {
          this.logger.info('Historical candle load progress', {
            market: this.profile.assetClass,
            completed,
            total: assets.length,
            symbol: asset.symbol,
            candles: candles.length,
          });
        }

        return [asset.id, candles] as const;
      },
    );

    this.logger.info('Historical candles loaded', {
      market: this.profile.assetClass,
      totalAssets: assets.length,
      assetsWithHistory,
      assetsWithoutHistory: assets.length - assetsWithHistory,
    });

    return new Map(entries);
  }

  private async loadHeadlines(): Promise<NewsFeed[]> {
    this.logger.info('Loading news headlines', {
      market: this.profile.assetClass,
      repositories: this.newsRepositories.length,
    });
    const headlineGroups = await Promise.all(
      this.newsRepositories.map(async (repository) => repository.getHeadlines()),
    );

    const headlines = headlineGroups.flat();
    this.logger.info('News headlines loaded', {
      market: this.profile.assetClass,
      headlines: headlines.length,
    });

    return headlines;
  }

  private async loadBenchmarkCandles(historyDays: number): Promise<BenchmarkCandles> {
    this.logger.info('Loading benchmark candles', {
      market: this.profile.assetClass,
      benchmarkPrimary: this.profile.benchmarkPrimary.symbol,
      benchmarkSecondary: this.profile.benchmarkSecondary.symbol,
      historyDays,
    });
    const [primary, secondary] = await Promise.all([
      this.marketRepository.getHistoricalCandles(this.profile.benchmarkPrimary, historyDays),
      this.marketRepository.getHistoricalCandles(this.profile.benchmarkSecondary, historyDays),
    ]);

    this.logger.info('Benchmark candles loaded', {
      market: this.profile.assetClass,
      benchmarkPrimary: this.profile.benchmarkPrimary.symbol,
      primaryCandles: primary.length,
      benchmarkSecondary: this.profile.benchmarkSecondary.symbol,
      secondaryCandles: secondary.length,
    });

    return {
      primary,
      secondary,
      displayLabel: this.profile.benchmarkDisplayLabel,
    };
  }

  private async loadOrderBooks(assets: MarketAsset[]): Promise<Map<string, OrderBookSnapshot>> {
    if (this.profile.assetClass === 'stock') {
      this.logger.info('Skipping order book loading for stock scan', {
        market: this.profile.assetClass,
      });
      return new Map();
    }

    this.logger.info('Loading order books', {
      market: this.profile.assetClass,
      assets: assets.length,
      concurrency: DEFAULT_LOAD_CONCURRENCY,
    });
    const entries = await mapWithConcurrency(
      assets,
      DEFAULT_LOAD_CONCURRENCY,
      async (asset) => [asset.id, await this.marketRepository.getOrderBook(asset, 10)] as const,
    );

    const orderBooks = new Map(
      entries.filter((entry): entry is readonly [string, OrderBookSnapshot] => entry[1] != null),
    );

    this.logger.info('Order books loaded', {
      market: this.profile.assetClass,
      assetsWithOrderBooks: orderBooks.size,
      assetsRequested: assets.length,
    });

    return orderBooks;
  }

  private getHistoricalLoadConcurrency(concurrencyOverride?: number): number {
    if (concurrencyOverride != null && Number.isFinite(concurrencyOverride) && concurrencyOverride > 0) {
      return Math.max(1, Math.floor(concurrencyOverride));
    }

    return this.profile.assetClass === 'stock'
      ? DEFAULT_STOCK_HISTORY_LOAD_CONCURRENCY
      : DEFAULT_LOAD_CONCURRENCY;
  }

  private getProgressInterval(totalAssets: number): number {
    if (totalAssets <= 25) {
      return 5;
    }

    if (totalAssets <= 250) {
      return 25;
    }

    return 100;
  }

  private combineSignals(
    technicalProbability: number,
    newsScore: number,
    quality: AssetQuality,
    marketCondition: MarketCondition,
    relativeStrengthScore: number,
    volumeConfirmationScore: number,
  ): number {
    const newsBullishProbability = 0.5 + newsScore / 2;
    const marketConditionBullish = 0.5 + marketCondition.score / 2;
    const qualityFactor = 0.6 + quality.score * 0.4;
    const strengthFactor = 0.85 + Math.min(0.15, Math.abs(relativeStrengthScore) * 2);
    const volumeFactor = 0.9 + Math.min(0.1, Math.max(0, volumeConfirmationScore - 1) / 5);

    const blended =
      technicalProbability * 0.5 +
      newsBullishProbability * 0.15 +
      marketConditionBullish * 0.2 +
      strengthFactor * 0.05 +
      volumeFactor * 0.1;

    return Math.max(0, Math.min(1, blended * qualityFactor));
  }

  private calibrateProbability(probability: number, calibrationFactor: number): number {
    return Math.max(0, Math.min(1, 0.5 + (probability - 0.5) * calibrationFactor));
  }

  private buildReasons(
    technicalProbability: number,
    technicalReasons: string[],
    newsScore: number,
    matchedHeadlines: string[],
    quality: AssetQuality,
    marketCondition: MarketCondition,
    relativeStrengthScore: number,
    volumeConfirmationScore: number,
    orderBookReasons: string[],
  ): string[] {
    const reasons = [...technicalReasons];

    if (technicalProbability >= 0.65) {
      reasons.push('model probability is decisively bullish');
    } else if (technicalProbability <= 0.35) {
      reasons.push('model probability is decisively bearish');
    }

    if (newsScore > 0.2) {
      reasons.push('news sentiment is positive');
    } else if (newsScore < -0.2) {
      reasons.push('news sentiment is negative');
    }

    if (quality.score >= 0.8) {
      reasons.push('asset liquidity quality is strong');
    } else if (quality.score < 0.5) {
      reasons.push('asset liquidity quality is weak');
    }

    if (marketCondition.label === 'risk_on') {
      reasons.push('broader market regime is risk-on');
    } else if (marketCondition.label === 'risk_off') {
      reasons.push('broader market regime is risk-off');
    }

    if (relativeStrengthScore > 0.02) {
      reasons.push(
        `${this.profile.assetNounSingular} is outperforming ${this.profile.benchmarkDisplayLabel}`,
      );
    } else if (relativeStrengthScore < -0.02) {
      reasons.push(
        `${this.profile.assetNounSingular} is underperforming ${this.profile.benchmarkDisplayLabel}`,
      );
    }

    if (volumeConfirmationScore > 1.1) {
      reasons.push('volume confirms the move');
    } else if (volumeConfirmationScore < 0.8) {
      reasons.push('volume is not confirming the move');
    }

    if (matchedHeadlines.length > 0) {
      reasons.push(
        `matched ${matchedHeadlines.length} recent headline${matchedHeadlines.length === 1 ? '' : 's'}`,
      );
    }

    reasons.push(...orderBookReasons);

    return reasons.slice(0, 5);
  }
}
