// Closed or non-modal panels do not count: the OpenUI devtools, for example,
// keep their drawers in the DOM as inert role="dialog" asides with
// aria-modal="false".
const BLOCKING_DIALOG_SELECTOR =
  ':is([role="dialog"], [role="alertdialog"]):not([inert]):not([aria-modal="false"])'

/** Whether an open dialog should keep global shortcuts from acting behind it */
export function hasBlockingDialog(root: ParentNode = document): boolean {
  return root.querySelector(BLOCKING_DIALOG_SELECTOR) !== null
}
