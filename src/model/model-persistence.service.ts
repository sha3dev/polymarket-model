/**
 * @section imports:externals
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type { ModelArtifact, ModelKey, ModelPersistenceSnapshot, ModelStatus } from "./model.types.ts";
import type { ModelArtifactCandidate, ModelLoadedArtifact, ModelPersistenceResult } from "./model-runtime.types.ts";

/**
 * @section consts
 */

const MANIFEST_SCHEMA_VERSION = 1;

/**
 * @section types
 */

type ModelPersistenceServiceOptions = {
  artifactRetention: number;
  stateDirectoryPath: string;
  temporaryDirectoryPath: string;
};

/**
 * @section class
 */

export class ModelPersistenceService {
  /**
   * @section private:attributes
   */

  private readonly artifactRetention: number;

  private readonly stateDirectoryPath: string;

  private readonly temporaryDirectoryPath: string;

  /**
   * @section constructor
   */

  public constructor(options: ModelPersistenceServiceOptions) {
    this.artifactRetention = options.artifactRetention;
    this.stateDirectoryPath = options.stateDirectoryPath;
    this.temporaryDirectoryPath = options.temporaryDirectoryPath;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelPersistenceService {
    const temporaryDirectoryPath = config.MODEL_STATE_TMP_DIR.length === 0 ? path.join(config.MODEL_STATE_DIR, "tmp") : config.MODEL_STATE_TMP_DIR;
    const modelPersistenceService = new ModelPersistenceService({
      artifactRetention: config.MODEL_ARTIFACT_RETENTION,
      stateDirectoryPath: config.MODEL_STATE_DIR,
      temporaryDirectoryPath,
    });
    return modelPersistenceService;
  }

  /**
   * @section private:methods
   */

  private buildManifestPath(): string {
    const manifestPath = path.join(this.stateDirectoryPath, "manifest.json");
    return manifestPath;
  }

  private buildModelsDirectoryPath(): string {
    const modelsDirectoryPath = path.join(this.stateDirectoryPath, "models");
    return modelsDirectoryPath;
  }

  private buildVersionDirectoryName(version: number): string {
    const versionDirectoryName = `v${String(version).padStart(6, "0")}`;
    return versionDirectoryName;
  }

  private buildHeadDirectoryPath(modelKey: ModelKey, head: "trend" | "clob"): string {
    const headDirectoryPath = path.join(this.buildModelsDirectoryPath(), modelKey, head);
    return headDirectoryPath;
  }

  private buildHeadVersionDirectoryPath(modelKey: ModelKey, head: "trend" | "clob", version: number): string {
    const headVersionDirectoryPath = path.join(this.buildHeadDirectoryPath(modelKey, head), this.buildVersionDirectoryName(version));
    return headVersionDirectoryPath;
  }

  private buildRelativeHeadPath(modelKey: ModelKey, head: "trend" | "clob", version: number): string {
    const relativeHeadPath = path.join("models", modelKey, head, this.buildVersionDirectoryName(version));
    return relativeHeadPath;
  }

  private buildTemporaryHeadDirectoryPath(modelKey: ModelKey, head: "trend" | "clob", version: number): string {
    const temporaryHeadDirectoryPath = path.join(this.temporaryDirectoryPath, `${modelKey}-${head}-${this.buildVersionDirectoryName(version)}-${Date.now()}`);
    return temporaryHeadDirectoryPath;
  }

  private async ensureBaseDirectories(): Promise<void> {
    await mkdir(this.buildModelsDirectoryPath(), { recursive: true });
    await mkdir(this.temporaryDirectoryPath, { recursive: true });
  }

  private async writeJsonFile(filePath: string, payload: unknown): Promise<void> {
    const serializedPayload = JSON.stringify(payload, null, 2);
    await writeFile(filePath, serializedPayload, "utf8");
  }

  private async saveHeadFiles(
    headDirectoryPath: string,
    headCandidate: ModelArtifactCandidate["trendModel"],
    metrics: ModelArtifact["metrics"],
  ): Promise<void> {
    await mkdir(headDirectoryPath, { recursive: true });
    await headCandidate.model.save(`file://${headDirectoryPath}`);
    await this.writeJsonFile(path.join(headDirectoryPath, "preprocessing.json"), {
      classWeights: headCandidate.classWeights,
      directionThreshold: headCandidate.directionThreshold,
      featureMedians: headCandidate.featureMedians,
      featureNames: headCandidate.featureNames,
      featureScales: headCandidate.featureScales,
      targetEncoding: headCandidate.targetEncoding,
    });
    await this.writeJsonFile(path.join(headDirectoryPath, "metrics.json"), metrics);
    await this.writeJsonFile(path.join(headDirectoryPath, "architecture.json"), headCandidate.architecture);
  }

  private async cleanupHeadVersions(modelKey: ModelKey, head: "trend" | "clob"): Promise<void> {
    const headDirectoryPath = this.buildHeadDirectoryPath(modelKey, head);

    if (existsSync(headDirectoryPath)) {
      const versionDirectoryNames = (await readdir(headDirectoryPath)).sort().reverse();
      const staleVersionDirectoryNames = versionDirectoryNames.slice(this.artifactRetention);

      for (const staleVersionDirectoryName of staleVersionDirectoryNames) {
        await rm(path.join(headDirectoryPath, staleVersionDirectoryName), { recursive: true, force: true });
      }
    }
  }

  private buildPersistedArtifact(modelKey: ModelKey, artifactCandidate: ModelArtifactCandidate): ModelArtifact {
    const persistedArtifact: ModelArtifact = {
      version: artifactCandidate.version,
      trainedAt: artifactCandidate.trainedAt,
      trainingSampleCount: artifactCandidate.trainingSampleCount,
      validationSampleCount: artifactCandidate.validationSampleCount,
      lastTrainWindowStart: artifactCandidate.lastTrainWindowStart,
      lastTrainWindowEnd: artifactCandidate.lastTrainWindowEnd,
      lastValidationWindowStart: artifactCandidate.lastValidationWindowStart,
      lastValidationWindowEnd: artifactCandidate.lastValidationWindowEnd,
      metrics: artifactCandidate.metrics,
      trendModel: {
        modelPath: this.buildRelativeHeadPath(modelKey, "trend", artifactCandidate.version),
        featureNames: artifactCandidate.trendModel.featureNames,
        featureMedians: artifactCandidate.trendModel.featureMedians,
        featureScales: artifactCandidate.trendModel.featureScales,
        classWeights: artifactCandidate.trendModel.classWeights,
        directionThreshold: artifactCandidate.trendModel.directionThreshold,
        architecture: artifactCandidate.trendModel.architecture,
        targetEncoding: artifactCandidate.trendModel.targetEncoding,
      },
      clobModel: {
        modelPath: this.buildRelativeHeadPath(modelKey, "clob", artifactCandidate.version),
        featureNames: artifactCandidate.clobModel.featureNames,
        featureMedians: artifactCandidate.clobModel.featureMedians,
        featureScales: artifactCandidate.clobModel.featureScales,
        classWeights: artifactCandidate.clobModel.classWeights,
        directionThreshold: artifactCandidate.clobModel.directionThreshold,
        architecture: artifactCandidate.clobModel.architecture,
        targetEncoding: artifactCandidate.clobModel.targetEncoding,
      },
    };
    return persistedArtifact;
  }

  private buildLoadedArtifact(artifactCandidate: ModelArtifactCandidate, persistedArtifact: ModelArtifact): ModelLoadedArtifact {
    const loadedArtifact: ModelLoadedArtifact = {
      version: persistedArtifact.version,
      trainedAt: persistedArtifact.trainedAt,
      trainingSampleCount: persistedArtifact.trainingSampleCount,
      validationSampleCount: persistedArtifact.validationSampleCount,
      lastTrainWindowStart: persistedArtifact.lastTrainWindowStart,
      lastTrainWindowEnd: persistedArtifact.lastTrainWindowEnd,
      lastValidationWindowStart: persistedArtifact.lastValidationWindowStart,
      lastValidationWindowEnd: persistedArtifact.lastValidationWindowEnd,
      metrics: persistedArtifact.metrics,
      trendModel: {
        metadata: persistedArtifact.trendModel,
        model: artifactCandidate.trendModel.model,
      },
      clobModel: {
        metadata: persistedArtifact.clobModel,
        model: artifactCandidate.clobModel.model,
      },
    };
    return loadedArtifact;
  }

  private buildManifestSnapshot(
    models: ModelPersistenceSnapshot["models"],
    lastTrainingCycleAt: string | null,
    lastTrainedSnapshotAt: string | null,
  ): ModelPersistenceSnapshot {
    const manifestSnapshot: ModelPersistenceSnapshot = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      lastTrainingCycleAt,
      lastTrainedSnapshotAt,
      models,
    };
    return manifestSnapshot;
  }

