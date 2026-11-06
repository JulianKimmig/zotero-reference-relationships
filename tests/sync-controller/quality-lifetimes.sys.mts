/** Native listener lifetime acceptance: real impact page flips, Explain show/hide and repeated owner teardown. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { LifetimeFixture, LifetimeObservation } from './quality-lifetimes-fixtures.sys.mts';
import { detachedObservation, lifetimeFixture, supportAction, withoutPublication } from './quality-lifetimes-fixtures.sys.mts';
import { impactLifetimes } from './quality-lifetimes-impact.sys.mts';
import { errorMessage, present } from './evidence.sys.mts';
import { applyOne } from './rules-fixtures.sys.mts';
import { check, click, until } from './ui-helpers.sys.mts';

/**
 * Exercise genuine generated explanations without replacing application reads or UI methods.
 * @param fixture Native view constructor, real saved graph, 26 genuine producing rules and host DOM.
 * @returns Hidden-explanation and repeated-disposal observations across three independent view lifetimes.
 */
async function explainLifetimes(fixture: LifetimeFixture): Promise<LifetimeObservation[]> {
  const observations: LifetimeObservation[] = [];
  for (let lifetime = 0; lifetime < 3; lifetime++) {
    const view = fixture.createView();
    try {
      view.select(fixture.books[0]); await view.render();
      check(view.root.dataset.rrState === 'ready', `Native Explain view did not render ready: ${fixture.errors.map(errorMessage).join('; ')}`);
      const row = present(view.root.querySelector<HTMLElement>('[data-rr-origin="generated"]'));
      const hidden: HTMLElement[] = [];
      for (let toggle = 0; toggle < 3; toggle++) {
        click(row, 'explain');
        const details = await until(fixture.api.Zotero, () => row.querySelector<HTMLElement>('[data-rr-provenance]'), 'native shown Explain panel');
        check(details.querySelectorAll('[data-rr-support]').length === 25, 'Explain did not bound the first support page');
        click(details, 'support-next');
        check(details.querySelectorAll('[data-rr-support]').length === 1, 'Live Explain Next lost the final actual support');
        click(details, 'support-previous');
        check(details.querySelectorAll('[data-rr-support]').length === 25, 'Live Explain Previous did not restore actual supports');
        const next = supportAction(details);
        click(row, 'explain');
        await until(fixture.api.Zotero, () => !row.querySelector('[data-rr-provenance]'), 'native hidden Explain panel');
        const current = view.root.innerHTML;
        observations.push(detachedObservation(details, next, `explain-hide-${lifetime}-${toggle}`, '[data-rr-support]'));
        check(view.root.innerHTML === current, 'Retired Explain controls changed the live relationship view');
        hidden.push(details);
      }
      click(row, 'explain');
      const visible = await until(fixture.api.Zotero, () => row.querySelector<HTMLElement>('[data-rr-provenance]'), 'Explain before repeated view disposal');
      check(visible.querySelectorAll('[data-rr-support]').length === 25, 'Reopened Explain inherited a retired page offset');
      view.dispose(); view.dispose();
      check(!view.root.isConnected, 'Repeated native view disposal left its DOM mounted');
      for (const [index, details] of [...hidden, visible].entries()) {
        observations.push(detachedObservation(details, supportAction(details), `explain-view-dispose-${lifetime}-${index}`, '[data-rr-support]'));
      }
      const html = row.innerHTML;
      present(row.querySelector<HTMLButtonElement>('[data-rr-action="explain"]')).click();
      await fixture.api.Zotero.Promise.delay(0);
      observations.push({ label: `explain-disposed-toggle-${lifetime}`, changed: row.innerHTML !== html,
        before: 1, after: row.querySelectorAll('[data-rr-provenance]').length });
    } finally { view.dispose(); view.dispose(); }
  }
  return observations;
}

/**
 * Run the bounded native lifetime suite; main owns routing, compilation, client launch and red/green evidence.
 * @param job Fresh anonymous native controller job carrying the production XPI and fixture marker.
 * @param api Real Gecko/Zotero capabilities supplied by the main controller.
 * @returns Complete behavioral observations when every retired handler is inert; otherwise throws all observed violations.
 */
export async function qualityLifetimes(job: ControllerJob, api: NativeAPI) {
  const fixture = await lifetimeFixture(job, api);
  try {
    const impact = await withoutPublication(fixture, () => impactLifetimes(fixture));
    await applyOne(api, fixture.rules);
    const explain = await withoutPublication(fixture, () => explainLifetimes(fixture));
    const observations = [...impact, ...explain], violations = observations.filter(observation => observation.changed);
    check(fixture.errors.length === 0, `Native lifetime UI errors: ${fixture.errors.map(errorMessage).join('; ')}`);
    check(violations.length === 0, `Retired native DOM handlers remain active: ${JSON.stringify(violations)}`);
    return { nativeDOM: true, realApplication: true, repeatedTeardown: true, noInteractionPublications: true, observations };
  } finally { fixture.dispose(); fixture.dispose(); }
}
