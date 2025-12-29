// ==========================================================================
// CATEGORY 3: PROCESS STEPS (AI workflow artifacts)
// ==========================================================================

// Thinking step - stores AI's reasoning/thinking process
export interface ThinkingStep {
  id: string
  content: string
  source: string // "llm" | "extended_thinking"
  display_order: number
  created_at: string
}

export interface CreateThinkingStepRequest {
  content: string
  source?: string
  display_order?: number
}

// Search decision - stores AI's reasoning about whether web search is needed
export interface SearchDecision {
  id: string
  reasoning: string
  search_needed: boolean
  search_query?: string
  search_result_id?: string // Link to resulting search if approved
  display_order: number
  created_at: string
}

export interface CreateSearchDecisionRequest {
  reasoning: string
  search_needed: boolean
  search_query?: string
  search_result_id?: string
  display_order?: number
}

// Tool call - stores tool/function invocations (for MCP support)
export interface ToolCall {
  id: string
  tool_name: string
  tool_input?: string // JSON
  tool_output?: string // JSON
  status: string // "pending" | "running" | "success" | "error"
  error?: string
  duration_ms?: number
  display_order: number
  created_at: string
  completed_at?: string
}

export interface CreateToolCallRequest {
  tool_name: string
  tool_input?: string
  tool_output?: string
  status?: string
  error?: string
  duration_ms?: number
  display_order?: number
  completed_at?: string
}

// Code execution - stores code interpreter results
export interface CodeExecution {
  id: string
  language: string
  code: string
  output?: string
  exit_code?: number
  status: string // "pending" | "running" | "success" | "error"
  error?: string
  duration_ms?: number
  display_order: number
  created_at: string
  completed_at?: string
}

export interface CreateCodeExecutionRequest {
  language: string
  code: string
  output?: string
  exit_code?: number
  status?: string
  error?: string
  duration_ms?: number
  display_order?: number
  completed_at?: string
}

// Content block - stores segmented content for interleaved display with tool calls
export interface ContentBlock {
  id: string
  content: string
  display_order: number
  created_at: string
}

export interface CreateContentBlockRequest {
  content: string
  display_order: number
}

// Process step type enum
export type StepType =
  | 'thinking'
  | 'search_decision'
  | 'tool_call'
  | 'code_execution'
  | 'content_block'

// Unified process step type
export type ProcessStep =
  | ({ type: 'thinking' } & ThinkingStep)
  | ({ type: 'search_decision' } & SearchDecision)
  | ({ type: 'tool_call' } & ToolCall)
  | ({ type: 'code_execution' } & CodeExecution)
  | ({ type: 'content_block' } & ContentBlock)

// Helper type guards for process steps
export function isThinkingStep(step: ProcessStep): step is { type: 'thinking' } & ThinkingStep {
  return step.type === 'thinking'
}

export function isSearchDecision(
  step: ProcessStep
): step is { type: 'search_decision' } & SearchDecision {
  return step.type === 'search_decision'
}

export function isToolCall(step: ProcessStep): step is { type: 'tool_call' } & ToolCall {
  return step.type === 'tool_call'
}

export function isCodeExecution(
  step: ProcessStep
): step is { type: 'code_execution' } & CodeExecution {
  return step.type === 'code_execution'
}

export function isContentBlock(
  step: ProcessStep
): step is { type: 'content_block' } & ContentBlock {
  return step.type === 'content_block'
}

// Helper to get display_order from any ProcessStep
export function getDisplayOrder(step: ProcessStep): number {
  return step.display_order
}
