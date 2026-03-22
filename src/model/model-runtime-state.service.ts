/**
 * @section imports:externals
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type { ModelAsset, ModelPredictionRecord, ModelRuntimeStateAssetSnapshot, ModelRuntimeStateSnapshot } from "./model.types.ts";

/**
 * @section consts
 */

const RUNTIME_STATE_SCHEMA_VERSION = 2;

/**
 * @section types
 */

type ModelRuntimeStateServiceOptions = {
  stateDirectoryPath: string;
  supportedAssets: ModelAsset[];
  temporaryDirectoryPath: string;
};

/**
 * @section class
 */

export class ModelRuntimeStateService {
  /**
   * @section private:attributes
   */

  private readonly stateDirectoryPath: string;

  private readonly supportedAssets: ModelAsset[];

  private readonly temporaryDirectoryPath: string;

  /**
   * @section constructor
   */

  public constructor(options: ModelRuntimeStateServiceOptions) {
    this.stateDirectoryPath = options.stateDirectoryPath;
    this.supportedAssets = options.supportedAssets;
    this.temporaryDirectoryPath = options.temporaryDirectoryPath;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelRuntimeStateService {
    const temporaryDirectoryPath = config.MODEL_STATE_TMP_DIR.length === 0 ? path.join(config.MODEL_STATE_DIR, "tmp") : config.MODEL_STATE_TMP_DIR;
    const modelRuntimeStateService = new ModelRuntimeStateService({
      stateDirectoryPath: config.MODEL_STATE_DIR,
      supportedAssets: config.MODEL_SUPPORTED_ASSETS as ModelAsset[],
      temporaryDirectoryPath,
    });
    return modelRuntimeStateService;
  }

  /**
   * @section private:methods
   */

  private buildRuntimeStatePath(): string {
    const runtimeStatePath = path.join(this.stateDirectoryPath, "runtime-state.json");
    return runtimeStatePath;
  }

  private buildLegacyManifestPath(): string {
    const legacyManifestPath = path.join(this.stateDirectoryPath, "manifest.json");
    return legacyManifestPath;
  }

  private buildDefaultAssetState(): ModelRuntimeStateAssetSnapshot {
    const assetState: ModelRuntimeStateAssetSnapshot = {
      lastCollectorFromAt: null,
      lastProcessedBlockEndAt: null,
      lastProcessedBlockStartAt: null,
      recentPredictionRecords: [],
      rollingPredictionOutcomes: [],
    };
    return assetState;
  }

  private buildEmptyState(): ModelRuntimeStateSnapshot {
    const assets = this.supportedAssets.reduce<Record<ModelAsset, ModelRuntimeStateAssetSnapshot>>(
      (assetMap, asset) => {
        assetMap[asset] = this.buildDefaultAssetState();
        return assetMap;
      },
      {} as Record<ModelAsset, ModelRuntimeStateAssetSnapshot>,
    );
    const runtimeStateSnapshot: ModelRuntimeStateSnapshot = {
      assets,
      lastHistoricalBlockCompletedAt: null,
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    };
    return runtimeStateSnapshot;
  }

  private buildPredictionRecord(rawRecord: unknown): ModelPredictionRecord | null {
    const record = rawRecord as ModelPredictionRecord;
    const isValidRecord =
      typeof record?.predictionId === "string" &&
      typeof record.asset === "string" &&
      typeof record.source === "string" &&
      typeof record.status === "string" &&
      typeof record.issuedAt === "string";
    const predictionRecord = isValidRecord ? record : null;
    return predictionRecord;
  }

  private buildAssetState(rawRecord: unknown): ModelRuntimeStateAssetSnapshot {
    const record = rawRecord as Record<string, unknown>;
    const recentPredictionRecords = Array.isArray(record?.recentPredictionRecords)
      ? record.recentPredictionRecords.map((entry) => this.buildPredictionRecord(entry)).filter((entry) => entry !== null)
      : [];
    const rollingPredictionOutcomes = Array.isArray(record?.rollingPredictionOutcomes)
      ? record.rollingPredictionOutcomes.filter((entry) => typeof entry === "boolean")
      : [];
    const assetState: ModelRuntimeStateAssetSnapshot = {
      lastCollectorFromAt: typeof record?.lastCollectorFromAt === "string" ? record.lastCollectorFromAt : null,
      lastProcessedBlockEndAt: typeof record?.lastProcessedBlockEndAt === "string" ? record.lastProcessedBlockEndAt : null,
      lastProcessedBlockStartAt: typeof record?.lastProcessedBlockStartAt === "string" ? record.lastProcessedBlockStartAt : null,
      recentPredictionRecords,
      rollingPredictionOutcomes: rollingPredictionOutcomes as boolean[],
    };
    return assetState;
  }

  private parseStateRecord(rawRecord: Record<string, unknown>): ModelRuntimeStateSnapshot | null {
    const schemaVersion = typeof rawRecord.schemaVersion === "number" ? rawRecord.schemaVersion : null;
    const rawAssets = rawRecord.assets as Record<string, unknown> | undefined;
    let runtimeStateSnapshot: ModelRuntimeStateSnapshot | null = null;

    if (schemaVersion === RUNTIME_STATE_SCHEMA_VERSION && rawAssets !== undefined) {
      const assets = this.supportedAssets.reduce<Record<ModelAsset, ModelRuntimeStateAssetSnapshot>>(
        (assetMap, asset) => {
          assetMap[asset] = this.buildAssetState(rawAssets[asset]);
          return assetMap;
        },
        {} as Record<ModelAsset, ModelRuntimeStateAssetSnapshot>,
      );
      runtimeStateSnapshot = {
        assets,
        lastHistoricalBlockCompletedAt: typeof rawRecord.lastHistoricalBlockCompletedAt === "string" ? rawRecord.lastHistoricalBlockCompletedAt : null,
        schemaVersion,
      };
    }

    return runtimeStateSnapshot;
  }

  private parseLegacyManifest(rawRecord: Record<string, unknown>): ModelRuntimeStateSnapshot | null {
    const hasLegacyShape = Array.isArray(rawRecord.trendModels) && Array.isArray(rawRecord.clobModels);
    let runtimeStateSnapshot: ModelRuntimeStateSnapshot | null = null;

    if (hasLegacyShape) {
      runtimeStateSnapshot = this.buildEmptyState();
      logger.info(`restored empty crypto runtime state from legacy manifest path=${this.buildLegacyManifestPath()}`);
    }

    return runtimeStateSnapshot;
  }

  private async ensureBaseDirectories(): Promise<void> {
    await mkdir(this.stateDirectoryPath, { recursive: true });
    await mkdir(this.temporaryDirectoryPath, { recursive: true });
  }

  private async writeJsonFile(filePath: string, payload: unknown): Promise<void> {
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  /**
   * @section public:methods
   */

  public async loadState(): Promise<ModelRuntimeStateSnapshot> {
    const runtimeStatePath = this.buildRuntimeStatePath();
    let runtimeStateSnapshot = this.buildEmptyState();

    if (existsSync(runtimeStatePath)) {
      const rawRecord = JSON.parse(await readFile(runtimeStatePath, "utf8")) as Record<string, unknown>;
      const parsedState = this.parseStateRecord(rawRecord);

      if (parsedState !== null) {
        runtimeStateSnapshot = parsedState;
      }
    } else {
      if (existsSync(this.buildLegacyManifestPath())) {
        const rawRecord = JSON.parse(await readFile(this.buildLegacyManifestPath(), "utf8")) as Record<string, unknown>;
        const parsedLegacyState = this.parseLegacyManifest(rawRecord);

        if (parsedLegacyState !== null) {
          runtimeStateSnapshot = parsedLegacyState;
        }
      } else {
        logger.info(`runtime state not found at ${runtimeStatePath}, starting without persisted crypto cursor`);
      }
    }

    return runtimeStateSnapshot;
  }

  public async persistState(runtimeStateSnapshot: ModelRuntimeStateSnapshot): Promise<void> {
    const temporaryRuntimeStatePath = path.join(this.temporaryDirectoryPath, "runtime-state.tmp.json");

    await this.ensureBaseDirectories();
    await this.writeJsonFile(temporaryRuntimeStatePath, runtimeStateSnapshot);
    await rename(temporaryRuntimeStatePath, this.buildRuntimeStatePath());
  }
}
