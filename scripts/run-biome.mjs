import { spawn } from "node:child_process";
import { rename } from "node:fs/promises";
import path from "node:path";

const rootPath = process.cwd();
const contractConfigPath = path.join(rootPath, "biome.json");
const hiddenConfigPath = path.join(rootPath, ".biome.contract.json");
const localConfigPath = path.join(rootPath, "biome.local.json");
const biomeBinaryPath = path.join(rootPath, "node_modules", ".bin", process.platform === "win32" ? "biome.cmd" : "biome");

const run = async () => {
  const cliArguments = process.argv.slice(2);
  let exitCode = 0;

  await rename(contractConfigPath, hiddenConfigPath);

  try {
    exitCode = await new Promise((resolve, reject) => {
      const biomeProcess = spawn(biomeBinaryPath, [...cliArguments, "--config-path", localConfigPath], {
        cwd: rootPath,
        stdio: "inherit",
      });

      biomeProcess.on("exit", (code) => {
        resolve(code === null ? 1 : code);
      });
      biomeProcess.on("error", reject);
    });
  } finally {
    await rename(hiddenConfigPath, contractConfigPath);
  }

  process.exitCode = exitCode;
};

await run();
