/**
 * @section imports:externals
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import * as path from "node:path";

/**
 * @section imports:internals
 */

import config from "../config.ts";
import logger from "../logger.ts";
import type { PythonRuntimeHandle, PythonRuntimeStatus } from "./python.types.ts";
import { PythonTemplateService } from "./python-template.service.ts";

/**
 * @section consts
 */

const REQUIREMENTS_FILE_NAME = "requirements.txt";
const SERVICE_FILE_NAME = "main.py";

/**
 * @section types
 */

type PythonRuntimeServiceOptions = {
  fetcher: typeof fetch;
  pythonInstallStrategy: string;
  pythonServiceHost: string;
  pythonServiceStartTimeoutMs: number;
  pythonServiceStopTimeoutMs: number;
  pythonVersion: string;
  requirementsPath: string;
  runtimeMode: string;
  shouldAutoInstallPython: boolean;
  stateDirectoryPath: string;
  templateService: PythonTemplateService;
  venvDirectoryPath: string;
};

/**
 * @section class
 */

export class PythonRuntimeService {
  /**
   * @section private:attributes
   */

  private readonly fetcher: typeof fetch;

  private readonly pythonInstallStrategy: string;

  private readonly pythonServiceHost: string;

  private readonly pythonServiceStartTimeoutMs: number;

  private readonly pythonServiceStopTimeoutMs: number;

  private readonly pythonVersion: string;

  private readonly requirementsPath: string;

  private readonly runtimeMode: string;

  private readonly shouldAutoInstallPython: boolean;

  private readonly stateDirectoryPath: string;

  private readonly templateService: PythonTemplateService;

  private readonly venvDirectoryPath: string;

  private childProcess: ChildProcessWithoutNullStreams | null;

  private runtimeHandle: PythonRuntimeHandle | null;

  /**
   * @section constructor
   */

  public constructor(options: PythonRuntimeServiceOptions) {
    this.fetcher = options.fetcher;
    this.pythonInstallStrategy = options.pythonInstallStrategy;
    this.pythonServiceHost = options.pythonServiceHost;
    this.pythonServiceStartTimeoutMs = options.pythonServiceStartTimeoutMs;
    this.pythonServiceStopTimeoutMs = options.pythonServiceStopTimeoutMs;
    this.pythonVersion = options.pythonVersion;
    this.requirementsPath = options.requirementsPath;
    this.runtimeMode = options.runtimeMode;
    this.shouldAutoInstallPython = options.shouldAutoInstallPython;
    this.stateDirectoryPath = options.stateDirectoryPath;
    this.templateService = options.templateService;
    this.venvDirectoryPath = options.venvDirectoryPath;
    this.childProcess = null;
    this.runtimeHandle = null;
  }

  /**
   * @section factory
   */

  public static createDefault(): PythonRuntimeService {
    const pythonRuntimeService = new PythonRuntimeService({
      fetcher: fetch,
      pythonInstallStrategy: config.PYTHON_INSTALL_STRATEGY,
      pythonServiceHost: config.PYTHON_SERVICE_HOST,
      pythonServiceStartTimeoutMs: config.PYTHON_SERVICE_START_TIMEOUT_MS,
      pythonServiceStopTimeoutMs: config.PYTHON_SERVICE_STOP_TIMEOUT_MS,
      pythonVersion: config.PYTHON_VERSION,
      requirementsPath: config.PYTHON_REQUIREMENTS_PATH,
      runtimeMode: config.PYTHON_RUNTIME_MODE,
      shouldAutoInstallPython: config.PYTHON_AUTO_INSTALL,
      stateDirectoryPath: config.MODEL_STATE_DIR,
      templateService: PythonTemplateService.createDefault(),
      venvDirectoryPath: config.PYTHON_VENV_DIR,
    });
    return pythonRuntimeService;
  }

  /**
   * @section private:methods
   */

  private buildRuntimeDirectoryPath(): string {
    const runtimeDirectoryPath = path.join(this.stateDirectoryPath, "python-runtime");
    return runtimeDirectoryPath;
  }

  private buildMainScriptPath(): string {
    const mainScriptPath = path.join(this.buildRuntimeDirectoryPath(), SERVICE_FILE_NAME);
    return mainScriptPath;
  }

  private buildRequirementsFilePath(): string {
    const requirementsFilePath = this.requirementsPath.length > 0 ? this.requirementsPath : path.join(this.buildRuntimeDirectoryPath(), REQUIREMENTS_FILE_NAME);
    return requirementsFilePath;
  }

  private buildBootstrapStampPath(): string {
    const bootstrapStampPath = path.join(this.buildRuntimeDirectoryPath(), ".bootstrap-stamp");
    return bootstrapStampPath;
  }

