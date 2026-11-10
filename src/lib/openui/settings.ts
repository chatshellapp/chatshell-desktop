/**
 * OpenUI chart and KPI blocks (```openui-lang fences): on unless the user
 * turns them off (`"false"`). The library section adds about 600 prompt
 * tokens to every request. Mirrors `RENDER_OPENUI_BLOCKS_SETTING` in
 * `src-tauri/src/commands/visual_output.rs`.
 */
export const RENDER_OPENUI_BLOCKS_SETTING = 'render_openui_blocks'

/** Fence info strings rendered as OpenUI blocks. */
export const OPENUI_FENCE_LANGUAGES = new Set(['openui-lang', 'openui'])

export function isOpenUiBlocksEnabled(value: string | undefined): boolean {
  return value !== 'false'
}
