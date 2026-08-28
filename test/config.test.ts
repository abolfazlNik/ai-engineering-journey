import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  loadAiConfig,
} from "../src/ai/config.js";

test("loadAiConfig uses cost-conscious defaults", () => {
  assert.deepEqual(loadAiConfig({ OPENROUTER_API_KEY: " test-key " }), {
    apiKey: "test-key",
    baseUrl: DEFAULT_OPENROUTER_BASE_URL,
    model: DEFAULT_OPENROUTER_MODEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });
});

test("loadAiConfig supports OpenRouter overrides", () => {
  const config = loadAiConfig({
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_BASE_URL: " https://openrouter.test/api/v1 ",
    OPENROUTER_MODEL: " anthropic/test-model ",
  });

  assert.equal(config.baseUrl, "https://openrouter.test/api/v1");
  assert.equal(config.model, "anthropic/test-model");
});

test("loadAiConfig supports the legacy OPENAI_API_KEY variable", () => {
  const config = loadAiConfig({
    OPENAI_API_KEY: "legacy-key",
  });

  assert.equal(config.apiKey, "legacy-key");
  assert.equal(config.model, DEFAULT_OPENROUTER_MODEL);
});

test("loadAiConfig clearly reports a missing API key", () => {
  assert.throws(() => loadAiConfig({}), /OPENROUTER_API_KEY is required/);
});
