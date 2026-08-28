import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import { WORKSPACE_TOOL_DEFINITIONS } from "./definitions.js";
import { getScriptCommand, runProcess } from "./process-runner.js";
import type {
  AgentToolset,
  ConfirmAction,
  WorkspaceToolName,
} from "./types.js";
import {
  WorkspacePaths,
  type ResolvedWorkspaceFile,
} from "./workspace-paths.js";

const MAX_FILE_BYTES = 256 * 1024;

interface WorkspaceToolsOptions {
  rootDir: string;
  confirm: ConfirmAction;
}

export class WorkspaceTools implements AgentToolset {
  public readonly definitions = WORKSPACE_TOOL_DEFINITIONS;
  private readonly paths: WorkspacePaths;

  public constructor(private readonly options: WorkspaceToolsOptions) {
    this.paths = new WorkspacePaths(options.rootDir);
  }

  public async execute(name: string, argumentsJson: string): Promise<string> {
    try {
      const toolName = this.parseToolName(name);
      const argumentsObject = this.parseArguments(argumentsJson);

      switch (toolName) {
        case "read_file":
          return JSON.stringify(
            await this.readFile(this.requireString(argumentsObject, "path")),
          );
        case "write_file":
          return JSON.stringify(
            await this.writeFile(
              this.requireString(argumentsObject, "path"),
              this.requireString(argumentsObject, "content"),
            ),
          );
        case "edit_file":
          return JSON.stringify(
            await this.editFile(
              this.requireString(argumentsObject, "path"),
              this.requireString(argumentsObject, "old_text"),
              this.requireString(argumentsObject, "new_text"),
            ),
          );
        case "delete_file":
          return JSON.stringify(
            await this.deleteFile(this.requireString(argumentsObject, "path")),
          );
        case "run_script":
          return JSON.stringify(
            await this.runScript(
              this.requireString(argumentsObject, "path"),
              this.requireStringArray(argumentsObject, "args"),
            ),
          );
        case "run_command":
          return JSON.stringify(
            await this.runCommand(
              this.requireString(argumentsObject, "command"),
              this.requireStringArray(argumentsObject, "args"),
            ),
          );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown tool error";
      return JSON.stringify({ ok: false, error: message });
    }
  }

  private async readFile(requestedPath: string): Promise<object> {
    const file = await this.paths.resolveExistingFile(requestedPath);
    this.assertNotSensitiveFile(file.relative);

    return {
      ok: true,
      path: file.relative,
      content: await this.readUtf8File(file),
    };
  }

  private async writeFile(
    requestedPath: string,
    content: string,
  ): Promise<object> {
    this.assertContentSize(content);
    const file = await this.paths.resolveWritableFile(requestedPath);
    const approved = await this.options.confirm({
      action: "write_file",
      description: `${file.exists ? "overwrite" : "create"} ${this.quoteForApproval(file.relative)} (${Buffer.byteLength(content, "utf8")} bytes)`,
    });

    if (!approved) {
      return { ok: false, error: "Action denied by user." };
    }

    await this.paths.createParentDirectory(file.absolute);
    await writeFile(file.absolute, content, "utf8");
    return {
      ok: true,
      path: file.relative,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  }

  private async editFile(
    requestedPath: string,
    oldText: string,
    newText: string,
  ): Promise<object> {
    if (!oldText) {
      throw new Error("old_text cannot be empty.");
    }

    const file = await this.paths.resolveExistingFile(requestedPath);
    const content = await this.readUtf8File(file);
    const occurrences = content.split(oldText).length - 1;

    if (occurrences !== 1) {
      throw new Error(
        `old_text must occur exactly once; found ${occurrences} occurrences.`,
      );
    }

    const updatedContent = content.replace(oldText, newText);
    this.assertContentSize(updatedContent);
    const approved = await this.options.confirm({
      action: "edit_file",
      description: `edit ${this.quoteForApproval(file.relative)} (replace ${this.previewForApproval(oldText)} with ${this.previewForApproval(newText)})`,
    });

    if (!approved) {
      return { ok: false, error: "Action denied by user." };
    }

    await writeFile(file.absolute, updatedContent, "utf8");
    return { ok: true, path: file.relative };
  }

  private async runScript(
    requestedPath: string,
    args: string[],
  ): Promise<object> {
    this.assertValidProcessArguments(args);

    const file = await this.paths.resolveExistingFile(requestedPath);
    const command = getScriptCommand(file.absolute, args);
    const approved = await this.options.confirm({
      action: "run_script",
      description: `run ${this.quoteForApproval(file.relative)} with args ${JSON.stringify(args)}`,
    });

    if (!approved) {
      return { ok: false, error: "Action denied by user." };
    }

    return {
      path: file.relative,
      ...(await runProcess(command.command, command.args, this.paths.rootDir)),
    };
  }

  private async deleteFile(requestedPath: string): Promise<object> {
    const file = await this.paths.resolveDeletableFile(requestedPath);
    const approved = await this.options.confirm({
      action: "delete_file",
      description: `delete ${this.quoteForApproval(file.relative)}`,
    });

    if (!approved) {
      return { ok: false, error: "Action denied by user." };
    }

    await unlink(file.absolute);
    return { ok: true, path: file.relative };
  }

  private async runCommand(command: string, args: string[]): Promise<object> {
    if (!command.trim() || command.includes("\0") || command.length > 1_000) {
      throw new Error("Command must be a non-empty executable name.");
    }
    this.assertValidProcessArguments(args);

    const approved = await this.options.confirm({
      action: "run_command",
      description: `run command ${this.quoteForApproval(command)} with args ${JSON.stringify(args)}`,
    });

    if (!approved) {
      return { ok: false, error: "Action denied by user." };
    }

    return {
      command,
      args,
      ...(await runProcess(command, args, this.paths.rootDir)),
    };
  }

  private async readUtf8File(file: ResolvedWorkspaceFile): Promise<string> {
    const fileStat = await stat(file.absolute);

    if (fileStat.size > MAX_FILE_BYTES) {
      throw new Error(`File is larger than ${MAX_FILE_BYTES} bytes.`);
    }

    return readFile(file.absolute, "utf8");
  }

  private assertContentSize(content: string): void {
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      throw new Error(`Content is larger than ${MAX_FILE_BYTES} bytes.`);
    }
  }

  private assertNotSensitiveFile(relativePath: string): void {
    const fileName = basename(relativePath);
    const isEnvironmentFile =
      fileName === ".env" ||
      (fileName.startsWith(".env.") && fileName !== ".env.example");

    if (
      isEnvironmentFile ||
      fileName === ".npmrc" ||
      fileName === ".netrc" ||
      fileName === ".pypirc"
    ) {
      throw new Error("Reading sensitive credential files is not allowed.");
    }
  }

  private assertValidProcessArguments(args: string[]): void {
    if (
      args.length > 20 ||
      args.some((argument) => argument.length > 1_000 || argument.includes("\0"))
    ) {
      throw new Error("Process arguments exceed the allowed limit.");
    }
  }

  private quoteForApproval(value: string): string {
    return JSON.stringify(value);
  }

  private previewForApproval(value: string): string {
    const preview = value.length > 80 ? `${value.slice(0, 77)}...` : value;
    return this.quoteForApproval(preview);
  }

  private parseToolName(name: string): WorkspaceToolName {
    if (
      name === "read_file" ||
      name === "write_file" ||
      name === "edit_file" ||
      name === "delete_file" ||
      name === "run_script" ||
      name === "run_command"
    ) {
      return name;
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  private parseArguments(argumentsJson: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object.");
    }

    return parsed as Record<string, unknown>;
  }

  private requireString(
    object: Record<string, unknown>,
    property: string,
  ): string {
    const value = object[property];

    if (typeof value !== "string") {
      throw new Error(`${property} must be a string.`);
    }

    return value;
  }

  private requireStringArray(
    object: Record<string, unknown>,
    property: string,
  ): string[] {
    const value = object[property];

    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new Error(`${property} must be an array of strings.`);
    }

    return value;
  }

}

export function createWorkspaceTools(options: WorkspaceToolsOptions): WorkspaceTools {
  return new WorkspaceTools(options);
}
