import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkspaceTools } from "../src/tools/workspace-tools.js";

function parseResult(result: string): Record<string, unknown> {
  return JSON.parse(result) as Record<string, unknown>;
}

test("read_file reads inside the workspace and blocks traversal", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-read-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(join(rootDir, "notes.txt"), "hello", "utf8");
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async () => {
      throw new Error("read_file must not request approval");
    },
  });

  assert.deepEqual(parseResult(await tools.execute("read_file", '{"path":"notes.txt"}')), {
    ok: true,
    path: "notes.txt",
    content: "hello",
  });

  const traversal = parseResult(
    await tools.execute("read_file", '{"path":"../outside.txt"}'),
  );
  assert.equal(traversal.ok, false);
  assert.match(String(traversal.error), /inside the workspace/);
});

test("read_file refuses credential files", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-secret-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(join(rootDir, ".env"), "API_KEY=secret", "utf8");
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async () => true,
  });

  const result = parseResult(
    await tools.execute("read_file", '{"path":".env"}'),
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error), /sensitive credential/);
});

test("list_files lists a directory without requesting approval", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-list-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(join(rootDir, "notes.txt"), "hello", "utf8");
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async () => {
      throw new Error("list_files must not request approval");
    },
  });

  const result = parseResult(
    await tools.execute("list_files", '{"dir":"."}'),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.entries, [{ name: "notes.txt", type: "file" }]);
});

test("write_file does nothing when approval is denied", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-deny-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async () => false,
  });

  const result = parseResult(
    await tools.execute(
      "write_file",
      '{"path":"nested/denied.txt","content":"no"}',
    ),
  );

  assert.deepEqual(result, { ok: false, error: "User denied this action." });
  await assert.rejects(stat(join(rootDir, "nested")), /ENOENT/);
});

test("file tools reject symlinks that escape the workspace", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-root-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "agent-tools-outside-"));
  context.after(() =>
    Promise.all([
      rm(rootDir, { recursive: true, force: true }),
      rm(outsideDir, { recursive: true, force: true }),
    ]),
  );
  await writeFile(join(outsideDir, "secret.txt"), "secret", "utf8");
  await symlink(join(outsideDir, "secret.txt"), join(rootDir, "link.txt"));
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async () => true,
  });

  const result = parseResult(
    await tools.execute("read_file", '{"path":"link.txt"}'),
  );
  assert.equal(result.ok, false);
  assert.match(String(result.error), /inside the workspace/);
});

test("delete_file preserves the file when approval is denied", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-delete-deny-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(join(rootDir, "keep.txt"), "keep", "utf8");
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async () => false,
  });

  const result = parseResult(
    await tools.execute("delete_file", '{"path":"keep.txt"}'),
  );
  assert.equal(result.ok, false);
  assert.equal(await readFile(join(rootDir, "keep.txt"), "utf8"), "keep");
});

test("run_command does not execute when approval is denied", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-command-deny-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const markerPath = join(rootDir, "marker.txt");
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async () => false,
  });

  const result = parseResult(
    await tools.execute(
      "run_command",
      JSON.stringify({
        command: process.execPath,
        args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`],
      }),
    ),
  );
  assert.equal(result.ok, false);
  await assert.rejects(stat(markerPath), /ENOENT/);
});

test("approved tools write, edit, run, and return script output", async (context) => {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-flow-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const approvals: string[] = [];
  const tools = createWorkspaceTools({
    rootDir,
    confirm: async ({ action }) => {
      approvals.push(action);
      return true;
    },
  });

  const writeResult = parseResult(
    await tools.execute(
      "write_file",
      JSON.stringify({
        path: "scripts/hello.js",
        content: 'console.log(`hello ${process.argv[2]}`);\n',
      }),
    ),
  );
  assert.equal(writeResult.ok, true);

  const editResult = parseResult(
    await tools.execute(
      "edit_file",
      JSON.stringify({
        path: "scripts/hello.js",
        old_text: "hello",
        new_text: "hi",
      }),
    ),
  );
  assert.equal(editResult.ok, true);

  const runResult = parseResult(
    await tools.execute(
      "run_script",
      JSON.stringify({ path: "scripts/hello.js", args: ["Abolfazl"] }),
    ),
  );
  assert.equal(runResult.ok, true);
  assert.equal(runResult.stdout, "hi Abolfazl\n");

  const commandResult = parseResult(
    await tools.execute(
      "run_command",
      JSON.stringify({
        command: process.execPath,
        args: ["-e", "console.log('command ok')"],
      }),
    ),
  );
  assert.equal(commandResult.ok, true);
  assert.equal(commandResult.stdout, "command ok\n");

  const deleteResult = parseResult(
    await tools.execute(
      "delete_file",
      JSON.stringify({ path: "scripts/hello.js" }),
    ),
  );
  assert.equal(deleteResult.ok, true);
  await assert.rejects(stat(join(rootDir, "scripts/hello.js")), /ENOENT/);
  assert.deepEqual(approvals, [
    "write_file",
    "edit_file",
    "run_script",
    "run_command",
    "delete_file",
  ]);
});