  private buildVenvPythonPath(): string {
    const venvPythonPath = path.join(this.venvDirectoryPath, "bin", "python");
    return venvPythonPath;
  }

  private async runCommand(command: string, argumentsList: string[], description: string): Promise<void> {
    const childProcess = spawn(command, argumentsList, { stdio: "pipe" });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const exitCode = await new Promise<number>((resolve, reject) => {
      childProcess.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
      });
      childProcess.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
      });
      childProcess.once("error", reject);
      childProcess.once("close", (code) => {
        resolve(code === null ? 1 : code);
      });
    });

    if (exitCode !== 0) {
      throw new Error(`${description} failed exitCode=${exitCode} stdout=${stdoutBuffer.trim()} stderr=${stderrBuffer.trim()}`);
    }
  }

  private async hasCommand(command: string): Promise<boolean> {
    let hasCommand = false;

    try {
      await this.runCommand("sh", ["-lc", `command -v ${command}`], `command discovery for ${command}`);
      hasCommand = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "command discovery failed";
      logger.warn(`command discovery missed command=${command} error=${errorMessage}`);
    }

    return hasCommand;
  }

  private async discoverPythonCommand(): Promise<string | null> {
    const candidateCommands = ["python3", "python"];
    let pythonCommand: string | null = null;

    for (const candidateCommand of candidateCommands) {
      const hasCandidateCommand = await this.hasCommand(candidateCommand);

      if (hasCandidateCommand) {
        pythonCommand = candidateCommand;
        break;
      }
    }

    return pythonCommand;
  }

  private async installPython(): Promise<void> {
    const platform = process.platform;

    if (!this.shouldAutoInstallPython) {
      throw new Error("python3 was not found and PYTHON_AUTO_INSTALL is disabled");
    }

    if (this.pythonInstallStrategy !== "system-package-manager") {
      throw new Error(`unsupported PYTHON_INSTALL_STRATEGY ${this.pythonInstallStrategy}`);
    }

    if (platform === "darwin") {
      const hasHomebrew = await this.hasCommand("brew");

      if (!hasHomebrew) {
        throw new Error("python3 is missing and Homebrew is not installed; install Homebrew first or provide python3");
      }

      await this.runCommand("brew", ["install", `python@${this.pythonVersion}`], "python installation via Homebrew");
    }

    if (platform === "linux") {
      const packageManagerCommands: Array<{ argumentsList: string[]; command: string }> = [
        { command: "apt-get", argumentsList: ["install", "-y", "python3", "python3-venv"] },
        { command: "dnf", argumentsList: ["install", "-y", "python3"] },
        { command: "yum", argumentsList: ["install", "-y", "python3"] },
        { command: "apk", argumentsList: ["add", "python3", "py3-pip"] },
      ];
      let hasInstalledPython = false;

      for (const packageManagerCommand of packageManagerCommands) {
        const hasPackageManager = await this.hasCommand(packageManagerCommand.command);

        if (hasPackageManager) {
          await this.runCommand(packageManagerCommand.command, packageManagerCommand.argumentsList, "python installation via package manager");
          hasInstalledPython = true;
          break;
        }
      }

      if (!hasInstalledPython) {
        throw new Error("python3 is missing and no supported Linux package manager was found");
      }
    }

    if (platform !== "darwin" && platform !== "linux") {
      throw new Error(`unsupported platform for managed python runtime: ${platform}`);
    }
  }

  private async ensureBootstrapFiles(): Promise<void> {
    const runtimeDirectoryPath = this.buildRuntimeDirectoryPath();
    const requirementsFilePath = this.buildRequirementsFilePath();
    const mainScriptPath = this.buildMainScriptPath();
    const stampPath = this.buildBootstrapStampPath();
    const requirementsContent = this.templateService.buildRequirements();
    const mainScriptContent = this.templateService.buildMainScript();
    const bootstrapHash = createHash("sha256").update(`${requirementsContent}\n${mainScriptContent}`).digest("hex");
    let previousBootstrapHash = "";

    await mkdir(runtimeDirectoryPath, { recursive: true });

    if (existsSync(stampPath)) {
      previousBootstrapHash = await readFile(stampPath, "utf8");
    }

    if (previousBootstrapHash !== bootstrapHash) {
      await writeFile(mainScriptPath, mainScriptContent, "utf8");
      await writeFile(requirementsFilePath, requirementsContent, "utf8");
      await writeFile(stampPath, bootstrapHash, "utf8");
    }
  }

  private async ensureVirtualEnvironment(pythonCommand: string): Promise<void> {
    const venvPythonPath = this.buildVenvPythonPath();

    if (!existsSync(venvPythonPath)) {
      await mkdir(this.venvDirectoryPath, { recursive: true });
      await this.runCommand(pythonCommand, ["-m", "venv", this.venvDirectoryPath], "python virtual environment creation");
    }
  }

  private async installRequirements(): Promise<void> {
    const venvPythonPath = this.buildVenvPythonPath();
    const requirementsFilePath = this.buildRequirementsFilePath();
    await this.runCommand(venvPythonPath, ["-m", "pip", "install", "--upgrade", "pip"], "python pip upgrade");
    await this.runCommand(venvPythonPath, ["-m", "pip", "install", "-r", requirementsFilePath], "python dependency installation");
  }

  private async reservePort(): Promise<number> {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, this.pythonServiceHost, () => {
        const address = server.address();
        const selectedPort = address !== null && typeof address !== "string" ? address.port : 0;
        resolve(selectedPort);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    return port;
  }

  private async waitForHealth(baseUrl: string, authToken: string): Promise<void> {
    const startedAt = Date.now();
    let hasStarted = false;

    while (!hasStarted && Date.now() - startedAt < this.pythonServiceStartTimeoutMs) {
      try {
        const response = await this.fetcher(`${baseUrl}/health`, {
          headers: { "x-model-auth-token": authToken },
        });
        hasStarted = response.ok;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "health request failed";
        logger.warn(`python runtime health retry baseUrl=${baseUrl} error=${errorMessage}`);
      }

      if (!hasStarted) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 500);
        });
      }
    }

    if (!hasStarted) {
      throw new Error(`python runtime health check timed out after ${this.pythonServiceStartTimeoutMs}ms`);
    }
  }

  private async stopChildProcess(): Promise<void> {
    const childProcess = this.childProcess;

    if (childProcess !== null) {
      childProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (childProcess.exitCode === null) {
            childProcess.kill("SIGKILL");
          }
          resolve();
        }, this.pythonServiceStopTimeoutMs);
        childProcess.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.childProcess = null;
      this.runtimeHandle = null;
    }
  }

  /**
   * @section public:methods
   */

  public async ensureStarted(): Promise<PythonRuntimeHandle> {
    let runtimeHandle = this.runtimeHandle;

    if (runtimeHandle === null) {
      if (this.runtimeMode !== "managed") {
        throw new Error(`unsupported PYTHON_RUNTIME_MODE ${this.runtimeMode}`);
      }

      let pythonCommand = await this.discoverPythonCommand();

      if (pythonCommand === null) {
        await this.installPython();
        pythonCommand = await this.discoverPythonCommand();
      }

      if (pythonCommand === null) {
        throw new Error("python3 is still unavailable after managed installation attempt");
      }

      await this.ensureBootstrapFiles();
      await this.ensureVirtualEnvironment(pythonCommand);
      await this.installRequirements();
      const port = await this.reservePort();
      const authToken = randomUUID();
      const baseUrl = `http://${this.pythonServiceHost}:${port}`;
      const mainScriptPath = this.buildMainScriptPath();
      const venvPythonPath = this.buildVenvPythonPath();
      const childProcess = spawn(venvPythonPath, [mainScriptPath], {
        env: {
          ...process.env,
          POLYMARKET_MODEL_AUTH_TOKEN: authToken,
          POLYMARKET_MODEL_HOST: this.pythonServiceHost,
          POLYMARKET_MODEL_PORT: String(port),
        },
        stdio: "pipe",
      });

      childProcess.stdout.on("data", (chunk) => {
        logger.info(`python-runtime ${chunk.toString().trim()}`);
      });
      childProcess.stderr.on("data", (chunk) => {
        logger.warn(`python-runtime ${chunk.toString().trim()}`);
      });
      await this.waitForHealth(baseUrl, authToken);
      this.childProcess = childProcess;
      this.runtimeHandle = {
        authToken,
        baseUrl,
        processId: childProcess.pid || 0,
      };
      runtimeHandle = this.runtimeHandle;
    }

    if (runtimeHandle === null) {
      throw new Error("python runtime failed to start");
    }

    return runtimeHandle;
  }

  public async readStatus(): Promise<PythonRuntimeStatus> {
    const runtimeHandle = await this.ensureStarted();
    const response = await this.fetcher(`${runtimeHandle.baseUrl}/health`, {
      headers: { "x-model-auth-token": runtimeHandle.authToken },
    });

    if (!response.ok) {
      throw new Error(`python runtime health request failed status=${response.status}`);
    }

    const runtimeStatus = (await response.json()) as PythonRuntimeStatus;
    return runtimeStatus;
  }

  public async stop(): Promise<void> {
    await this.stopChildProcess();
  }
}