  /**
   * @section public:methods
   */

  public getStateDirectoryPath(): string {
    const stateDirectoryPath = this.stateDirectoryPath;
    return stateDirectoryPath;
  }

  public async loadManifest(): Promise<ModelPersistenceSnapshot | null> {
    const manifestPath = this.buildManifestPath();
    let manifestSnapshot: ModelPersistenceSnapshot | null = null;

    if (existsSync(manifestPath)) {
      logger.info(`model manifest restore started path=${manifestPath}`);
      const serializedSnapshot = await readFile(manifestPath, "utf8");
      const parsedSnapshot = JSON.parse(serializedSnapshot) as ModelPersistenceSnapshot;

      if (parsedSnapshot.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw new Error(`unsupported model manifest schema version ${parsedSnapshot.schemaVersion}`);
      }

      manifestSnapshot = parsedSnapshot;
      logger.info(`model manifest restore completed path=${manifestPath} models=${parsedSnapshot.models.length}`);
    } else {
      logger.info(`model manifest not found at ${manifestPath}, starting with empty persisted state`);
    }

    return manifestSnapshot;
  }

  public async persistModelArtifact(modelKey: ModelKey, artifactCandidate: ModelArtifactCandidate): Promise<ModelPersistenceResult> {
    await this.ensureBaseDirectories();
    const temporaryTrendDirectoryPath = this.buildTemporaryHeadDirectoryPath(modelKey, "trend", artifactCandidate.version);
    const temporaryClobDirectoryPath = this.buildTemporaryHeadDirectoryPath(modelKey, "clob", artifactCandidate.version);
    const trendDirectoryPath = this.buildHeadVersionDirectoryPath(modelKey, "trend", artifactCandidate.version);
    const clobDirectoryPath = this.buildHeadVersionDirectoryPath(modelKey, "clob", artifactCandidate.version);
    await this.saveHeadFiles(temporaryTrendDirectoryPath, artifactCandidate.trendModel, artifactCandidate.metrics);
    await this.saveHeadFiles(temporaryClobDirectoryPath, artifactCandidate.clobModel, artifactCandidate.metrics);
    await mkdir(this.buildHeadDirectoryPath(modelKey, "trend"), { recursive: true });
    await mkdir(this.buildHeadDirectoryPath(modelKey, "clob"), { recursive: true });
    await rename(temporaryTrendDirectoryPath, trendDirectoryPath);
    await rename(temporaryClobDirectoryPath, clobDirectoryPath);
    await this.cleanupHeadVersions(modelKey, "trend");
    await this.cleanupHeadVersions(modelKey, "clob");
    const persistedArtifact = this.buildPersistedArtifact(modelKey, artifactCandidate);
    const persistenceResult: ModelPersistenceResult = {
      artifact: persistedArtifact,
      loadedArtifact: this.buildLoadedArtifact(artifactCandidate, persistedArtifact),
    };
    return persistenceResult;
  }

  public async persistManifest(
    models: Array<{ artifact: ModelArtifact; modelKey: ModelKey; status: ModelStatus }>,
    lastTrainingCycleAt: string | null,
    lastTrainedSnapshotAt: string | null,
  ): Promise<void> {
    await this.ensureBaseDirectories();
    const manifestPath = this.buildManifestPath();
    const manifestSnapshot = this.buildManifestSnapshot(models, lastTrainingCycleAt, lastTrainedSnapshotAt);
    const temporaryManifestPath = path.join(this.temporaryDirectoryPath, "manifest.tmp.json");
    await this.writeJsonFile(temporaryManifestPath, manifestSnapshot);
    await rename(temporaryManifestPath, manifestPath);
  }
}
