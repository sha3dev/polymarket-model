/**
 * @section imports:internals
 */

import config from "../config.ts";
import type {
  TensorflowApiCreateModelRequest,
  TensorflowApiJobRecord,
  TensorflowApiModelRecord,
  TensorflowApiPredictionJobRequest,
  TensorflowApiPredictionResponse,
  TensorflowApiTrainingJobRequest,
  TensorflowApiTrainingJobResult,
  TensorflowApiUpdateModelMetadataRequest,
} from "./tensorflow-api.types.ts";

/**
 * @section types
 */

type TensorflowApiClientServiceOptions = {
  authToken: string;
  baseUrl: string;
  fetcher: typeof fetch;
  requestTimeoutMs: number;
};

/**
 * @section class
 */

export class TensorflowApiClientService {
  /**
   * @section private:attributes
   */

  private readonly authToken: string;

  private readonly baseUrl: string;

  private readonly fetcher: typeof fetch;

  private readonly requestTimeoutMs: number;

  /**
   * @section constructor
   */

  public constructor(options: TensorflowApiClientServiceOptions) {
    this.authToken = options.authToken;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetcher;
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  /**
   * @section factory
   */

  public static createDefault(): TensorflowApiClientService {
    const tensorflowApiClientService = new TensorflowApiClientService({
      authToken: config.TENSORFLOW_API_AUTH_TOKEN,
      baseUrl: config.TENSORFLOW_API_URL,
      fetcher: fetch,
      requestTimeoutMs: config.TENSORFLOW_API_REQUEST_TIMEOUT_MS,
    });
    return tensorflowApiClientService;
  }

  /**
   * @section private:methods
   */

  private buildHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.authToken.length > 0) {
      headers.authorization = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  private async requestJson<TResponse>(pathname: string, method: "GET" | "PATCH" | "POST", payload?: unknown): Promise<TResponse> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, this.requestTimeoutMs);
    const requestInit: RequestInit = {
      headers: this.buildHeaders(),
      method,
      signal: abortController.signal,
    };
    let responsePayload: TResponse;

    if (payload !== undefined) {
      requestInit.body = JSON.stringify(payload);
    }

    try {
      const response = await this.fetcher(`${this.baseUrl}${pathname}`, requestInit);

      if (!response.ok) {
        throw new Error(`tensorflow-api request failed path=${pathname} status=${response.status} body=${await response.text()}`);
      }

      responsePayload = (await response.json()) as TResponse;
    } finally {
      clearTimeout(timeoutId);
    }

    return responsePayload;
  }

  /**
   * @section public:methods
   */

  public async ensureReachable(): Promise<void> {
    await this.requestJson<Record<string, unknown>>("/", "GET");
  }

  public async readModels(): Promise<TensorflowApiModelRecord[]> {
    const modelRecords = await this.requestJson<TensorflowApiModelRecord[]>("/api/models", "GET");
    return modelRecords;
  }

  public async readModel(modelId: string): Promise<TensorflowApiModelRecord> {
    const modelRecord = await this.requestJson<TensorflowApiModelRecord>(`/api/models/${encodeURIComponent(modelId)}`, "GET");
    return modelRecord;
  }

  public async createModel(request: TensorflowApiCreateModelRequest): Promise<TensorflowApiModelRecord> {
    const modelRecord = await this.requestJson<TensorflowApiModelRecord>("/api/models", "POST", request);
    return modelRecord;
  }

  public async updateModelMetadata(modelId: string, request: TensorflowApiUpdateModelMetadataRequest): Promise<TensorflowApiModelRecord> {
    const modelRecord = await this.requestJson<TensorflowApiModelRecord>(`/api/models/${encodeURIComponent(modelId)}/metadata`, "PATCH", request);
    return modelRecord;
  }

  public async queueTrainingJob(modelId: string, request: TensorflowApiTrainingJobRequest): Promise<TensorflowApiJobRecord> {
    const jobRecord = await this.requestJson<TensorflowApiJobRecord>(`/api/models/${encodeURIComponent(modelId)}/training-jobs`, "POST", request);
    return jobRecord;
  }

  public async readJob(jobId: string): Promise<TensorflowApiJobRecord> {
    const jobRecord = await this.requestJson<TensorflowApiJobRecord>(`/api/jobs/${encodeURIComponent(jobId)}`, "GET");
    return jobRecord;
  }

  public async readJobResult(jobId: string): Promise<TensorflowApiTrainingJobResult> {
    const jobResult = await this.requestJson<TensorflowApiTrainingJobResult>(`/api/jobs/${encodeURIComponent(jobId)}/result`, "GET");
    return jobResult;
  }

  public async predict(modelId: string, request: TensorflowApiPredictionJobRequest): Promise<TensorflowApiPredictionResponse> {
    const predictionResponse = await this.requestJson<TensorflowApiPredictionResponse>(
      `/api/models/${encodeURIComponent(modelId)}/prediction-jobs`,
      "POST",
      request,
    );
    return predictionResponse;
  }
}
