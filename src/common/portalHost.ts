/**
 * Where a popup anchored to `anchor` portals: the `<dialog>` the anchor sits
 * in, else document.body.
 *
 * A modal dialog is in the top layer and makes everything outside it inert, so
 * a popup portaled to document.body from inside one would paint underneath the
 * dialog and ignore the pointer and keyboard. Inside the dialog it stays above
 * it and live. `position: fixed` still places it against the viewport there,
 * since the dialog sets no transform, filter or containment.
 */
export function portalHost(anchor: Element | null | undefined): Element {
  return anchor?.closest('dialog') ?? document.body;
}
