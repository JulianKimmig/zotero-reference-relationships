/** Literal typed contributor values with bounded pages and independently abortable DOM ownership. */
import { element } from './dom.mjs';
import { ruleButton } from './rule-controls.mjs';

/** Format exact present primitive fields without coercing absence or interpreting markup. @param {object} metadata Valid primitive values. @returns {string} Stable literal field/value text. */
export function literalValues(metadata) {
  return Object.entries(metadata).map(([field, value]) => `${field}: ${JSON.stringify(value)}`).join(' · ');
}

/** Render every manual/support value through pages of 25 contributors. @param {object} options {document,parent,cluster,t,signal}. @returns {void} */
export function contributorValues({ document, parent, cluster, t, signal }) {
  const entries = [...cluster.assertions.map(root => ({ text: `${t('manual')}: ${root.id}`, metadata: root.metadata })),
    ...cluster.supports.map(support => ({ text: `${t('root-assertion')}: ${support.root} · ${support.rule} · ${t('version')} ${support.version}`, metadata: support.metadata }))];
  const body = element(document, 'div'), controls = element(document, 'div'); parent.append(body, controls); let offset = 0;
  const owner = { document, t, signal };
  const previous = ruleButton(owner, 'previous', 'values-previous', () => { offset -= 25; render(); });
  const next = ruleButton(owner, 'next', 'values-next', () => { offset += 25; render(); });
  controls.append(previous, next); controls.hidden = entries.length <= 25;
  /** Render exact values for a bounded contributor page. @returns {void} */
  function render() {
    body.replaceChildren(); previous.disabled = offset === 0; next.disabled = offset + 25 >= entries.length;
    for (const entry of entries.slice(offset, offset + 25)) body.append(element(document, 'p', {}, `${entry.text} · ${literalValues(entry.metadata)}`));
  }
  render();
}
