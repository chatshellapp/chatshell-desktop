// Auto-mode transcript markers (permission v3): one per judged tool call,
// keyed by tool call id. Live markers arrive on `auto-review-decided`;
// markers of earlier turns load from the device-local decision log
// (`list_auto_review_markers`), so other devices show none.

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logger'

export type AutoReviewMarkerKind = 'allowed' | 'denied' | 'failed' | 'jail_denied' | 'override'

export type AutoReviewRisk = 'low' | 'medium' | 'high' | 'critical'

export interface AutoReviewMarker {
  toolCallId: string
  conversationId: string
  /** The decision to run anyway; null on `override` markers. */
  decisionId: string | null
  kind: AutoReviewMarkerKind
  riskLevel: AutoReviewRisk | null
  rationale: string | null
  /** The user ran this denied action anyway. */
  overridden: boolean
}

/** Payload of the backend's `auto-review-decided` event. */
export interface AutoReviewDecidedEvent {
  conversation_id: string
  tool_call_id: string | null
  decision_id: string | null
  kind: AutoReviewMarkerKind
  tool_name: string
  subject: string
  risk_level: AutoReviewRisk | null
  rationale: string | null
  suggest_mode_switch: boolean
}

/** A row of `list_auto_review_markers`. */
interface PersistedMarker {
  decisionId: string
  toolCallId: string | null
  kind: Exclude<AutoReviewMarkerKind, 'override'>
  riskLevel: string | null
  rationale: string | null
  overridden: boolean
}

const RISKS: readonly string[] = ['low', 'medium', 'high', 'critical']

function parseRisk(value: string | null | undefined): AutoReviewRisk | null {
  return value && RISKS.includes(value) ? (value as AutoReviewRisk) : null
}

/** Markers that offer run-anyway. */
export function canRunAnyway(marker: AutoReviewMarker): boolean {
  return (
    !marker.overridden &&
    marker.decisionId !== null &&
    (marker.kind === 'denied' || marker.kind === 'failed' || marker.kind === 'jail_denied')
  )
}

interface AutoReviewState {
  /** Tool call id -> marker. A later marker for the same call (a sandbox
   * denial after an allow) replaces the earlier one. */
  markers: Record<string, AutoReviewMarker>
  /** Apply a live event. */
  receive: (event: AutoReviewDecidedEvent) => void
  /** Load a conversation's persisted markers (live ones win). */
  load: (conversationId: string) => Promise<void>
  /** Record a run-anyway tap. */
  markOverridden: (decisionId: string) => void
  reset: () => void
}

export const useAutoReviewStore = create<AutoReviewState>()((set) => ({
  markers: {},
  receive: (event) => {
    if (!event.tool_call_id) return
    const marker: AutoReviewMarker = {
      toolCallId: event.tool_call_id,
      conversationId: event.conversation_id,
      decisionId: event.decision_id,
      kind: event.kind,
      riskLevel: parseRisk(event.risk_level),
      rationale: event.rationale,
      overridden: false,
    }
    set((state) => ({ markers: { ...state.markers, [marker.toolCallId]: marker } }))
  },
  load: async (conversationId) => {
    try {
      const rows = await invoke<PersistedMarker[]>('list_auto_review_markers', {
        conversationId,
      })
      set((state) => {
        const markers = { ...state.markers }
        for (const row of rows) {
          if (!row.toolCallId || markers[row.toolCallId]) continue
          markers[row.toolCallId] = {
            toolCallId: row.toolCallId,
            conversationId,
            decisionId: row.decisionId,
            kind: row.kind,
            riskLevel: parseRisk(row.riskLevel),
            rationale: row.rationale,
            overridden: row.overridden,
          }
        }
        return { markers }
      })
    } catch (error) {
      logger.error('[autoReviewStore] list_auto_review_markers failed:', error)
    }
  },
  markOverridden: (decisionId) =>
    set((state) => {
      const markers = { ...state.markers }
      for (const [id, marker] of Object.entries(markers)) {
        if (marker.decisionId === decisionId) markers[id] = { ...marker, overridden: true }
      }
      return { markers }
    }),
  reset: () => set({ markers: {} }),
}))

/** Window event asking the composer to send a message for a conversation
 * (run-anyway's retry request). */
export const COMPOSE_SUBMIT_EVENT = 'chatshell:compose-submit'

export interface ComposeSubmitDetail {
  conversationId: string
  text: string
}

export function requestComposeSubmit(detail: ComposeSubmitDetail): void {
  window.dispatchEvent(new CustomEvent<ComposeSubmitDetail>(COMPOSE_SUBMIT_EVENT, { detail }))
}
