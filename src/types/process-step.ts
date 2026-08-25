// Process step types are generated from Rust models (src-tauri/src/models/process_step.rs)
// via ts-rs. Run `pnpm types:generate` in src-tauri to regenerate.

export type { ThinkingStep } from './generated/ThinkingStep'
export type { CreateThinkingStepRequest } from './generated/CreateThinkingStepRequest'
export type { SearchDecision } from './generated/SearchDecision'
export type { CreateSearchDecisionRequest } from './generated/CreateSearchDecisionRequest'
export type { ToolCall } from './generated/ToolCall'
export type { CreateToolCallRequest } from './generated/CreateToolCallRequest'
export type { CodeExecution } from './generated/CodeExecution'
export type { CreateCodeExecutionRequest } from './generated/CreateCodeExecutionRequest'
export type { ContentBlock } from './generated/ContentBlock'
export type { CreateContentBlockRequest } from './generated/CreateContentBlockRequest'
export type { StepType } from './generated/StepType'
export type { ProcessStep } from './generated/ProcessStep'

import type { ProcessStep } from './generated/ProcessStep'
import type { ThinkingStep } from './generated/ThinkingStep'
import type { SearchDecision } from './generated/SearchDecision'
import type { ToolCall } from './generated/ToolCall'
import type { CodeExecution } from './generated/CodeExecution'
import type { ContentBlock } from './generated/ContentBlock'

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
