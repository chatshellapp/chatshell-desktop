#!/usr/bin/env node
// Assembles the Tauri updater feed (latest.json) from the per-platform
// updater artifacts produced by the release build jobs
// (bundle.createUpdaterArtifacts=true + TAURI_SIGNING_PRIVATE_KEY).
//
// Artifact download URLs point at the first-party dl.chatshell.app mirror,
// matching the R2 layout the release job uploads to:
//   /v<version>/{windows/x86_64,darwin/universal,linux/x86_64}/<file>
//
// The macOS universal build serves both darwin-x86_64 and darwin-aarch64.
//
// Usage:
//   node scripts/finalize-latest-json.mjs --release-dir release [--output release/latest.json] [--notes "..."]
//
// Exits non-zero when the expected artifacts are missing or ambiguous, so a
// malformed feed can never ship.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const args = process.argv.slice(2)

const arg = (name) => {
  const index = args.indexOf(`--${name}`)
  return index !== -1 ? args[index + 1] : undefined
}

const releaseDir = arg('release-dir')
const output = arg('output') ?? join(releaseDir ?? '.', 'latest.json')
const notes = arg('notes')

if (!releaseDir) {
  console.error('Usage: finalize-latest-json.mjs --release-dir <dir> [--output <file>] [--notes <text>]')
  process.exit(1)
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })

const files = walk(releaseDir)
const sigFiles = files.filter((file) => file.endsWith('.sig'))

const findOne = (pattern, label) => {
  const matches = sigFiles.filter((file) => pattern.test(basename(file)))
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${label} .sig artifact under ${releaseDir}, found ${matches.length}` +
        (matches.length > 1 ? `: ${matches.map((m) => basename(m)).join(', ')}` : '')
    )
  }
  return matches[0]
}

const windowsSig = findOne(/^ChatShell_.*_x64_en-US\.msi\.sig$/, 'Windows MSI')
const macosSig = findOne(/^ChatShell\.app\.tar\.gz\.sig$/, 'macOS app archive')
const linuxSig = findOne(/^ChatShell_.*_amd64\.AppImage\.sig$/, 'Linux AppImage')

const versionMatch = basename(windowsSig).match(/^ChatShell_(\d+\.\d+\.\d+)_/)
if (!versionMatch) throw new Error(`Cannot parse version from ${basename(windowsSig)}`)
const version = versionMatch[1]

// dl.chatshell.app directories the release job uploads these files to.
const platforms = {
  'windows-x86_64': 'windows/x86_64',
  darwin: 'darwin/universal',
  'linux-x86_64': 'linux/x86_64',
}

const entry = (sigFile, r2Directory) => ({
  signature: readFileSync(sigFile, 'utf8').trim(),
  url: `https://dl.chatshell.app/v${version}/${r2Directory}/${basename(sigFile).replace(/\.sig$/, '')}`,
})

const macosEntry = entry(macosSig, platforms.darwin)

const feed = {
  version,
  notes: notes ?? `ChatShell v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': entry(windowsSig, platforms['windows-x86_64']),
    'darwin-x86_64': macosEntry,
    'darwin-aarch64': macosEntry,
    'linux-x86_64': entry(linuxSig, platforms['linux-x86_64']),
  },
}

writeFileSync(output, `${JSON.stringify(feed, null, 2)}\n`)
console.log(`Wrote ${output} for v${version}`)
console.log(`  windows-x86_64  -> ${feed.platforms['windows-x86_64'].url}`)
console.log(`  darwin-*        -> ${macosEntry.url}`)
console.log(`  linux-x86_64    -> ${feed.platforms['linux-x86_64'].url}`)
