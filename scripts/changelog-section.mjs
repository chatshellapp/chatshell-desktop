#!/usr/bin/env node
// Prints one release section of CHANGELOG.md (Keep a Changelog format).
//
// The release workflow uses this as the single source for the GitHub release
// body and the updater feed notes, and fails the release when the section is
// missing, undated, or empty.
//
// Usage:
//   node scripts/changelog-section.mjs --version 0.9.1 [--file CHANGELOG.md]
//                                      [--github] [--output notes.md]
//
//   --github   Append the compare link ("Full Changelog") for the release page.
//   --output   Write to a file instead of stdout.

import { readFileSync, writeFileSync } from 'node:fs'

const REPO_URL = 'https://github.com/chatshellapp/chatshell-desktop'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const flag = (name) => args.includes(`--${name}`)

const version = arg('version')?.replace(/^v/, '')
const file = arg('file') ?? 'CHANGELOG.md'
const output = arg('output')

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: changelog-section.mjs --version X.Y.Z [--file CHANGELOG.md] [--github] [--output <file>]')
  process.exit(2)
}

const fail = (message) => {
  console.error(`::error file=${file}::${message}`)
  process.exit(1)
}

const lines = readFileSync(file, 'utf8').split('\n')
const releaseHeading = /^## \[([^\]]+)\](?:\s+-\s+(\S+))?\s*$/
const linkDefinition = /^\[[^\]]+\]:\s+\S+/

const start = lines.findIndex((line) => releaseHeading.exec(line)?.[1] === version)
if (start === -1) {
  fail(`No "## [${version}] - YYYY-MM-DD" section. Move the Unreleased entries under a heading for this version before tagging.`)
}

const date = releaseHeading.exec(lines[start])[2]
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  fail(`The ${version} heading needs a release date: "## [${version}] - YYYY-MM-DD".`)
}

let end = start + 1
while (end < lines.length && !releaseHeading.test(lines[end]) && !linkDefinition.test(lines[end])) {
  end++
}

const body = lines.slice(start + 1, end).join('\n').trim()
if (!body.split('\n').some((line) => /^\s*[-*]\s+\S/.test(line))) {
  fail(`The ${version} section has no entries.`)
}

let notes = body
if (flag('github')) {
  const previous = lines
    .slice(end)
    .map((line) => releaseHeading.exec(line)?.[1])
    .find((v) => v && /^\d+\.\d+\.\d+$/.test(v))
  const link = previous
    ? `${REPO_URL}/compare/v${previous}...v${version}`
    : `${REPO_URL}/commits/v${version}`
  notes += `\n\n**Full Changelog**: ${link}`
}

if (output) {
  writeFileSync(output, `${notes}\n`)
  console.error(`Wrote ${version} notes to ${output}`)
} else {
  process.stdout.write(`${notes}\n`)
}
