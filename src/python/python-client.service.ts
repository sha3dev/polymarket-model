/**
 * @section imports:internals
 */

import config from "../config.ts";
import type { ModelClobArtifact, ModelClobInput, ModelHeadArtifact, ModelTrendArtifact, ModelTrendInput } from "../model/model.types.ts";
import type { ModelClobPythonTrainResult, ModelPythonPredictionResult, ModelTrendPythonTrainResult } from "../model/model-runtime.types.ts";
import type {
  PythonClobLoadRequest,
  PythonClobTrainRequest,
  PythonPredictResponse,
  PythonRuntimeHandle,
  PythonTrendLoadRequest,
  PythonTrendTrainRequest,
} from "./python.types.ts";
import { PythonRuntimeService } from "./python-runtime.service.ts";

/**
 * @section types
 */

type PythonClientServiceOptions = {
  fetcher: typeof fetch;
  pythonRuntimeService: PythonRuntimeService;
  stateDirectoryPath: string;
};

/**
 * @section class
 */

export class PythonClientService {
  /**
   * @section private:attributes
   */

  private readonly fetcher: typeof fetch;

  private readonly pythonRuntimeService: PythonRuntimeService;

  private readonly stateDirectoryPath: string;

  /**
   * @section constructor
   */

  public constructor(options: PythonClientServiceOptions) {
    this.fetcher = options.fetcher;
    this.pythonRuntimeService = options.pythonRuntimeService;
    this.stateDirectoryPath = options.stateDirectoryPath;
  }

  /**
   * @section factory
   */

  public static createDefault(): PythonClientService {
    const pythonClientService = new PythonClientService({
      fetcher: fetch,
      pythonRuntimeService: PythonRuntimeService.createDefault(),
      stateDirectoryPath: config.MODEL_STATE_DIR,
    });
    return pythonClientService;
  }

  /**
   * @section private:methods
   */

  private async readRuntimeHandle(): Promise<PythonRuntimeHandle> {
    const runtimeHandle = await this.pythonRuntimeService.ensureStarted();
    return runtimeHandle;
  }

  private async postJson<TPayload, TResponse>(pathname: string, payload: TPayload): Promise<TResponse> {
    const runtimeHandle = await this.readRuntimeHandle();
    const response = await this.fetcher(`${runtimeHandle.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-model-auth-token": runtimeHandle.authToken,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`python runtime request failed path=${pathname} status=${response.status} body=${await response.text()}`);
    }

    const responsePayload = (await response.json()) as TResponse;
    return responsePayload;
  }

  /**
   * @section public:methods
   */

  public async ensureStarted(): Promise<void> {
    await this.pythonRuntimeService.ensureStarted();
  }

  public async stop(): Promise<void> {
    await this.pythonRuntimeService.stop();
  }

  public async trainTrend(request: PythonTrendTrainRequest): Promise<ModelTrendPythonTrainResult> {
    const trainResult = await this.postJson<PythonTrendTrainRequest, ModelTrendPythonTrainResult>("/models/trend/train", request);
    return trainResult;
  }

  public async trainClob(request: PythonClobTrainRequest): Promise<ModelClobPythonTrainResult> {
    const trainResult = await this.postJson<PythonClobTrainRequest, ModelClobPythonTrainResult>("/models/clob/train", request);
    return trainResult;
  }

  public async loadTrend(artifact: ModelTrendArtifact): Promise<void> {
    const payload: PythonTrendLoadRequest = {
      artifact,
      stateDirectoryPath: this.stateDirectoryPath,
    };
    await this.postJson<PythonTrendLoadRequest, { ok: boolean }>("/models/trend/load", payload);
  }

  public async loadClob(artifact: ModelClobArtifact): Promise<void> {
    const payload: PythonClobLoadRequest = {
      artifact,
      stateDirectoryPath: this.stateDirectoryPath,
    };
    await this.postJson<PythonClobLoadRequest, { ok: boolean }>("/models/clob/load", payload);
  }

  public async unloadTrend(trendKey: string): Promise<void> {
    await this.postJson<{ trendKey: string }, { ok: boolean }>("/models/trend/unload", { trendKey });
  }

  public async unloadClob(modelKey: string): Promise<void> {
    await this.postJson<{ modelKey: string }, { ok: boolean }>("/models/clob/unload", { modelKey });
  }

  public async predictTrend(trendKey: string, artifact: ModelHeadArtifact, input: ModelTrendInput): Promise<ModelPythonPredictionResult> {
    const predictionResponse = await this.postJson<
      {
        artifact: ModelHeadArtifact;
        input: ModelTrendInput;
        stateDirectoryPath: string;
        trendKey: string;
      },
      PythonPredictResponse
    >("/models/trend/predict", {
      artifact,
      input,
      stateDirectoryPath: this.stateDirectoryPath,
      trendKey,
    });
    return predictionResponse;
  }

  public async predictClob(modelKey: string, artifact: ModelHeadArtifact, input: ModelClobInput): Promise<ModelPythonPredictionResult> {
    const predictionResponse = await this.postJson<
      {
        artifact: ModelHeadArtifact;
        input: ModelClobInput;
        modelKey: string;
        stateDirectoryPath: string;
      },
      PythonPredictResponse
    >("/models/clob/predict", {
      artifact,
      input,
      modelKey,
      stateDirectoryPath: this.stateDirectoryPath,
    });
    return predictionResponse;
  }
}
