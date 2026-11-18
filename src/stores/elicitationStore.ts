// Pending MCP elicitation requests (FR-12), fed by
// `mcp-elicitation-requested` / `mcp-elicitation-resolved`. A FIFO queue
// across servers and conversations: the dialog shows the oldest. RAM only.

import { create } from 'zustand'

/** A JSON Schema property of an elicitation form (primitive types only). */
export interface ElicitationProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  title?: string
  description?: string
  enum?: (string | number)[]
  enumNames?: string[]
  oneOf?: { const: string | number; title?: string }[]
  items?: { type?: string; enum?: string[]; anyOf?: { const: string; title?: string }[] }
  format?: string
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}

export interface ElicitationSchema {
  type?: 'object'
  title?: string
  properties?: Record<string, ElicitationProperty>
  required?: string[]
}

export type ElicitationRequest =
  | {
      requestId: string
      serverName: string
      mode: 'form'
      message: string
      schema: ElicitationSchema
    }
  | {
      requestId: string
      serverName: string
      mode: 'url'
      message: string
      url: string
    }

interface ElicitationState {
  pending: ElicitationRequest[]
  show: (request: ElicitationRequest) => void
  remove: (requestId: string) => void
  reset: () => void
}

export const useElicitationStore = create<ElicitationState>()((set) => ({
  pending: [],
  show: (request) =>
    set((state) =>
      state.pending.some((p) => p.requestId === request.requestId)
        ? state
        : { pending: [...state.pending, request] }
    ),
  remove: (requestId) =>
    set((state) => ({ pending: state.pending.filter((p) => p.requestId !== requestId) })),
  reset: () => set({ pending: [] }),
}))
