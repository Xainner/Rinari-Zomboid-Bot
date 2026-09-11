/**
 * Standard ToolResult for Harness v2 (doc 01 sections 2-4).
 *
 * The LLM must never infer operational state from free-text errors.
 * Every tool execution maps to one of these statuses.
 *
 * NOTE Fase 1: ExecutionResult in executor.ts carries these fields for
 * compat (ok/denied + status/code/...). Full migration to ToolResult<T>
 * happens in Fase 2 with ToolSpecRegistry.
 */
export type ToolStatus =
  | 'success'
  | 'partial'
  | 'denied'
  | 'unsupported'
  | 'retryable_error'
  | 'unknown_outcome'
  | 'failed';

export interface ToolResult<T = unknown> {
  status: ToolStatus;
  /** Machine-readable code, e.g. INVALID_TOOL_ARGUMENTS, MOD_STATUS_UNAVAILABLE. */
  code?: string;
  /** Short human/LLM-readable summary. */
  summary?: string;
  data?: T;
  sideEffect?: boolean;
  verified?: boolean;
  retryable?: boolean;
  /** Unique id per execution, for audit/confirmation correlation. */
  actionId: string;
  durationMs: number;
}

let actionCounter = 0;

export function newActionId(): string {
  actionCounter += 1;
  // Short, unique-enough for logs without crypto overhead.
  return `a_${Date.now().toString(36)}_${actionCounter.toString(36)}`;
}

export function resetActionCounterForTests(): void {
  actionCounter = 0;
}
