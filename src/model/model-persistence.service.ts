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
import type {
  ModelClobArtifact,
  ModelClobKey,
  ModelPersistenceClobModel,
  ModelPersistenceSnapshot,
  ModelPersistenceTrendModel,
  ModelTrendArtifact,
  ModelTrendKey,
} from "./model.types.ts";

/**
 * @section consts
 */

const MANIFEST_SCHEMA_VERSION = 2;

/**
 * @section types
 */

type ModelPersistenceServiceOptions = {
  stateDirectoryPath: string;
  temporaryDirectoryPath: string;
};

type ModelArtifactPathPair = {
  absoluteDirectoryPath: string;
  relativeDirectoryPath: string;
};

/**
 * @section class
 */

export class ModelPersistenceService {
  /**
   * @section private:attributes
   */

  private readonly stateDirectoryPath: string;

  private readonly temporaryDirectoryPath: string;

  /**
   * @section constructor
   */

  public constructor(options: ModelPersistenceServiceOptions) {
    this.stateDirectoryPath = options.stateDirectoryPath;
    this.temporaryDirectoryPath = options.temporaryDirectoryPath;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelPersistenceService {
    const temporaryDirectoryPath = config.MODEL_STATE_TMP_DIR.length === 0 ? path.join(config.MODEL_STATE_DIR, "tmp") : config.MODEL_STATE_TMP_DIR;
    const modelPersistenceService = new ModelPersistenceService({
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

  private buildVersionDirectoryName(version: number): string {
    const versionDirectoryName = `v${String(version).padStart(6, "0")}`;
    return versionDirectoryName;
  }

  private async ensureBaseDirectories(): Promise<void> {
    await mkdir(this.stateDirectoryPath, { recursive: true });
    await mkdir(this.temporaryDirectoryPath, { recursive: true });
  }

  private async writeJsonFile(filePath: string, payload: unknown): Promise<void> {
    const serializedPayload = JSON.stringify(payload, null, 2);
    await writeFile(filePath, serializedPayload, "utf8");
  }

  /**
   * @section public:methods
   */

  public getStateDirectoryPath(): string {
    const stateDirectoryPath = this.stateDirectoryPath;
    return stateDirectoryPath;
  }

  public buildTrendArtifactPaths(trendKey: ModelTrendKey, version: number): ModelArtifactPathPair {
    const relativeDirectoryPath = path.join("models", "trend", trendKey, this.buildVersionDirectoryName(version));
    const absoluteDirectoryPath = path.join(this.stateDirectoryPath, relativeDirectoryPath);
    const artifactPathPair: ModelArtifactPathPair = {
      absoluteDirectoryPath,
      relativeDirectoryPath,
    };
    return artifactPathPair;
  }

  public buildClobArtifactPaths(modelKey: ModelClobKey, version: number): ModelArtifactPathPair {
    const relativeDirectoryPath = path.join("models", "clob", modelKey, this.buildVersionDirectoryName(version));
    const absoluteDirectoryPath = path.join(this.stateDirectoryPath, relativeDirectoryPath);
    const artifactPathPair: ModelArtifactPathPair = {
      absoluteDirectoryPath,
      relativeDirectoryPath,
    };
    return artifactPathPair;
  }

  public withRelativeTrendArtifactPath(artifact: ModelTrendArtifact, relativeDirectoryPath: string): ModelTrendArtifact {
    const trendArtifact: ModelTrendArtifact = {
      ...artifact,
      model: {
        ...artifact.model,
        modelPath: relativeDirectoryPath,
      },
    };
    return trendArtifact;
  }

  public withRelativeClobArtifactPath(artifact: ModelClobArtifact, relativeDirectoryPath: string): ModelClobArtifact {
    const clobArtifact: ModelClobArtifact = {
      ...artifact,
      model: {
        ...artifact.model,
        modelPath: relativeDirectoryPath,
      },
    };
    return clobArtifact;
  }

  public async loadManifest(): Promise<ModelPersistenceSnapshot | null> {
    const manifestPath = this.buildManifestPath();
    let manifestSnapshot: ModelPersistenceSnapshot | null = null;

    if (existsSync(manifestPath)) {
      logger.info(`model manifest restore started path=${manifestPath}`);
      const serializedSnapshot = await readFile(manifestPath, "utf8");
      const parsedSnapshot = JSON.parse(serializedSnapshot) as Record<string, unknown>;

      if (typeof parsedSnapshot.schemaVersion === "number" && parsedSnapshot.schemaVersion === MANIFEST_SCHEMA_VERSION) {
        manifestSnapshot = parsedSnapshot as ModelPersistenceSnapshot;
        logger.info(
          `model manifest restore completed path=${manifestPath} trendModels=${manifestSnapshot.trendModels.length} clobModels=${manifestSnapshot.clobModels.length}`,
        );
      } else {
        logger.warn(`ignoring unsupported manifest schema at ${manifestPath}; expected ${MANIFEST_SCHEMA_VERSION}`);
      }
    } else {
      logger.info(`model manifest not found at ${manifestPath}, starting with empty persisted state`);
    }

    return manifestSnapshot;
  }

  public async persistManifest(
    trendModels: ModelPersistenceTrendModel[],
    clobModels: ModelPersistenceClobModel[],
    lastTrainingCycleAt: string | null,
    lastTrainedSnapshotAt: string | null,
  ): Promise<void> {
    const manifestSnapshot: ModelPersistenceSnapshot = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      lastTrainingCycleAt,
      lastTrainedSnapshotAt,
      trendModels,
      clobModels,
    };
    const temporaryManifestPath = path.join(this.temporaryDirectoryPath, "manifest.tmp.json");

    await this.ensureBaseDirectories();
    await this.writeJsonFile(temporaryManifestPath, manifestSnapshot);
    await rename(temporaryManifestPath, this.buildManifestPath());
  }
}
