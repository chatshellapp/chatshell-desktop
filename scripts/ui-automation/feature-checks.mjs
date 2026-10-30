#!/usr/bin/env node
// Feature checks against the seed profile (scripts/ui-automation/prepare-profile.sh
// seed …, database from `cargo run --example uitest_seed`). Drives the real
// UI (composer, buttons) through the debug-only automation endpoint and
// reports PASS/FAIL per check.
//
//   node scripts/ui-automation/feature-checks.mjs --port 18765 [--only folds,send]
//
// Needs the httpcan LLM mock at http://localhost:18080/llm/v1 and the test
// window visible (WebKit does not render covered windows).

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, all) => {
    if (!arg.startsWith('--')) return []
    const next = all[i + 1]
    return [[arg.slice(2), next && !next.startsWith('--') ? next : 'true']]
  })
)
const port = Number(args.port ?? 18765)
const only = args.only ? new Set(args.only.split(',')) : null

async function evalJs(body, timeoutMs = 60000) {
  const res = await fetch(`http://127.0.0.1:${port}/eval?timeout_ms=${timeoutMs}`, {
    method: 'POST',
    body: PAGE + body,
  })
  const json = await res.json()
  if (!json.ok) throw new Error(String(json.value))
  return json.value
}

// In-page helpers. Every check opens its conversation the way a sidebar
// click does and acts through the rendered UI.
const PAGE = String.raw`
const T = window.__chatshellTest
if (!T) throw new Error('window.__chatshellTest missing: is this a dev build?')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const container = () => document.querySelector('[data-transcript-scroll]')
const viewTop = () => container().getBoundingClientRect().top
const conv = () => T.useConversationStore.getState().currentConversation
const state = () => T.useMessageStore.getState().conversationStates[conv().id]
const msgs = () => state()?.messages ?? []
const row = (id) => container().querySelector('[data-message-id="' + id + '"]')
const screenTop = (id) => { const el = row(id); return el ? Math.round((el.getBoundingClientRect().top - viewTop()) * 10) / 10 : null }
const lastOf = (type) => { const list = msgs(); for (let i = list.length - 1; i >= 0; i--) if ((type === 'user') === (list[i].sender_type === 'user')) return list[i]; return null }
const waitFor = async (predicate, ms = 8000) => { const end = performance.now() + ms; while (performance.now() < end) { if (predicate()) return true; await sleep(50) } return predicate() }
const open = async (title) => {
  const c = T.useConversationStore.getState().conversations.find((x) => x.title === title)
  if (!c) throw new Error('no conversation titled ' + title)
  await T.useConversationStore.getState().selectConversation(c.id)
  await waitFor(() => msgs().length > 0 && container().querySelectorAll('[data-message-id]').length === msgs().length)
  await sleep(600)
  return c.id
}
const send = async (text) => {
  const ta = document.querySelector('textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  ta.focus()
  setter.call(ta, text)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(100)
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
}
const buttonByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.innerText.trim().includes(text))
`

