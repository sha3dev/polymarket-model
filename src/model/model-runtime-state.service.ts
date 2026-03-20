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
import type { ModelRuntimeStateSnapshot } from "./model.types.ts";

/**
 * @section consts
 */

const RUNTIME_STATE_SCHEMA_VERSION = 1;

/**
 * @section types
 */

type ModelRuntimeStateServiceOptions = {
  stateDirectoryPath: string;
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

  private readonly temporaryDirectoryPath: string;

  /**
   * @section constructor
   */

  public constructor(options: ModelRuntimeStateServiceOptions) {
    this.stateDirectoryPath = options.stateDirectoryPath;
    this.temporaryDirectoryPath = options.temporaryDirectoryPath;
  }

  /**
   * @section factory
   */

  public static createDefault(): ModelRuntimeStateService {
    const temporaryDirectoryPath = config.MODEL_STATE_TMP_DIR.length === 0 ? path.join(config.MODEL_STATE_DIR, "tmp") : config.MODEL_STATE_TMP_DIR;
    const modelRuntimeStateService = new ModelRuntimeStateService({
      stateDirectoryPath: config.MODEL_STATE_DIR,
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

  private async ensureBaseDirectories(): Promise<void> {
    await mkdir(this.stateDirectoryPath, { recursive: true });
    await mkdir(this.temporaryDirectoryPath, { recursive: true });
  }

  private async writeJsonFile(filePath: string, payload: unknown): Promise<void> {
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private buildEmptyState(): ModelRuntimeStateSnapshot {
    const runtimeStateSnapshot: ModelRuntimeStateSnapshot = {
      lastTrainingCycleAt: null,
      lastTrainedSnapshotAt: null,
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    };
    return runtimeStateSnapshot;
  }

  private parseStateRecord(rawRecord: Record<string, unknown>): ModelRuntimeStateSnapshot | null {
    const schemaVersion = typeof rawRecord.schemaVersion === "number" ? rawRecord.schemaVersion : null;
    const lastTrainingCycleAt = typeof rawRecord.lastTrainingCycleAt === "string" ? rawRecord.lastTrainingCycleAt : null;
    const lastTrainedSnapshotAt = typeof rawRecord.lastTrainedSnapshotAt === "string" ? rawRecord.lastTrainedSnapshotAt : null;
    const runtimeStateSnapshot =
      schemaVersion === RUNTIME_STATE_SCHEMA_VERSION
        ? {
            lastTrainingCycleAt,
            lastTrainedSnapshotAt,
            schemaVersion,
          }
        : null;
    return runtimeStateSnapshot;
  }

  private parseLegacyManifest(rawRecord: Record<string, unknown>): ModelRuntimeStateSnapshot | null {
    const hasLegacyShape = Array.isArray(rawRecord.trendModels) && Array.isArray(rawRecord.clobModels);
    const runtimeStateSnapshot = hasLegacyShape
      ? {
          lastTrainingCycleAt: typeof rawRecord.lastTrainingCycleAt === "string" ? rawRecord.lastTrainingCycleAt : null,
          lastTrainedSnapshotAt: typeof rawRecord.lastTrainedSnapshotAt === "string" ? rawRecord.lastTrainedSnapshotAt : null,
          schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
        }
      : null;
    return runtimeStateSnapshot;
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
          logger.info(`restored runtime cursor from legacy manifest path=${this.buildLegacyManifestPath()}`);
          runtimeStateSnapshot = parsedLegacyState;
        }
      } else {
        logger.info(`runtime state not found at ${runtimeStatePath}, starting without persisted cursor`);
      }
    }

    return runtimeStateSnapshot;
  }

  public async persistState(lastTrainingCycleAt: string | null, lastTrainedSnapshotAt: string | null): Promise<void> {
    const runtimeStateSnapshot: ModelRuntimeStateSnapshot = {
      lastTrainingCycleAt,
      lastTrainedSnapshotAt,
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    };
    const temporaryRuntimeStatePath = path.join(this.temporaryDirectoryPath, "runtime-state.tmp.json");

    await this.ensureBaseDirectories();
    await this.writeJsonFile(temporaryRuntimeStatePath, runtimeStateSnapshot);
    await rename(temporaryRuntimeStatePath, this.buildRuntimeStatePath());
  }
}
