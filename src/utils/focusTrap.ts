// Keyboard containment for the app's two dialogs.
//
// Both Modal and the library's StudyModal grew their own copy of "query the
// panel for focusables, wrap at the edges", and both copies were wrong in the
// same two ways. This is the one place that answers "what can the user Tab to
// inside this dialog right now", so a fix lands for every dialog at once.

/** `summary` is in the list because a <details> disclosure is a focus stop, and
 *  neither previous copy included it — Tab skipped straight past the control
 *  that opens the section. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface CheckVisibility {
  checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean;
}

/**
 * Whether an element can actually take focus right now.
 *
 * The two obvious tests are both WRONG for content inside a CLOSED <details>,
 * measured in Chrome: a link in one reports `offsetParent === <body>` and TWO
 * client rects. So `offsetParent !== null` (what Modal used) and
 * `getClientRects().length > 0` each call it visible, and Tab lands on a link
 * the user cannot see. `checkVisibility()` is the only predicate that gets all
 * four cases right at once:
 *
 *   closed <details> child  offsetParent BODY · rects 2 · checkVisibility false
 *   display:none            offsetParent null · rects 0 · checkVisibility false
 *   position:fixed          offsetParent DIV  · rects 1 · checkVisibility true
 *   plain visible node      offsetParent DIV  · rects 1 · checkVisibility true
 *
 * position:fixed is the case that rules out simply keeping offsetParent: the
 * quality checklist popover is fixed, so an offsetParent filter would drop it
 * even once it is in the sequence.
 *
 * jsdom implements neither layout nor checkVisibility, so the fallback answers
 * the same question from the DOM alone — which keeps the trap testable without
 * mocking layout primitives.
 */
function isFocusable(el: HTMLElement): boolean {
  const check = (el as HTMLElement & CheckVisibility).checkVisibility;
  if (typeof check === 'function') return check.call(el, { visibilityProperty: true });
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden || node.style.display === 'none') return false;
    // A closed <details> hides everything it contains EXCEPT its own summary.
    if (node instanceof HTMLDetailsElement && !node.open
      && !(el.tagName === 'SUMMARY' && el.parentElement === node)) return false;
  }
  return true;
}

/** Push `el` and anything focusable inside it, in document order. */
function collect(el: HTMLElement, into: HTMLElement[]): void {
  if (!isFocusable(el)) return;
  if (el.matches(FOCUSABLE_SELECTOR)) into.push(el);
  for (const inner of el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (isFocusable(inner)) into.push(inner);
  }
}

/**
 * Everything the user can Tab to inside `root`, in keyboard order, including
 * popovers that `root` owns but does not contain.
 *
 * A dialog's keyboard order is not the same as its subtree. QualityBadge
 * portals its checklist into document.body so the popover can escape the
 * record's scrolling body without being clipped — but that checklist and its
 * close button are still part of the dialog, and a subtree-only query leaves
 * them out, so Tab walks off the end of the trap and onto the page behind the
 * modal. The `aria-controls` the trigger already publishes is the standard
 * statement of that ownership, so the sequence follows it and splices the
 * popover's controls in right after their trigger.
 */
export function focusableSequence(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (!isFocusable(el)) continue;
    out.push(el);
    const ownedId = el.getAttribute('aria-controls');
    if (!ownedId) continue;
    // getElementById, NOT querySelector: React's useId() mints ids like ":r7:",
    // which are a syntax error in a CSS id selector but a perfectly ordinary
    // getElementById argument.
    const owned = document.getElementById(ownedId);
    if (owned && !root.contains(owned)) collect(owned, out);
  }
  return out;
}

/** The shape both callers share: Modal's native KeyboardEvent and StudyModal's
 *  React synthetic one. */
interface TabKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

/**
 * Keep Tab inside `container`, wrapping at both edges.
 *
 * `container` itself counts as an edge in BOTH directions, because it holds
 * focus on mount (tabIndex={-1}) and after any in-dialog navigation that moves
 * focus to a heading — so the first Tab or Shift+Tab from it has to enter the
 * trapped set rather than escape to the page behind.
 *
 * Must be attached as a REACT onKeyDown, not a native listener: React's
 * synthetic events propagate through the component tree, so a keypress inside a
 * portaled popover still reaches the dialog that owns it. A native listener
 * follows the DOM tree, where the portal is a sibling of the dialog and its
 * keystrokes never arrive.
 */
export function trapTab(event: TabKeyEvent, container: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const els = focusableSequence(container);
  // No focusable children at all (defensive — every dialog renders a close
  // button): hold focus on the container rather than letting Tab escape.
  if (!els.length) { event.preventDefault(); container.focus(); return; }
  const first = els[0];
  const last = els[els.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === container)) {
    event.preventDefault();
    first.focus();
  } else {
    if (!(active instanceof HTMLElement)) return;
    const index = els.indexOf(active);
    if (index < 0) return;
    const next = els[index + (event.shiftKey ? -1 : 1)];
    // A body portal is outside the dialog's native Tab order. Follow the
    // logical sequence both when entering it and when returning to the dialog.
    if (!container.contains(active) || !container.contains(next)) {
      event.preventDefault();
      next.focus();
    }
  }
}
