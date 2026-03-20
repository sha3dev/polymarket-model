/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
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
  maxAttempts: number;
  retryBaseDelayMs: number;
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

  private readonly maxAttempts: number;

  private readonly requestTimeoutMs: number;

  private readonly retryBaseDelayMs: number;

  /**
   * @section constructor
   */

  public constructor(options: TensorflowApiClientServiceOptions) {
    this.authToken = options.authToken;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetcher;
    this.maxAttempts = options.maxAttempts;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.retryBaseDelayMs = options.retryBaseDelayMs;
  }

  /**
   * @section factory
   */

  public static createDefault(): TensorflowApiClientService {
    return new TensorflowApiClientService({
      authToken: config.TENSORFLOW_API_AUTH_TOKEN,
      baseUrl: config.TENSORFLOW_API_URL,
      fetcher: fetch,
      maxAttempts: config.TENSORFLOW_API_MAX_ATTEMPTS,
      requestTimeoutMs: config.TENSORFLOW_API_REQUEST_TIMEOUT_MS,
      retryBaseDelayMs: config.TENSORFLOW_API_RETRY_BASE_DELAY_MS,
    });
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

  private buildRetryDelay(attempt: number): number {
    const retryDelay = this.retryBaseDelayMs * 2 ** Math.max(attempt - 1, 0) + Math.floor(Math.random() * 100);
    return retryDelay;
  }

  private isRetryableError(status: number | null, error: unknown): boolean {
    const errorMessage = error instanceof Error ? error.message : "";
    const isRetryableStatus = status === 429 || (status !== null && status >= 500);
    const isRetryableNetworkError =
      status === null && (errorMessage.includes("AbortError") || errorMessage.includes("fetch") || errorMessage.includes("network"));
    const isRetryableError = isRetryableStatus || isRetryableNetworkError;
    return isRetryableError;
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private async requestJson<TResponse>(pathname: string, method: "GET" | "PATCH" | "POST", payload?: unknown): Promise<TResponse> {
    let responsePayload: TResponse | null = null;
    let isFinished = false;
    let lastError: Error | null = null;
    let lastStatus: number | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, this.requestTimeoutMs);
      const requestInit: RequestInit = {
        headers: this.buildHeaders(),
        method,
        signal: abortController.signal,
      };

      if (payload !== undefined) {
        requestInit.body = JSON.stringify(payload);
      }

      try {
        const response = await this.fetcher(`${this.baseUrl}${pathname}`, requestInit);
        lastStatus = response.status;

        if (!response.ok) {
          throw new Error(`tensorflow-api request failed path=${pathname} status=${response.status} body=${await response.text()}`);
        }

        responsePayload = (await response.json()) as TResponse;
        isFinished = true;
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(`tensorflow-api request failed path=${pathname}`);
        const canRetry = this.isRetryableError(lastStatus, normalizedError) && attempt < this.maxAttempts;
        lastError = normalizedError;
        logger.warn(
          `tensorflow-api request issue method=${method} path=${pathname} attempt=${attempt} maxAttempts=${this.maxAttempts} status=${lastStatus === null ? "network" : lastStatus} error=${normalizedError.message}`,
        );

        if (canRetry) {
          await this.sleep(this.buildRetryDelay(attempt));
        } else {
          isFinished = true;
        }
      } finally {
        clearTimeout(timeoutId);
      }

      if (isFinished) {
        break;
      }
    }

    if (responsePayload === null) {
      throw new Error(
        `tensorflow-api request exhausted method=${method} path=${pathname} attempts=${this.maxAttempts} status=${lastStatus === null ? "network" : lastStatus} error=${lastError?.message || "unknown error"}`,
      );
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
