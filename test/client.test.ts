import assert from "node:assert/strict";
import test from "node:test";

import { createOpenAIClient } from "../src/ai/client.js";

test("createOpenAIClient targets the configured OpenRouter endpoint", () => {
  const client = createOpenAIClient({
    apiKey: "test-key",
    baseUrl: "https://openrouter.test/api/v1",
    model: "openai/test-model",
    maxOutputTokens: 123,
  });

  assert.equal(client.baseURL, "https://openrouter.test/api/v1");
});
