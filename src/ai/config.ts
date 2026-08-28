export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-nano";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MAX_OUTPUT_TOKENS = 800;

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number;
}

export function loadAiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AiConfig {
  const apiKey =
    environment.OPENROUTER_API_KEY?.trim() ||
    environment.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is required. Set it in the environment or in the project's .env file.",
    );
  }

  return {
    apiKey,
    baseUrl:
      environment.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL,
    model:
      environment.OPENROUTER_MODEL?.trim() ||
      DEFAULT_OPENROUTER_MODEL,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  };
}
