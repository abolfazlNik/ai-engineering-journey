import assert from "node:assert/strict";
import test from "node:test";

import type OpenAI from "openai";

import { Agent, type AgentResponsesClient } from "../src/ai/agent.js";
import type { AiConfig } from "../src/ai/config.js";
import { AGENT_INSTRUCTIONS } from "../src/ai/prompts.js";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/tools/definitions.js";

const config: AiConfig = {
  apiKey: "test-key",
  baseUrl: "https://openrouter.test/api/v1",
  model: "test-model",
  maxOutputTokens: 123,
};

test("respond sends a bounded Responses API request and returns its text", async () => {
  const requests: Array<
    Parameters<AgentResponsesClient["responses"]["create"]>[0]
  > = [];
  const responses = {
    create: async (
      parameters: Parameters<AgentResponsesClient["responses"]["create"]>[0],
    ) => {
      requests.push(parameters);
      return { output_text: "mock response", output: [] };
    },
  };

  const agent = new Agent({ responses }, config);
  const result = await agent.respond("  Hello  ");

  assert.equal(result, "mock response");
  assert.deepEqual(requests[0], {
    model: "test-model",
    instructions: AGENT_INSTRUCTIONS,
    input: [{ role: "user", content: "Hello" }],
    max_output_tokens: 123,
    tools: [{ type: "web_search_preview" }],
    tool_choice: "auto",
    parallel_tool_calls: false,
  });
});

test("respond rejects empty input before making a request", async () => {
  let called = false;
  const responses = {
    create: async () => {
      called = true;
      return { output_text: "unexpected", output: [] };
    },
  };

  const agent = new Agent({ responses }, config);

  await assert.rejects(agent.respond("  "), /cannot be empty/);
  assert.equal(called, false);
});

test("respond sends conversation history and can reset it", async () => {
  const answerRequests: Array<
    Parameters<AgentResponsesClient["responses"]["create"]>[0]
  > = [];
  let responseNumber = 0;
  const agent = new Agent(
    {
      responses: {
        create: async (parameters) => {
          answerRequests.push(parameters);
          responseNumber += 1;
          return {
            output_text: `answer-${responseNumber}`,
            output: [],
          };
        },
      },
    },
    config,
  );

  await agent.respond("first");
  await agent.respond("second");
  agent.resetConversation();
  await agent.respond("third");

  assert.deepEqual(answerRequests[0]?.input, [
    { role: "user", content: "first" },
  ]);
  assert.deepEqual(answerRequests[1]?.input, [
    { role: "user", content: "first" },
    { role: "assistant", content: "answer-1" },
    { role: "user", content: "second" },
  ]);
  assert.deepEqual(answerRequests[2]?.input, [
    { role: "user", content: "third" },
  ]);
});

test("respond reports web search before returning the answer", async () => {
  const tools: string[] = [];
  const agent = new Agent(
    {
      responses: {
        create: async () => ({
          output_text: "current answer",
          output: [
            {
              type: "web_search_call",
            } as OpenAI.Responses.ResponseFunctionWebSearch,
          ],
        }),
      },
    },
    config,
  );

  const result = await agent.respond("What happened today?", {
    onToolUse: (tool) => tools.push(tool),
  });

  assert.deepEqual(tools, ["web_search"]);
  assert.equal(result, "current answer");
});

test("respond executes a function call and returns its output to the model", async () => {
  const requests: Array<
    Parameters<AgentResponsesClient["responses"]["create"]>[0]
  > = [];
  const usedTools: string[] = [];
  const executions: Array<{ name: string; argumentsJson: string }> = [];
  const functionCall: OpenAI.Responses.ResponseFunctionToolCall = {
    type: "function_call",
    call_id: "call-1",
    name: "read_file",
    arguments: '{"path":"notes.txt"}',
  };
  let responseNumber = 0;
  const agent = new Agent(
    {
      responses: {
        create: async (parameters) => {
          requests.push(parameters);
          responseNumber += 1;
          return responseNumber === 1
            ? { output_text: "", output: [functionCall] }
            : { output_text: "file contents", output: [] };
        },
      },
    },
    config,
    {
      definitions: [WORKSPACE_TOOL_DEFINITIONS[0]!],
      execute: async (name, argumentsJson) => {
        executions.push({ name, argumentsJson });
        return '{"ok":true,"content":"hello"}';
      },
    },
  );

  const result = await agent.respond("Read notes.txt", {
    onToolUse: (tool) => usedTools.push(tool),
  });

  assert.equal(result, "file contents");
  assert.deepEqual(usedTools, ["read_file"]);
  assert.deepEqual(executions, [
    { name: "read_file", argumentsJson: '{"path":"notes.txt"}' },
  ]);
  assert.deepEqual(requests[1]?.input, [
    { role: "user", content: "Read notes.txt" },
    functionCall,
    {
      type: "function_call_output",
      call_id: "call-1",
      output: '{"ok":true,"content":"hello"}',
    },
  ]);
});

test("respond feeds unexpected tool errors back to the model", async () => {
  const requests: Array<
    Parameters<AgentResponsesClient["responses"]["create"]>[0]
  > = [];
  const functionCall: OpenAI.Responses.ResponseFunctionToolCall = {
    type: "function_call",
    call_id: "call-error",
    name: "read_file",
    arguments: '{"path":"missing.txt"}',
  };
  let responseNumber = 0;
  const agent = new Agent(
    {
      responses: {
        create: async (parameters) => {
          requests.push(parameters);
          responseNumber += 1;
          return responseNumber === 1
            ? { output_text: "", output: [functionCall] }
            : { output_text: "The tool failed, so I did not read the file.", output: [] };
        },
      },
    },
    config,
    {
      definitions: [WORKSPACE_TOOL_DEFINITIONS[0]!],
      execute: async () => {
        throw new Error("disk unavailable");
      },
    },
  );

  const result = await agent.respond("Read missing.txt");

  assert.equal(result, "The tool failed, so I did not read the file.");
  assert.match(JSON.stringify(requests[1]?.input.at(-1)), /disk unavailable/);
});
