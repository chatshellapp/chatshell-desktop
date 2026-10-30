#!/usr/bin/env node
// Open-positioning check for the transcript scroll model.
//
// Drives the dev app through the debug-only UI automation endpoint
// (src-tauri/src/ui_automation.rs). Each open calls the same store action
// as a sidebar click and records a per-frame timeline, sampled after each
// frame is painted, of where the last user message sits.
//
//   node scripts/ui-automation/open-positioning.mjs \
//     --port 18765 --recent 5 --extra 01a138b7,01a1402c,01a15e1d \
//     --repeat 5 --sizes 1100x760,1600x1000
//
//   node scripts/ui-automation/open-positioning.mjs --port 18765 --watch
//     records opens made by hand in the app and prints each one.
//
// Output names conversations by id only; message text is never read.

import { mkdirSync, writeFileSync } from 'node:fs'

const TOP_INSET = 16
const TOLERANCE = 1

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, all) => {
    if (!arg.startsWith('--')) return []
    const next = all[i + 1]
    return [[arg.slice(2), next && !next.startsWith('--') ? next : 'true']]
  })
)
const port = Number(args.port ?? 18765)
const repeat = Number(args.repeat ?? 5)
const durationMs = Number(args.duration ?? 2500)
const sizes = (args.sizes ?? '').split(',').filter(Boolean)
const modes = (args.modes ?? 'cold,warm').split(',')

