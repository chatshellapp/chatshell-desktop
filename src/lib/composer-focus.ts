/**
 * Ask the chat composer to take focus. Used when an action (e.g. "new
 * conversation" while the empty draft is already open) does not change the
 * current conversation, so the composer's own focus-on-change effect would
 * not fire.
 */
export const COMPOSER_FOCUS_EVENT = 'chatshell:composer-focus'

export function requestComposerFocus() {
  window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT))
}
