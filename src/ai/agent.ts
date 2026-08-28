import type OpenAI from "openai";

import type { AgentToolset, WorkspaceToolName } from "../tools/types.js";
import { createOpenAIClient } from "./client.js";
import { loadAiConfig, type AiConfig } from "./config.js";
import { AGENT_INSTRUCTIONS } from "./prompts.js";

const MAX_TOOL_ROUNDS = 8;

export type AgentToolName = "web_search" | WorkspaceToolName;

export interface AgentRespondOptions {
  onToolUse?: (tool: AgentToolName) => void;
}

export interface AgentResponsesClient {
  responses: {
    create(parameters: {
      model: string;
      instructions: string;
      input: OpenAI.Responses.ResponseInput;
      max_output_tokens: number;
      tools: OpenAI.Responses.Tool[];
      tool_choice: "auto";
      parallel_tool_calls: false;
    }): PromiseLike<
      Pick<OpenAI.Responses.Response, "output" | "output_text">
    >;
  };
}

export class Agent {
  private conversation: OpenAI.Responses.ResponseInput = [];

  public constructor(
    private readonly client: AgentResponsesClient,
    private readonly config: AiConfig,
    private readonly toolset?: AgentToolset,
  ) {}

  public async respond(
    userInput: string,
    options: AgentRespondOptions = {},
  ): Promise<string> {
    const input = userInput.trim();

    if (!input) {
      throw new Error("Agent input cannot be empty.");
    }

    const messages: OpenAI.Responses.ResponseInput = [
      ...this.conversation,
      { role: "user", content: input },
    ];
    const tools: OpenAI.Responses.Tool[] = [
      { type: "web_search_preview" },
      ...(this.toolset?.definitions ?? []),
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.client.responses.create({
        model: this.config.model,
        instructions: AGENT_INSTRUCTIONS,
        input: messages,
        max_output_tokens: this.config.maxOutputTokens,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: false,
      });

      if (response.output.some((item) => item.type === "web_search_call")) {
        options.onToolUse?.("web_search");
      }

      const functionCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
          item.type === "function_call",
      );

      if (functionCalls.length === 0) {
        this.conversation = [
          ...messages,
          { role: "assistant", content: response.output_text },
        ];
        return response.output_text;
      }

      if (!this.toolset) {
        throw new Error("The model requested a workspace tool, but none is configured.");
      }

      messages.push(
        ...(response.output as OpenAI.Responses.ResponseInputItem[]),
      );

      for (const functionCall of functionCalls) {
        options.onToolUse?.(functionCall.name as WorkspaceToolName);
        const output = await this.toolset.execute(
          functionCall.name,
          functionCall.arguments,
        );
        messages.push({
          type: "function_call_output",
          call_id: functionCall.call_id,
          output,
        });
      }
    }

    throw new Error("Agent exceeded the maximum number of tool rounds.");
  }

  public resetConversation(): void {
    this.conversation = [];
  }
}

export function createAgent(
  config: AiConfig = loadAiConfig(),
  toolset?: AgentToolset,
): Agent {
  return new Agent(createOpenAIClient(config), config, toolset);
}
