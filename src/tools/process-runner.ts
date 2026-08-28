import { execFile } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
const PROCESS_TIMEOUT_MS = 15_000;

interface CommandSpec {
  command: string;
  args: string[];
}

export interface ProcessResult {
  ok: boolean;
  exitCode?: string | number;
  stdout: string;
  stderr: string;
}

export async function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      env: createSafeEnvironment(),
      maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
      timeout: PROCESS_TIMEOUT_MS,
    });

    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error: unknown) {
    const executionError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };

    return {
      ok: false,
      exitCode: executionError.code,
      stdout: executionError.stdout ?? "",
      stderr: executionError.stderr ?? executionError.message,
    };
  }
}

export function getScriptCommand(
  scriptPath: string,
  args: string[],
): CommandSpec {
  switch (extname(scriptPath).toLowerCase()) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return { command: process.execPath, args: [scriptPath, ...args] };
    case ".ts":
    case ".mts":
    case ".cts":
      return {
        command: process.execPath,
        args: ["--import", "tsx", scriptPath, ...args],
      };
    case ".py":
      return { command: "python3", args: [scriptPath, ...args] };
    case ".sh":
      return { command: "sh", args: [scriptPath, ...args] };
    default:
      throw new Error("Unsupported script extension.");
  }
}

function createSafeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE)/i.test(name),
    ),
  );
}