async function evalJs(body, timeoutMs = 60000) {
  const res = await fetch(`http://127.0.0.1:${port}/eval?timeout_ms=${timeoutMs}`, {
    method: 'POST',
    body,
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`eval failed: ${json.value}`)
  return json.value
}

async function setWindow(size) {
  const [width, height] = size.split('x').map(Number)
  await fetch(`http://127.0.0.1:${port}/window`, {
    method: 'POST',
    body: JSON.stringify({ width, height }),
  })
  await sleep(800)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitVisible() {
  for (;;) {
    const visible = await evalJs(`return document.visibilityState === 'visible'`).catch(() => false)
    if (visible) return
    await sleep(2000)
  }
}

// In-page helpers, installed once per eval. The sampler reads after paint:
// a message posted from requestAnimationFrame runs once the frame rendered,
// so a sample is what was on screen, not the pre-layout state.
const PAGE_HELPERS = String.raw`
const T = window.__chatshellTest
if (!T) throw new Error('window.__chatshellTest missing: is this a dev build?')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const container = () => document.querySelector('[data-transcript-scroll]')
// A covered or minimized window stops rendering (no frames); the timeout
// keeps the loop alive, and such samples are marked with the visibility.
// Resolves true after a painted frame, false when no frame came in time
// (a reading then is not something the user saw).
const afterPaint = () => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 250)
  requestAnimationFrame(() => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => { clearTimeout(timer); resolve(true) }
    ch.port2.postMessage(null)
  })
})
const targetOf = (convId) => {
  const msgs = T.useMessageStore.getState().conversationStates[convId]?.messages ?? []
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].sender_type === 'user') return msgs[i].id
  return msgs[msgs.length - 1]?.id ?? null
}
const sampleOnce = (convId, t0) => {
  const c = container()
  const current = T.useConversationStore.getState().currentConversation?.id === convId
  const cs = T.useMessageStore.getState().conversationStates[convId]
  const targetId = targetOf(convId)
  if (!c) return { t: performance.now() - t0, current, noContainer: true }
  const el = targetId ? c.querySelector('[data-message-id="' + targetId + '"]') : null
  const content = c.firstElementChild
  return {
    t: Math.round(performance.now() - t0),
    current,
    windowHidden: document.visibilityState !== 'visible',
    loading: !!cs?.isLoading,
    // The opening position settles while transparent; those frames are not seen
    hidden: !!content && getComputedStyle(content).opacity === '0',
    msgs: cs?.messages?.length ?? 0,
    rows: c.querySelectorAll('[data-message-id]').length,
    scrollTop: Math.round(c.scrollTop * 10) / 10,
    scrollHeight: c.scrollHeight,
    clientHeight: c.clientHeight,
    targetId,
    targetTop: el ? Math.round((el.getBoundingClientRect().top - c.getBoundingClientRect().top) * 10) / 10 : null,
  }
}
const recordOpen = async (convId, durationMs, open) => {
  const t0 = performance.now()
  const samples = []
  let running = true
  const loop = async () => {
    while (running) {
      const painted = await afterPaint()
      samples.push({ ...sampleOnce(convId, t0), painted })
      if (performance.now() - t0 > durationMs) running = false
    }
  }
  const done = loop()
  await open()
  await done
  return samples
}
`

async function listConversations(count) {
  return evalJs(`${PAGE_HELPERS}
    const list = T.useConversationStore.getState().conversations
    return list.slice(0, ${count}).map((c) => c.id)
  `)
}

async function resolveIds(prefixes) {
  return evalJs(`${PAGE_HELPERS}
    const list = T.useConversationStore.getState().conversations.map((c) => c.id)
    return ${JSON.stringify(prefixes)}.map((p) => list.find((id) => id.startsWith(p)) ?? null)
  `)
}

async function measureOpen(convId, neutralId, mode) {
  return evalJs(
    `${PAGE_HELPERS}
    const convId = ${JSON.stringify(convId)}
    const neutralId = ${JSON.stringify(neutralId)}
    const select = (id) => T.useConversationStore.getState().selectConversation(id)
    if (${JSON.stringify(mode)} === 'warm') {
      // Load and render the target once, so the measured open reuses the
      // cached window (re-entering a conversation)
      await select(convId)
      await sleep(1500)
    }
    await select(neutralId)
    await sleep(1200)
    if (${JSON.stringify(mode)} === 'cold') {
      T.useMessageStore.getState().removeConversationState(convId)
    }
    await sleep(300)
    return await recordOpen(convId, ${durationMs}, () => select(convId))
  `,
    durationMs + 20000
  )
}

/** How long the transcript stayed transparent while the opening settled. */
function hiddenSpan(samples) {
  const hidden = samples.filter((s) => s.current && s.hidden)
  return hidden.length ? hidden[hidden.length - 1].t - hidden[0].t : 0
}

/** Summarize one open's timeline. */
function analyze(samples) {
  if (samples.some((s) => s.windowHidden)) {
    return { ok: false, invalid: true, reason: 'window was hidden during the open' }
  }
  const painted = samples.filter(
    (s) => s.current && s.painted !== false && !s.hidden && s.rows > 0 && s.targetTop !== null
  )
  if (painted.length === 0) return { ok: false, reason: 'target never painted', samples: samples.length }
  const err = (s) => Math.abs(s.targetTop - TOP_INSET)
  const first = painted[0]
  // Landing: the first sample from which every later sample is on target
  let landedIdx = -1
  for (let i = painted.length - 1; i >= 0; i--) {
    if (err(painted[i]) > TOLERANCE) break
    landedIdx = i
  }
  const firstOnTarget = painted.findIndex((s) => err(s) <= TOLERANCE)
  const wrongFramesBeforeLanding =
    landedIdx < 0 ? painted.length : painted.slice(0, landedIdx).filter((s) => err(s) > TOLERANCE).length
  // Movement after the first time it was on target (snap-backs)
  const movedAfterFirstLanding =
    firstOnTarget < 0 ? 0 : painted.slice(firstOnTarget).filter((s) => err(s) > TOLERANCE).length
  const last = painted[painted.length - 1]
  return {
    ok: landedIdx >= 0 && movedAfterFirstLanding === 0,
    firstPaintMs: first.t,
    firstPaintError: Math.round(err(first) * 10) / 10,
    landedMs: landedIdx >= 0 ? painted[landedIdx].t : null,
    wrongFramesBeforeLanding,
    movedAfterFirstLanding,
    finalError: Math.round(err(last) * 10) / 10,
    finalScrollTop: last.scrollTop,
    scrollHeight: last.scrollHeight,
    clientHeight: last.clientHeight,
    msgs: last.msgs,
    rows: last.rows,
    hiddenMs: hiddenSpan(samples),
  }
}

const median = (xs) => {
  const v = xs.filter((x) => x !== null).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}

async function runMatrix() {
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())
  if (!health.ok) throw new Error('automation endpoint not healthy')

  let ids = []
  if (args.recent) ids.push(...(await listConversations(Number(args.recent))))
  if (args.extra) {
    const extra = await resolveIds(args.extra.split(','))
    extra.forEach((id, i) => {
      if (!id) console.warn(`no conversation matches ${args.extra.split(',')[i]}`)
    })
    ids.push(...extra.filter(Boolean))
  }
  if (args.ids) ids.push(...args.ids.split(','))
  ids = [...new Set(ids)]
  if (ids.length < 2) throw new Error('need at least two conversations (one serves as neutral)')

  const results = []
  for (const size of sizes.length ? sizes : ['current']) {
    if (size !== 'current') await setWindow(size)
    for (const convId of ids) {
      const neutralId = ids.find((id) => id !== convId)
      for (const mode of modes) {
        for (let run = 0; run < repeat; run++) {
          let samples
          let summary
          // An open made while the window was hidden says nothing: retry it
          for (let attempt = 0; attempt < 5; attempt++) {
            samples = await measureOpen(convId, neutralId, mode)
            summary = analyze(samples)
            if (!summary.invalid) break
            console.log(`SKIP ${size} ${convId.slice(0, 8)} ${mode} #${run + 1}: window hidden, retrying`)
            await waitVisible()
          }
          results.push({ size, convId, mode, run, summary, samples })
          const tag = summary.ok ? 'PASS' : 'FAIL'
          console.log(
            `${tag} ${size} ${convId.slice(0, 8)} ${mode} #${run + 1}: ` +
              (summary.reason ??
                `first paint ${summary.firstPaintMs}ms err ${summary.firstPaintError}px, ` +
                  `landed ${summary.landedMs ?? '-'}ms, wrong frames ${summary.wrongFramesBeforeLanding}, ` +
                  `moved after landing ${summary.movedAfterFirstLanding}, final err ${summary.finalError}px, ` +
                  `hidden ${summary.hiddenMs}ms ` +
                  `(msgs ${summary.msgs}, rows ${summary.rows}, h ${summary.scrollHeight}/${summary.clientHeight})`)
          )
        }
      }
    }
  }

  console.log('\nSummary (per size / conversation / mode)')
  const groups = new Map()
  for (const r of results) {
    const key = `${r.size} ${r.convId.slice(0, 8)} ${r.mode}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r.summary)
  }
  for (const [key, list] of groups) {
    const passed = list.filter((s) => s.ok).length
    console.log(
      `${key}: ${passed}/${list.length} pass, median landed ${median(list.map((s) => s.landedMs ?? null))}ms, ` +
        `max wrong frames ${Math.max(...list.map((s) => s.wrongFramesBeforeLanding ?? 0))}, ` +
        `worst final err ${Math.max(...list.map((s) => s.finalError ?? 999))}px`
    )
  }

  mkdirSync('/tmp/chatshell-uitest', { recursive: true })
  const out = `/tmp/chatshell-uitest/open-positioning-${Date.now()}.json`
  writeFileSync(out, JSON.stringify(results, null, 1))
  console.log(`\nRaw timelines: ${out}`)
  process.exitCode = results.every((r) => r.summary.ok) ? 0 : 1
}

async function runWatch() {
  // Install a page-side recorder that samples every conversation switch,
  // then print each recorded open as it completes.
  await evalJs(`${PAGE_HELPERS}
    if (!window.__uiOpenLog) {
      window.__uiOpenLog = []
      let previous = T.useConversationStore.getState().currentConversation?.id
      T.useConversationStore.subscribe((state) => {
        const id = state.currentConversation?.id
        if (!id || id === previous) return
        previous = id
        const entry = { convId: id, samples: null }
        window.__uiOpenLog.push(entry)
        recordOpen(id, ${durationMs}, async () => {}).then((s) => { entry.samples = s })
      })
    }
    return true
  `)
  console.log('Watching: open conversations by hand in the app (Ctrl-C to stop)')
  let printed = 0
  for (;;) {
    const log = await evalJs(`return (window.__uiOpenLog ?? []).filter((e) => e.samples)`)
    for (; printed < log.length; printed++) {
      const { convId, samples } = log[printed]
      const s = analyze(samples)
      console.log(
        `${s.ok ? 'PASS' : 'FAIL'} hand ${convId.slice(0, 8)}: ` +
          (s.reason ??
            `first paint ${s.firstPaintMs}ms err ${s.firstPaintError}px, landed ${s.landedMs ?? '-'}ms, ` +
              `wrong frames ${s.wrongFramesBeforeLanding}, moved after landing ${s.movedAfterFirstLanding}, ` +
              `final err ${s.finalError}px`)
      )
    }
    await sleep(1000)
  }
}

;(args.watch ? runWatch() : runMatrix()).catch((error) => {
  console.error(error)
  process.exitCode = 2
})
