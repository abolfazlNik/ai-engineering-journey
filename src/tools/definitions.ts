import type { FunctionToolDefinition } from "./types.js";

export const WORKSPACE_TOOL_DEFINITIONS: FunctionToolDefinition[] = [
  {
    type: "function",
    name: "read_file",
    description: "Read a UTF-8 text file inside the current workspace.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path of the file to read.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "write_file",
    description:
      "Create or overwrite a UTF-8 text file inside the workspace. Requires human approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path of the file to write.",
        },
        content: {
          type: "string",
          description: "Complete content to write to the file.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "edit_file",
    description:
      "Replace one exact text occurrence in an existing UTF-8 workspace file. Read the file first. Requires human approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path of the existing file.",
        },
        old_text: {
          type: "string",
          description: "Exact text to replace; it must occur exactly once.",
        },
        new_text: {
          type: "string",
          description: "Replacement text.",
        },
      },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "run_script",
    description:
      "Run a .js, .mjs, .cjs, .ts, .mts, .cts, .py, or .sh script inside the workspace and return stdout/stderr. Requires human approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path of the script to run.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Script arguments. Use an empty array when none are needed.",
        },
      },
      required: ["path", "args"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delete_file",
    description:
      "Delete one file inside the workspace. Directories are not supported. Requires human approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path of the file to delete.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "run_command",
    description:
      "Run one executable in the workspace with explicit arguments and return stdout/stderr. Shell operators, pipes, and redirection are not interpreted. Requires human approval.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Executable name or absolute executable path.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Command arguments. Use an empty array when none are needed.",
        },
      },
      required: ["command", "args"],
      additionalProperties: false,
    },
  },
];
