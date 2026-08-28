export type WorkspaceToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "run_script"
  | "run_command";

export interface FunctionToolDefinition {
  type: "function";
  name: WorkspaceToolName;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
}

export interface ApprovalRequest {
  action: Exclude<WorkspaceToolName, "read_file">;
  description: string;
}

export type ConfirmAction = (request: ApprovalRequest) => Promise<boolean>;

export interface AgentToolset {
  definitions: FunctionToolDefinition[];
  execute(name: string, argumentsJson: string): Promise<string>;
}
