import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { HttpServerService } from "../src/http/http-server.service.ts";
import { ServiceRuntime } from "../src/index.ts";
import type { ModelRuntimeService } from "../src/model/model-runtime.service.ts";

test("ServiceRuntime delegates lifecycle to the model runtime", async () => {
  let startedCount = 0;
  let stoppedCount = 0;
  const fakeModelRuntime = {
    async start(): Promise<void> {
      startedCount += 1;
    },
    async stop(): Promise<void> {
      stoppedCount += 1;
    },
  } as unknown as ModelRuntimeService;
  const fakeHttpServerService = {
    getModelRuntimeService(): ModelRuntimeService {
      return fakeModelRuntime;
    },
    buildServer() {
      throw new Error("buildServer is not expected in this test");
    },
  } as unknown as HttpServerService;
  const serviceRuntime = new ServiceRuntime(fakeHttpServerService);

  await serviceRuntime.start();
  await serviceRuntime.stop();

  assert.equal(startedCount, 1);
  assert.equal(stoppedCount, 1);
});
