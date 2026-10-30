import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@/lib/i18n'
import { useConversationStore } from '@/stores/conversation'
import { useMessageStore } from '@/stores/message'
import { useRunFoldStore } from '@/stores/runFoldStore'

// Dev builds expose the stores to the debug-only UI automation endpoint
// (src-tauri/src/ui_automation.rs), so tests can open conversations the way
// a click does.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __chatshellTest: { useConversationStore, useMessageStore, useRunFoldStore },
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
