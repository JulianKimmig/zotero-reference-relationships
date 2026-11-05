/** Bounded literal original assertion evidence for explicit multi-original removal review. */
import { element } from './dom.mts';
import { ruleButton } from './rule-controls.mts';
import { literalValues } from './contributor-values.mts';
import type { Assertion } from '../domain/contracts.mts';
import type { PreviewOwner } from './contracts.mts';

/** Render every selected original identity, physical endpoint and value through pages of 25. @param {object} options {view,parent,originals,signal}. @returns {void} Controls belong to the caller's abort scope. */
export function originalValues({ view, parent, originals, signal }: { view: PreviewOwner; parent: HTMLElement; originals: Assertion[]; signal: AbortSignal }): void {
  const { document, t } = view, body = element(document, 'div'), controls = element(document, 'div');
  parent.append(body, controls); let offset = 0;
  const owner = { document, t, signal };
  const previous = ruleButton(owner, 'previous', 'removed-originals-previous', () => { offset -= 25; render(); });
  const next = ruleButton(owner, 'next', 'removed-originals-next', () => { offset += 25; render(); });
  controls.append(previous, next); controls.hidden = originals.length <= 25;
  /** Render exact original values without interpreting user markup. @returns {void} */
  function render() {
    body.replaceChildren(); previous.disabled = offset === 0; next.disabled = offset + 25 >= originals.length;
    for (const root of originals.slice(offset, offset + 25)) {
      const card = element(document, 'section', { 'data-rr-removed-original': root.id });
      card.append(element(document, 'p', {}, `${root.id}: ${root.source.key} → ${root.type} → ${root.target.key}`),
        element(document, 'p', {}, literalValues(root.metadata))); body.append(card);
    }
  }
  render();
}
