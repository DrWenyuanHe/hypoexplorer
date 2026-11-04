import { describe, it, expect, afterEach } from 'vitest';
import { focusableSequence } from '../utils/focusTrap';

// The keyboard order of a dialog, which is NOT the same as its subtree.
//
// Both dialogs used to compute this themselves and both were wrong in the same
// two ways: they skipped <summary>, and they counted content inside a CLOSED
// <details> as reachable. The second one is not obvious — measured in Chrome, a
// link inside a closed disclosure reports offsetParent === <body> and TWO client
// rects, so neither of the usual visibility tests catches it and Tab lands on a
// link the user cannot see.
//
// jsdom has no layout and no checkVisibility(), so these exercise the DOM
// fallback. That is the point: the fallback answers the same question without
// mocking layout primitives, which is what makes the trap testable at all.

// Every mounted host is drained in afterEach rather than at the end of each
// test. A trailing `host.remove()` never runs when an expect throws, and these
// hosts are not RTL containers so RTL's auto-cleanup does not reach them — so
// one genuine failure used to leak its ids (`popover`, `:r7:`, `inline`) into
// document.body, where focusableSequence's getElementById lookup would find
// them and cascade into unrelated failures.
const mounted: HTMLElement[] = [];
afterEach(() => { for (const el of mounted.splice(0)) el.remove(); });

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  mounted.push(host);
  return host;
}

describe('focusableSequence', () => {
  it('includes a <summary> — a disclosure is a focus stop', () => {
    const host = mount('<details><summary id="s">More</summary><p>body</p></details>');
    expect(focusableSequence(host).map((el) => el.id)).toEqual(['s']);
  });

  it('excludes content inside a closed <details> but keeps its summary', () => {
    const host = mount(
      '<details><summary id="s">More</summary><a id="buried" href="#x">link</a></details>',
    );
    const ids = focusableSequence(host).map((el) => el.id);
    expect(ids).toContain('s');
    expect(ids).not.toContain('buried');
  });

  it('includes that content once the disclosure is open', () => {
    const host = mount(
      '<details open><summary id="s">More</summary><a id="shown" href="#x">link</a></details>',
    );
    expect(focusableSequence(host).map((el) => el.id)).toEqual(['s', 'shown']);
  });

  it('skips hidden and display:none elements', () => {
    const host = mount(
      '<button id="ok">ok</button><button id="h" hidden>h</button>'
      + '<div style="display:none"><a id="dn" href="#y">dn</a></div>',
    );
    expect(focusableSequence(host).map((el) => el.id)).toEqual(['ok']);
  });

  it('splices in a popover the dialog owns but does not contain', () => {
    // QualityBadge portals its checklist into document.body so it can escape the
    // record's scrolling body without being clipped. The checklist's close button
    // is still part of the dialog's keyboard order; a subtree-only query leaves it
    // out and Tab walks off the end of the trap onto the page behind.
    const host = mount('<button id="trigger" aria-controls="popover">badge</button><button id="after">after</button>');
    mount('<section id="popover"><button id="close">x</button><a id="doc" href="#z">doc</a></section>');
    expect(focusableSequence(host).map((el) => el.id))
      .toEqual(['trigger', 'close', 'doc', 'after']);
  });

  it('resolves an aria-controls id that React useId() would mint', () => {
    // useId() produces ids like ":r7:", which are a syntax error in a CSS id
    // selector. getElementById takes them without complaint; querySelector throws.
    const host = mount('<button id="trigger" aria-controls=":r7:">badge</button>');
    mount('<section id=":r7:"><button id="close">x</button></section>');
    expect(() => focusableSequence(host)).not.toThrow();
    expect(focusableSequence(host).map((el) => el.id)).toEqual(['trigger', 'close']);
  });

  it('does not double-count a popover that is already inside the dialog', () => {
    const host = mount(
      '<button id="trigger" aria-controls="inline">badge</button>'
      + '<section id="inline"><button id="close">x</button></section>',
    );
    expect(focusableSequence(host).map((el) => el.id)).toEqual(['trigger', 'close']);
  });

  it('ignores an aria-controls pointing at nothing', () => {
    const host = mount('<button id="trigger" aria-controls="gone">badge</button>');
    expect(focusableSequence(host).map((el) => el.id)).toEqual(['trigger']);
  });

  it('skips disabled controls', () => {
    const host = mount('<button id="a">a</button><button id="b" disabled>b</button>');
    expect(focusableSequence(host).map((el) => el.id)).toEqual(['a']);
  });
});