const checks = {
  async folds() {
    return evalJs(`
      await open('UI · Folds')
      const replies = msgs().filter((m) => m.sender_type !== 'user')
      const read = (m) => {
        const fold = row(m.id)?.querySelector('[data-run-fold]')
        if (!fold) return null
        const header = fold.querySelector('button[aria-expanded]')
        // textContent: innerText is empty for rows WebKit skips rendering
        // (content-visibility: auto, off screen)
        const text = [...header.querySelectorAll('span')].map((el) => el.textContent.trim()).filter(Boolean).join(' ')
        return { status: fold.dataset.runFold, expanded: header.getAttribute('aria-expanded') === 'true', text }
      }
      const before = replies.map(read)
      // Toggle the first run open; it survives switching away and back
      row(replies[0].id).querySelector('[data-run-fold] button[aria-expanded]').click()
      await sleep(200)
      const opened = read(replies[0])
      const toolsShown = row(replies[0].id).querySelectorAll('[data-run-fold] > div').length > 0
      await open('UI · Branch')
      await open('UI · Folds')
      const afterReturn = read(msgs().filter((m) => m.sender_type !== 'user')[0])
      // Leave it as found
      row(replies[0].id).querySelector('[data-run-fold] button[aria-expanded]').click()
      return { before, opened, toolsShown, afterReturn }
    `).then((r) => {
      const [run1, run2, run3, run4, run5] = r.before
      const problems = []
      if (!run1 || run1.status !== 'completed' || run1.expanded || !run1.text.includes('3 steps'))
        problems.push(`run 1: ${JSON.stringify(run1)}`)
      if (!run2 || !run2.text.includes('1 tool failed') || run2.expanded)
        problems.push(`run 2: ${JSON.stringify(run2)}`)
      if (!run3 || run3.status !== 'stopped') problems.push(`run 3: ${JSON.stringify(run3)}`)
      if (run4 !== null) problems.push(`thinking-only run has a fold: ${JSON.stringify(run4)}`)
      if (run5 !== null) problems.push(`plain answer has a fold: ${JSON.stringify(run5)}`)
      if (!r.opened?.expanded || !r.toolsShown) problems.push('toggle did not open the fold')
      if (!r.afterReturn?.expanded) problems.push('manual toggle lost after switching away')
      return { ok: problems.length === 0, details: problems.join('; ') || JSON.stringify(r.before) }
    })
  },

  async send() {
    return evalJs(
      `
      await open('UI · Send')
      const before = msgs().length
      const text = 'Automated send check ' + Date.now()
      await send(text)
      await waitFor(() => msgs().some((m) => m.content === text))
      const sent = msgs().find((m) => m.content === text)
      const samples = []
      let sawStreaming = false
      const end = performance.now() + 4000
      while (performance.now() < end) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
        if (document.querySelector('[data-streaming-message]')) sawStreaming = true
        samples.push(screenTop(sent.id))
      }
      const reply = lastOf('model')
      return { before, after: msgs().length, samples, sawStreaming, replied: !!reply && msgs().indexOf(reply) > msgs().indexOf(sent), failed: !!state().failedTurn }
    `,
      30000
    ).then((r) => {
      const painted = r.samples.filter((v) => v !== null)
      const off = painted.filter((v) => Math.abs(v - 16) > 1)
      const problems = []
      if (painted.length === 0) problems.push('sent message never rendered')
      if (off.length) problems.push(`sent message off its 16px slot in ${off.length}/${painted.length} frames (e.g. ${off.slice(0, 3)})`)
      if (!r.replied) problems.push('no reply after the sent message')
      if (r.failed) problems.push('a failed turn appeared')
      if (r.after !== r.before + 2) problems.push(`window grew by ${r.after - r.before}, expected 2`)
      return { ok: problems.length === 0, details: problems.join('; ') || `held at 16px for ${painted.length} frames, streaming seen: ${r.sawStreaming}` }
    })
  },

  async regenerate() {
    return evalJs(
      `
      await open('UI · Send')
      const before = msgs().length
      const reply = lastOf('model')
      const regen = [...row(reply.id).querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-rotate-ccw') && !b.closest('[data-run-outcome]'))
      if (!regen) throw new Error('no regenerate button on the last reply')
      regen.click()
      await waitFor(() => state().isStreaming || state().isWaitingForAI, 3000)
      await waitFor(() => !state().isStreaming && !state().isWaitingForAI, 15000)
      await sleep(800)
      const newReply = lastOf('model')
      // The navigator's own counter (the row also shows a date like 10/30)
      const nav = [...(row(newReply.id)?.querySelectorAll('span.tabular-nums') ?? [])].map((el) => el.textContent.trim()).find((t) => /^\\d+\\/\\d+$/.test(t))
      return { before, after: msgs().length, replaced: newReply.id !== reply.id, nav: nav ?? null, failed: !!state().failedTurn }
    `,
      30000
    ).then((r) => {
      const problems = []
      if (!r.replaced) problems.push('reply was not replaced')
      if (r.after !== r.before) problems.push(`window has ${r.after} messages, expected ${r.before} (old reply still shown?)`)
      if (r.nav !== '2/2') problems.push(`sibling navigator shows ${r.nav}, expected 2/2`)
      if (r.failed) problems.push('a failed turn appeared')
      return { ok: problems.length === 0, details: problems.join('; ') || `navigator ${r.nav}` }
    })
  },

  async branch() {
    return evalJs(`
      await open('UI · Branch')
      const reply = lastOf('model')
      const before = screenTop(reply.id)
      const next = row(reply.id).querySelector('button[aria-label="Next variant"]')
      if (!next) throw new Error('no next-variant button')
      next.click()
      await waitFor(() => lastOf('model')?.id !== reply.id)
      await sleep(800)
      const sibling = lastOf('model')
      const after = screenTop(sibling.id)
      // Switch back for later runs
      row(sibling.id).querySelector('button[aria-label="Previous variant"]')?.click()
      await sleep(800)
      return { before, after, switched: sibling.id !== reply.id }
    `).then((r) => {
      const ok = r.switched && r.before !== null && r.after !== null && Math.abs(r.after - r.before) <= 1
      return { ok, details: `old sibling at ${r.before}px, new sibling at ${r.after}px` }
    })
  },

  async jump() {
    return evalJs(`
      await open('UI · Long history')
      const c = container()
      c.scrollTop = Math.max(0, c.scrollTop - 3000)
      await sleep(400)
      const button = document.querySelector('button[aria-label="Jump to latest"]')
      const shown = !!button && button.parentElement.className.includes('opacity-100')
      button.click()
      await sleep(1200)
      return { shown, gap: Math.round(c.scrollHeight - c.scrollTop - c.clientHeight), hiddenAfter: button.parentElement.className.includes('opacity-0') }
    `).then((r) => ({
      ok: r.shown && r.gap <= 2 && r.hiddenAfter,
      details: `shown when scrolled up: ${r.shown}, distance to end after jump: ${r.gap}px, hidden after: ${r.hiddenAfter}`,
    }))
  },

  async paging() {
    return evalJs(`
      await open('UI · Long history')
      const c = container()
      const before = msgs().length
      // Read near the top of the loaded window; an older page prepends. The
      // reader's row is read in the same task as the scroll, before any
      // frame (and the page load) can change the layout.
      c.scrollTop = 120
      const anchor = [...c.querySelectorAll('[data-message-id]')].find((el) => el.getBoundingClientRect().top >= viewTop())
      const id = anchor.dataset.messageId
      const anchorTop2 = screenTop(id)
      await waitFor(() => msgs().length > before, 6000)
      await sleep(800)
      return { before, after: msgs().length, top: anchorTop2, afterTop: screenTop(id) }
    `).then((r) => ({
      ok: r.after > r.before && r.top !== null && Math.abs(r.afterTop - r.top) <= 1,
      details: `messages ${r.before} -> ${r.after}, reader's row ${r.top}px -> ${r.afterTop}px`,
    }))
  },

  async failure() {
    return evalJs(
      `
      await open('UI · Dead provider')
      const before = msgs().length
      await send('This send will fail ' + Date.now())
      await waitFor(() => !!document.querySelector('[data-failed-turn]'), 15000)
      const card = document.querySelector('[data-failed-turn]')
      const first = { shown: !!card, text: card?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160), msgs: msgs().length }
      buttonByText(card, 'Retry').click()
      await waitFor(() => !document.querySelector('[data-failed-turn]'), 3000)
      await waitFor(() => !!document.querySelector('[data-failed-turn]'), 15000)
      const retried = { shown: !!document.querySelector('[data-failed-turn]'), msgs: msgs().length }
      buttonByText(document.querySelector('[data-failed-turn]'), 'Dismiss').click()
      await sleep(300)
      return { before, first, retried, dismissed: !document.querySelector('[data-failed-turn]') }
    `,
      60000
    ).then((r) => {
      const problems = []
      if (!r.first.shown || !r.first.text.includes('Send failed')) problems.push(`no failed turn: ${JSON.stringify(r.first)}`)
      if (r.first.msgs !== r.before + 1) problems.push(`window grew by ${r.first.msgs - r.before}, expected only the user message`)
      if (!r.retried.shown || r.retried.msgs !== r.first.msgs) problems.push(`retry: ${JSON.stringify(r.retried)}`)
      if (!r.dismissed) problems.push('dismiss left the card')
      return { ok: problems.length === 0, details: problems.join('; ') || r.first.text }
    })
  },

  async previousReply() {
    return evalJs(
      `
      await open('UI · Dead provider')
      // Regenerate the earlier answer; the dead endpoint fails it
      const reply = msgs().find((m) => m.sender_type !== 'user')
      const regen = [...row(reply.id).querySelectorAll('button')].find((b) => b.querySelector('svg.lucide-rotate-ccw') && !b.closest('[data-run-outcome]'))
      regen.click()
      await waitFor(() => !!document.querySelector('[data-failed-turn]'), 15000)
      const card = document.querySelector('[data-failed-turn]')
      const offered = !!buttonByText(card, 'Show previous reply')
      await sleep(500)
      const leaf = await window.__TAURI_INTERNALS__.invoke('get_conversation', { id: conv().id })
      buttonByText(card, 'Show previous reply')?.click()
      await waitFor(() => !document.querySelector('[data-failed-turn]'), 5000)
      await sleep(500)
      return { offered, replyBack: msgs().some((m) => m.id === reply.id), cardGone: !document.querySelector('[data-failed-turn]'), leafKnown: !!leaf?.active_message_id, leafIsReplyBranch: msgs().some((m) => m.id === leaf?.active_message_id) }
    `,
      60000
    ).then((r) => ({
      ok: r.offered && r.replyBack && r.cardGone && r.leafIsReplyBranch,
      details: JSON.stringify(r),
    }))
  },
}

async function main() {
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())
  if (!health.ok) throw new Error('automation endpoint not healthy')
  let failed = 0
  for (const [name, check] of Object.entries(checks)) {
    if (only && !only.has(name)) continue
    try {
      const { ok, details } = await check()
      if (!ok) failed += 1
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${details}`)
    } catch (error) {
      failed += 1
      console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`)
    }
  }
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 2
})
