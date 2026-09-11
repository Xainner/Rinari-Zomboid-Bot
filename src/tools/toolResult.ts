/**
 * Standard ToolResult for Harness v2 (doc 01 sections 2-4).
 *
 * The LLM must never infer operational state from free-text errors.
 * Every tool execution maps to one of these statuses.
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

export function okResult<T>(data: T, opts?: Partial<ToolResult<T>>): ToolResult<T> {
  return {
    status: 'success',
    data,
    sideEffect: false,
    verified: false,
    retryable: false,
    actionId: newActionId(),
    durationMs: 0,
    ...opts,
  };
}

export function partialResult<T>(data: T, code: string, summary?: string, opts?: Partial<ToolResult<T>>): ToolResult<T> {
  return {
    status: 'partial',
    code,
    summary,
    data,
    sideEffect: false,
    verified: false,
    retryable: false,
    actionId: newActionId(),
    durationMs: 0,
    ...opts,
  };
}

export function deniedResult(code: string, summary?: string): ToolResult<never> {
  return {
    status: 'denied',
    code,
    summary,
    sideEffect: false,
    verified: false,
    retryable: false,
    actionId: newActionId(),
    durationMs: 0,
  };
}

export function failedResult(code: string, summary?: string, retryable = false): ToolResult<never> {
  return {
    status: 'failed',
    code,
    summary,
    retryable,
    sideEffect: false,
    verified: false,
    actionId: newActionId(),
    durationMs: 0,
  };
}

export function unknownOutcomeResult(code: string, summary?: string): ToolResult<never> {
  return {
    status: 'unknown_outcome',
    code,
    summary,
    retryable: false,
    sideEffect: true,
    verified: false,
    actionId: newActionId(),
    durationMs: 0,
  };
}

export function retryableResult(code: string, summary?: string): ToolResult<never> {
  return {
    status: 'retryable_error',
    code,
    summary,
    retryable: true,
    sideEffect: false,
    verified: false,
    actionId: newActionId(),
    durationMs: 0,
  };
}
