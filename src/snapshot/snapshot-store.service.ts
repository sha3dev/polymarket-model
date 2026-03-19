/**
 * @section imports:externals
 */

import type { Snapshot } from "@sha3/polymarket-snapshot";
import { SnapshotService } from "@sha3/polymarket-snapshot";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { FlatSnapshot } from "../model/model.types.ts";

/**
 * @section types
 */

type SnapshotStoreServiceOptions = {
  snapshotBufferLimit: number;
  snapshotService: {
    addSnapshotListener(options: { listener: (snapshot: Snapshot) => void }): void;
    removeSnapshotListener(listener: (snapshot: Snapshot) => void): void;
    getSnapshot(): Snapshot | null;
    disconnect(): Promise<void>;
  };
};

/**
 * @section class
 */

export class SnapshotStoreService {
  /**
   * @section private:attributes
   */

  private readonly snapshotBufferLimit: number;

  private readonly snapshotService: SnapshotStoreServiceOptions["snapshotService"];

  private readonly liveSnapshots: FlatSnapshot[];

  private readonly snapshotListener: (snapshot: Snapshot) => void;

  private isStarted: boolean;

  /**
   * @section constructor
   */

  public constructor(options: SnapshotStoreServiceOptions) {
    this.snapshotBufferLimit = options.snapshotBufferLimit;
    this.snapshotService = options.snapshotService;
    this.liveSnapshots = [];
    this.snapshotListener = (snapshot) => {
      this.pushSnapshot(snapshot);
    };
    this.isStarted = false;
  }

  /**
   * @section factory
   */

  public static createDefault(): SnapshotStoreService {
    return new SnapshotStoreService({
      snapshotBufferLimit: config.LIVE_SNAPSHOT_BUFFER_LIMIT,
      snapshotService: new SnapshotService(config.LIVE_SNAPSHOT_INTERVAL_MS),
    });
  }

  /**
   * @section private:methods
   */

  private pushSnapshot(snapshot: Snapshot): void {
    this.liveSnapshots.push(snapshot);

    if (this.liveSnapshots.length > this.snapshotBufferLimit) {
      this.liveSnapshots.splice(0, this.liveSnapshots.length - this.snapshotBufferLimit);
    }
  }

  /**
   * @section public:methods
   */

  public async start(): Promise<void> {
    const latestSnapshot = this.snapshotService.getSnapshot();

    if (!this.isStarted) {
      this.snapshotService.addSnapshotListener({ listener: this.snapshotListener });
      this.isStarted = true;
    }

    if (latestSnapshot !== null) {
      this.pushSnapshot(latestSnapshot);
    }
  }

  public async stop(): Promise<void> {
    if (this.isStarted) {
      this.snapshotService.removeSnapshotListener(this.snapshotListener);
      this.isStarted = false;
    }

    await this.snapshotService.disconnect();
    this.liveSnapshots.length = 0;
  }

  public getLiveSnapshots(): FlatSnapshot[] {
    const liveSnapshots = [...this.liveSnapshots];
    return liveSnapshots;
  }

  public getLatestSnapshotAt(): string | null {
    const latestSnapshot = this.liveSnapshots.at(-1) || null;
    const latestSnapshotAt = latestSnapshot === null ? null : new Date(latestSnapshot.generated_at).toISOString();
    return latestSnapshotAt;
  }
}
