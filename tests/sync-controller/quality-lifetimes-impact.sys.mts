/** Behavioral impact-page and preview-disposal regressions against real packaged rendering in native DOM. */
import type { LifetimeFixture, LifetimeObservation } from './quality-lifetimes-fixtures.sys.mts';
import { detachedObservation, supportAction } from './quality-lifetimes-fixtures.sys.mts';
import { present } from './evidence.sys.mts';
import { check, click, until } from './ui-helpers.sys.mts';

/**
 * Verify live support pagination before using its control to test retirement.
 * @param card Actual generated impact card containing 26 genuine supports.
 * @returns Enabled first-page Next button retained for the subsequent removal test.
 */
function exerciseSupports(card: HTMLElement): HTMLButtonElement {
  check(card.isConnected && card.querySelectorAll('[data-rr-support]').length === 25, 'Impact support first page is not bounded to 25');
  click(card, 'support-next');
  check(card.querySelectorAll('[data-rr-support]').length === 1, 'Live impact support Next did not reach the final contributor');
  click(card, 'support-previous');
  check(card.querySelectorAll('[data-rr-support]').length === 25, 'Live impact support Previous did not restore the first page');
  return supportAction(card);
}

/**
 * Observe removed contributor handlers while the containing preview remains live.
 * @param fixture Native production renderer, real review and localized host document.
 * @returns All page-flip, preview-disposal and parent-abort observations, collected before asserting failures.
 */
export async function impactLifetimes(fixture: LifetimeFixture): Promise<LifetimeObservation[]> {
  const observations: LifetimeObservation[] = [], { document, window, api } = fixture;
  for (let cycle = 0; cycle < 3; cycle++) {
    const parent = document.createElementNS('http://www.w3.org/1999/xhtml', 'section'); fixture.host.append(parent);
    const abort = new window.AbortController();
    const preview = await fixture.rulePreview({ view: fixture, parent, before: fixture.before, review: fixture.review,
      signal: abort.signal,
      /** Preserve genuine asynchronous page failures. @param error Native failure. @returns Completion. */
      onError(error: unknown) { fixture.errors.push(error); } });
    try {
      check(parent.querySelectorAll('[data-rr-impact]').length === 25, 'Live impact first page does not contain 25 edges');
      const retired = present(parent.querySelector<HTMLElement>('[data-rr-impact]')), next = exerciseSupports(retired);
      click(parent, 'impact-next');
      await until(api.Zotero, () => parent.getAttribute('aria-busy') === 'false', 'native final impact page');
      check(parent.querySelectorAll('[data-rr-impact]').length === 1, 'Live impact Next lost or duplicated affected edges');
      const current = parent.innerHTML;
      observations.push(detachedObservation(retired, next, `impact-page-flip-${cycle}`, '[data-rr-support]'));
      check(parent.innerHTML === current, 'Retired impact contributor changed the current preview');
      click(parent, 'impact-previous');
      await until(api.Zotero, () => parent.getAttribute('aria-busy') === 'false', 'native restored impact page');
      check(parent.querySelectorAll('[data-rr-impact]').length === 25, 'Live impact Previous did not restore 25 affected edges');
      const container = present(parent.firstElementChild) as HTMLElement;
      const disposedCard = present(parent.querySelector<HTMLElement>('[data-rr-impact]'));
      const disposedSupport = exerciseSupports(disposedCard);
      const outerNext = present(parent.querySelector<HTMLButtonElement>('[data-rr-action="impact-next"]'));
      preview.dispose(); preview.dispose();
      check(!abort.signal.aborted, 'Preview disposal test accidentally aborted the containing editor first');
      observations.push(detachedObservation(disposedCard, disposedSupport, `impact-preview-dispose-support-${cycle}`, '[data-rr-support]'));
      observations.push(detachedObservation(container, outerNext, `impact-preview-dispose-paging-${cycle}`, '[data-rr-impact]'));
      check(parent.childElementCount === 0, 'Disposed preview remounted itself after a retired click');
      abort.abort(); abort.abort(); preview.dispose();
      observations.push(detachedObservation(retired, supportAction(retired), `impact-parent-abort-old-page-${cycle}`, '[data-rr-support]'));
      observations.push(detachedObservation(disposedCard, supportAction(disposedCard), `impact-parent-abort-disposed-preview-${cycle}`, '[data-rr-support]'));
    } finally { abort.abort(); preview.dispose(); preview.dispose(); parent.remove(); }
  }
  return observations;
}
