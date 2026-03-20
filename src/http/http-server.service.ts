/**
 * @section imports:externals
 */

import type { ServerType } from "@hono/node-server";
import { createAdaptorServer } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * @section imports:internals
 */

import { AppInfoService } from "../app-info/app-info.service.ts";
import config from "../config.ts";
import { DashboardService } from "../dashboard/dashboard.service.ts";
import logger from "../logger.ts";
import type { ModelAsset, ModelPredictionRequest, ModelWindow } from "../model/model.types.ts";
import { ModelRuntimeService } from "../model/model-runtime.service.ts";

/**
 * @section types
 */

type HttpServerServiceOptions = {
  appInfoService: AppInfoService;
  dashboardService: DashboardService;
  modelRuntimeService: ModelRuntimeService;
};

type HttpStatus = ContentfulStatusCode;

/**
 * @section class
 */

export class HttpServerService {
  /**
   * @section private:attributes
   */

  private readonly appInfoService: AppInfoService;

  private readonly dashboardService: DashboardService;

  private readonly modelRuntimeService: ModelRuntimeService;

  /**
   * @section constructor
   */

  public constructor(options: HttpServerServiceOptions) {
    this.appInfoService = options.appInfoService;
    this.dashboardService = options.dashboardService;
    this.modelRuntimeService = options.modelRuntimeService;
  }

  /**
   * @section factory
   */

  public static createDefault(): HttpServerService {
    return new HttpServerService({
      appInfoService: AppInfoService.createDefault(),
      dashboardService: DashboardService.createDefault(),
      modelRuntimeService: ModelRuntimeService.createDefault(),
    });
  }

  /**
   * @section private:methods
   */

  private respondJson<TPayload>(payload: TPayload, context: Context, status: HttpStatus): Response {
    context.header("content-type", config.RESPONSE_CONTENT_TYPE);
    const response = context.json(payload, status);
    return response;
  }

  private respondHtml(html: string, context: Context, status: HttpStatus): Response {
    context.header("content-type", "text/html; charset=utf-8");
    const response = context.body(html, status);
    return response;
  }

  private isAsset(value: string): value is ModelAsset {
    const isAsset = (config.MODEL_SUPPORTED_ASSETS as string[]).includes(value);
    return isAsset;
  }

  private isWindow(value: string): value is ModelWindow {
    const isWindow = (config.MODEL_SUPPORTED_WINDOWS as string[]).includes(value);
    return isWindow;
  }

  private validateAssetWindow(asset: string, window: string): { asset: ModelAsset; window: ModelWindow } | null {
    const validatedAssetWindow = this.isAsset(asset) && this.isWindow(window) ? { asset, window } : null;
    return validatedAssetWindow;
  }

  private parsePredictionRequest(rawPayload: unknown): ModelPredictionRequest | null {
    let predictionRequest: ModelPredictionRequest | null = null;

    if (rawPayload !== null && typeof rawPayload === "object") {
      const rawRecord = rawPayload as Record<string, unknown>;
      const rawAsset = typeof rawRecord.asset === "string" ? rawRecord.asset : "";
      const rawWindow = typeof rawRecord.window === "string" ? rawRecord.window : "";
      const validatedAssetWindow = this.validateAssetWindow(rawAsset, rawWindow);

      if (validatedAssetWindow !== null) {
        predictionRequest = validatedAssetWindow;
      }
    }

    return predictionRequest;
  }

  private handleRootRequest(context: Context): Response {
    return this.respondJson(this.appInfoService.buildPayload(), context, 200);
  }

  private handleModelsRequest(context: Context): Response {
    return this.respondJson(this.modelRuntimeService.getStatusPayload(), context, 200);
  }

  private handleDashboardRequest(context: Context): Response {
    return this.respondHtml(this.dashboardService.buildHtml(), context, 200);
  }

  private handleModelRequest(context: Context): Response {
    const asset = context.req.param("asset") || "";
    const window = context.req.param("window") || "";
    const validatedAssetWindow = this.validateAssetWindow(asset, window);
    const response =
      validatedAssetWindow === null
        ? this.respondJson({ error: "invalid model key" }, context, 400)
        : this.respondJson(this.modelRuntimeService.getModelStatus(validatedAssetWindow.asset, validatedAssetWindow.window), context, 200);
    return response;
  }

  private async handlePredictRequest(context: Context): Promise<Response> {
    const rawPayload = await context.req.json();
    const predictionRequest = this.parsePredictionRequest(rawPayload);
    let response: Response;

    if (predictionRequest === null) {
      response = this.respondJson({ error: "invalid prediction request" }, context, 400);
    } else {
      try {
        response = this.respondJson(await this.modelRuntimeService.predict(predictionRequest), context, 200);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "prediction failed";
        logger.error(errorMessage);
        response = this.respondJson({ error: errorMessage }, context, 409);
      }
    }

    return response;
  }

  /**
   * @section public:methods
   */

  public getModelRuntimeService(): ModelRuntimeService {
    return this.modelRuntimeService;
  }

  public buildServer(): ServerType {
    const app = new Hono();
    app.get("/", (context) => this.handleRootRequest(context));
    app.get("/dashboard", (context) => this.handleDashboardRequest(context));
    app.get("/models", (context) => this.handleModelsRequest(context));
    app.get("/models/:asset/:window", (context) => this.handleModelRequest(context));
    app.post("/predict", async (context) => this.handlePredictRequest(context));
    const server = createAdaptorServer({ fetch: app.fetch });
    return server;
  }
}
