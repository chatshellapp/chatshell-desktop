#!/usr/bin/env node
// Compiles the Icon Composer source (src-tauri/icons/AppIcon.icon) into
// Assets.car plus a grid-compliant AppIcon.icns fallback for macOS < 26.
// The outputs are copied into the app bundle via bundle.macOS.files and
// referenced by CFBundleIconName / CFBundleIconFile in src-tauri/Info.plist.
//
// Runs as Tauri's beforeBundleCommand. No-op on non-macOS hosts.
// Requires Xcode 26+ (actool must understand the .icon format).

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  process.exit(0)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = join(root, 'src-tauri')
const source = join(tauriDir, 'icons', 'AppIcon.icon')
const outDir = join(tauriDir, 'icons', 'macos')

const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))
const minimumSystemVersion = conf.bundle?.macOS?.minimumSystemVersion ?? '10.13'

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

try {
  execFileSync(
    'xcrun',
    [
      'actool',
      source,
      '--compile',
      outDir,
      '--output-format',
      'human-readable-text',
      '--warnings',
      '--errors',
      '--output-partial-info-plist',
      join(outDir, 'partial.plist'),
      '--app-icon',
      'AppIcon',
      '--include-all-app-icons',
      '--enable-on-demand-resources',
      'NO',
      '--development-region',
      'en',
      '--target-device',
      'mac',
      '--minimum-deployment-target',
      minimumSystemVersion,
      '--platform',
      'macosx',
    ],
    { stdio: 'inherit' },
  )
} catch (err) {
  console.error('actool failed to compile AppIcon.icon. Xcode 26 or newer is required.')
  throw err
}

for (const file of ['Assets.car', 'AppIcon.icns']) {
  if (!existsSync(join(outDir, file))) {
    console.error(`actool did not produce ${file}. Xcode 26 or newer is required.`)
    process.exit(1)
  }
}
