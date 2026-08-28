# AI Engineering Journey

Small TypeScript foundation for a command-line AI agent powered by OpenRouter's
OpenAI-compatible Responses API.

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`.
3. Optionally set `OPENROUTER_MODEL`; it defaults to
   `openai/gpt-4.1-nano`.

The existing `OPENAI_API_KEY` variable is also accepted for backward
compatibility.

## Capabilities

- Answers general questions using the model's existing knowledge without tools.
- Lets the model search the web when current or external facts are required.
- Prints the tool name before displaying an answer that used a tool.
- Keeps conversation history for the current CLI session.
- Reads UTF-8 text files inside the current workspace.
- Creates and edits workspace files after explicit human approval.
- Deletes individual workspace files after explicit human approval.
- Runs JavaScript, TypeScript, Python, and shell scripts after explicit human
  approval, then returns stdout and stderr to the model.
- Runs one executable with explicit arguments after human approval. Commands do
  not use implicit shell parsing.

Every write, edit, or script execution shows a prompt like:

```text
Allow agent to create "scripts/example.js" (120 bytes)? [y/N]
```

Only `y` or `yes` approves the action. File paths outside the workspace are
rejected. Credential files such as `.env`, `.npmrc`, `.netrc`, and `.pypirc`
cannot be read by the agent. API keys and similar secrets are removed from the
environment inherited by child processes.

Run a one-shot prompt during development:

```bash
npm run dev
# You: Write a short bedtime story about a unicorn.

# Or pass the prompt directly:
npm run dev -- "Write a short bedtime story about a unicorn."
```

The conversation remains open after each response. Enter `/exit` or `/quit` to
close it.

Build and run the compiled version:

```bash
npm run build
npm start -- "Write a short bedtime story about a unicorn."
```

Run local validation (tests mock the OpenAI API and do not make paid requests):

```bash
npm run typecheck
npm test
npm run eval
```

The deterministic eval suite uses a mocked model boundary and real temporary
files/processes. It checks general-answer routing, denied writes, approved
script creation and execution, approved edits, denied deletion, denied command
execution, tool outputs, final answers, and absence of forbidden side effects.
It does not make paid API requests.
