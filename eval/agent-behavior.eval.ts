import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type OpenAI from "openai";

import { Agent, type AgentResponsesClient } from "../src/ai/agent.js";
import type { AiConfig } from "../src/ai/config.js";
import { createWorkspaceTools } from "../src/tools/workspace-tools.js";

type AgentResponse = Pick<OpenAI.Responses.Response, "output" | "output_text">;
type AgentRequest = Parameters<AgentResponsesClient["responses"]["create"]>[0];

const config: AiConfig = {
  apiKey: "eval-key",
  baseUrl: "https://eval.invalid/api/v1",
  model: "eval-model",
  maxOutputTokens: 200,
};

function functionCall(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): OpenAI.Responses.ResponseFunctionToolCall {
  return {
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}

function createScriptedClient(script: AgentResponse[]): {
  client: AgentResponsesClient;
  requests: AgentRequest[];
} {
  const requests: AgentRequest[] = [];
  let responseIndex = 0;

  return {
    requests,
    client: {
      responses: {
        create: async (request) => {
          requests.push(request);
          const response = script[responseIndex];
          responseIndex += 1;

          if (!response) {
            throw new Error("Eval response script was exhausted.");
          }

          return response;
        },
      },
    },
  };
}

test("eval: general answers do not execute workspace tools", async () => {
  const scripted = createScriptedClient([
    { output_text: "Paris", output: [] },
  ]);
  let executions = 0;
  const agent = new Agent(scripted.client, config, {
    definitions: [],
    execute: async () => {
      executions += 1;
      return "unexpected";
    },
  });

  const result = await agent.respond("What is the capital of France?");

  assert.equal(result, "Paris");
  assert.equal(executions, 0);
  assert.equal(scripted.requests.length, 1);
});

test("eval: denied write produces no filesystem side effect", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-eval-write-deny-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const approvals: string[] = [];
  const toolset = createWorkspaceTools({
    rootDir,
    confirm: async ({ action }) => {
      approvals.push(action);
      return false;
    },
  });
  const scripted = createScriptedClient([
    {
      output_text: "",
      output: [
        functionCall("write-1", "write_file", {
          path: "generated.txt",
          content: "must not exist",
        }),
      ],
    },
    { output_text: "The write was denied.", output: [] },
  ]);
  const agent = new Agent(scripted.client, config, toolset);

  const result = await agent.respond("Create generated.txt");

  assert.equal(result, "The write was denied.");
  assert.deepEqual(approvals, ["write_file"]);
  await assert.rejects(stat(join(rootDir, "generated.txt")), /ENOENT/);
  const toolOutput = scripted.requests[1]?.input.at(-1);
  assert.equal(toolOutput?.type, "function_call_output");
  assert.match(JSON.stringify(toolOutput), /Action denied by user/);
});

test("eval: approved script workflow creates, runs, and reports evidence", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-eval-script-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const approvals: string[] = [];
  const toolset = createWorkspaceTools({
    rootDir,
    confirm: async ({ action }) => {
      approvals.push(action);
      return true;
    },
  });
  const scripted = createScriptedClient([
    {
      output_text: "",
      output: [
        functionCall("write-1", "write_file", {
          path: "scripts/eval.js",
          content: 'console.log("EVAL_OK");\n',
        }),
      ],
    },
    {
      output_text: "",
      output: [
        functionCall("run-1", "run_script", {
          path: "scripts/eval.js",
          args: [],
        }),
      ],
    },
    { output_text: "Created and ran the script: EVAL_OK", output: [] },
  ]);
  const agent = new Agent(scripted.client, config, toolset);

  const result = await agent.respond("Create and run a script");

  assert.equal(result, "Created and ran the script: EVAL_OK");
  assert.deepEqual(approvals, ["write_file", "run_script"]);
  assert.equal(
    await readFile(join(rootDir, "scripts/eval.js"), "utf8"),
    'console.log("EVAL_OK");\n',
  );
  assert.match(JSON.stringify(scripted.requests[2]?.input.at(-1)), /EVAL_OK/);
});

test("eval: edit succeeds but denied deletion preserves the edited file", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-eval-edit-delete-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(join(rootDir, "existing.txt"), "before", "utf8");
  const approvals: string[] = [];
  const toolset = createWorkspaceTools({
    rootDir,
    confirm: async ({ action }) => {
      approvals.push(action);
      return action === "edit_file";
    },
  });
  const scripted = createScriptedClient([
    {
      output_text: "",
      output: [functionCall("read-1", "read_file", { path: "existing.txt" })],
    },
    {
      output_text: "",
      output: [
        functionCall("edit-1", "edit_file", {
          path: "existing.txt",
          old_text: "before",
          new_text: "after",
        }),
      ],
    },
    {
      output_text: "",
      output: [
        functionCall("delete-1", "delete_file", { path: "existing.txt" }),
      ],
    },
    { output_text: "Edited; deletion was denied.", output: [] },
  ]);
  const agent = new Agent(scripted.client, config, toolset);

  const result = await agent.respond("Edit then delete existing.txt");

  assert.equal(result, "Edited; deletion was denied.");
  assert.deepEqual(approvals, ["edit_file", "delete_file"]);
  assert.equal(await readFile(join(rootDir, "existing.txt"), "utf8"), "after");
});

test("eval: denied command cannot create its marker file", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-eval-command-deny-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const markerPath = join(rootDir, "command-ran.txt");
  const toolset = createWorkspaceTools({
    rootDir,
    confirm: async () => false,
  });
  const scripted = createScriptedClient([
    {
      output_text: "",
      output: [
        functionCall("command-1", "run_command", {
          command: process.execPath,
          args: [
            "-e",
            `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`,
          ],
        }),
      ],
    },
    { output_text: "The command was denied.", output: [] },
  ]);
  const agent = new Agent(scripted.client, config, toolset);

  const result = await agent.respond("Run a command");

  assert.equal(result, "The command was denied.");
  await assert.rejects(stat(markerPath), /ENOENT/);
});
