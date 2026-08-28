import { createInterface } from "node:readline/promises";

import { createAgent } from "./ai/agent.js";
import { createWorkspaceTools } from "./tools/workspace-tools.js";

const readline = createInterface({
  input: process.stdin,
  output: process.stdout,
});

try {
  const toolset = createWorkspaceTools({
    rootDir: process.cwd(),
    confirm: async ({ description }) => {
      const answer = (
        await readline.question(`Allow agent to ${description}? [y/N] `)
      )
        .trim()
        .toLowerCase();
      return answer === "y" || answer === "yes";
    },
  });
  const agent = createAgent(undefined, toolset);
  let prompt = process.argv.slice(2).join(" ").trim();

  while (true) {
    if (!prompt) {
      prompt = (await readline.question("****** You: ")).trim();
    }

    if (prompt === "/exit" || prompt === "/quit") {
      break;
    }

    if (prompt) {
      try {
        const result = await agent.respond(prompt, {
          onToolUse: (tool) => console.log(`Using tool: ${tool}`),
        });
        console.log(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`Agent request failed: ${message}`);
      }
    }

    prompt = "";
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Agent failed to start: ${message}`);
  process.exitCode = 1;
} finally {
  readline.close();
}
