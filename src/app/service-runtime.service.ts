/**
 * @section imports:externals
 */

import type { AddressInfo } from "node:net";
import type { ServerType } from "@hono/node-server";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import { HttpServerService } from "../http/http-server.service.ts";
import logger from "../logger.ts";

/**
 * @section class
 */

export class ServiceRuntime {
  /**
   * @section private:attributes
   */

  private readonly httpServerService: HttpServerService;

  private server: ServerType | null;

  /**
   * @section constructor
   */

  public constructor(httpServerService: HttpServerService) {
    this.httpServerService = httpServerService;
    this.server = null;
  }

  /**
   * @section factory
   */

  public static createDefault(): ServiceRuntime {
    return new ServiceRuntime(HttpServerService.createDefault());
  }

  /**
   * @section public:methods
   */

  public buildServer(): ServerType {
    return this.httpServerService.buildServer();
  }

  public async start(): Promise<void> {
    await this.httpServerService.getModelRuntimeService().start();
  }

  public async stop(): Promise<void> {
    const server = this.server;

    if (server !== null) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      this.server = null;
    }

    await this.httpServerService.getModelRuntimeService().stop();
  }

  public async startServer(): Promise<ServerType> {
    await this.start();
    const server = this.buildServer();
    await new Promise<void>((resolve) => {
      server.listen(config.DEFAULT_PORT, () => {
        const address = server.address() as AddressInfo | null;
        const port = address === null ? config.DEFAULT_PORT : address.port;
        logger.info(`service listening on http://localhost:${port}`);
        resolve();
      });
    });
    this.server = server;
    return server;
  }
}
