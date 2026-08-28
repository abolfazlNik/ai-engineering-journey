import OpenAI from "openai";

import type { AiConfig } from "./config.js";

export function createOpenAIClient(config: AiConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
}
