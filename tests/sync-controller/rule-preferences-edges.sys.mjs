/** Invalid, stale and in-flight rule UI previews must not publish; deletion retracts only generated effects. */
import { check, until, click, type } from './ui-helpers.sys.mjs';
import { checked } from './catalog-helpers.sys.mjs';
import { applyOne } from './rules-fixtures.sys.mjs';
import { openRule, fillRule, previewRule, saveRule, cancelRule, storedRule, sameAuthority } from './rule-preferences-helpers.sys.mjs';

/** Require rejected form review with disabled Save. @param {object} api Native API. @param {Element} editor Actual form. @returns {Promise<void>} */
async function invalid(api, editor) {
  click(editor, 'preview-rule');
  await until(api.Zotero, () => editor.querySelector('[role="alert"]').textContent, 'invalid rule error');
  check(editor.querySelector('[data-rr-action="save-rule"]').disabled, 'Invalid rule review enabled Save');
}

/** Exercise user-visible rejection and discard paths against real authority. @param {object} api Platform. @param {Window} window Native preferences. @param {Element} root Real pane. @returns {Promise<void>} */
export async function rulePreferenceEdges(api, window, root) {
  const app = api.Zotero.ReferenceRelationships.application;
  let before = await app.read('self'), editor = await openRule(api, root);
  fillRule(window, editor, { id: 'invalid-condition-ui' });
  click(editor, 'add-condition'); await invalid(api, editor);
  await sameAuthority(app, before); await cancelRule(api, root);
  editor = await openRule(api, root); fillRule(window, editor, { id: 'unknown-type-ui', inputType: 'missing' });
  await invalid(api, editor); await sameAuthority(app, before); await cancelRule(api, root);
  editor = await openRule(api, root, 'inverse-ui');
  checked(editor.querySelector('[data-rr-rule-field="enabled"]'), false); await previewRule(api, editor);
  const { version, ...conditional } = await storedRule(app, 'conditional-ui');
  await applyOne(api, await app.manageRules({ library: 'self', kind: 'update', rule: { ...conditional, enabled: false } }));
  before = await app.read('self');
  await until(api.Zotero, () => editor.querySelector('[data-rr-action="save-rule"]').disabled, 'native change invalidated preview');
  await invalid(api, editor); await sameAuthority(app, before); await cancelRule(api, root);
  editor = await openRule(api, root); fillRule(window, editor, { id: 'async-rule-ui' });
  let changed = false;
  const observer = new window.MutationObserver(() => {
    if (editor.getAttribute('aria-busy') !== 'true') return;
    observer.disconnect(); type(window, editor.querySelector('[data-rr-rule-field="id"]'), 'changed-during-preview'); changed = true;
  });
  observer.observe(editor, { attributes: true, attributeFilter: ['aria-busy'] });
  try {
    click(editor, 'preview-rule');
    await until(api.Zotero, () => changed && editor.getAttribute('aria-busy') === 'false', 'async rule edit');
    check(editor.querySelector('[data-rr-action="save-rule"]').disabled, 'Old async rule preview enabled Save');
    const review = await previewRule(api, editor);
    check(review.textContent.includes('changed-during-preview'), 'Review used old rule definition');
    await cancelRule(api, root); await sameAuthority(app, before);
  } finally { observer.disconnect(); }
  const symmetricRow = [...root.querySelectorAll('[data-rr-rule-id]')].find(row => row.dataset.rrRuleId === 'symmetric-ui');
  click(symmetricRow, 'delete-rule');
  editor = await until(api.Zotero, () => root.querySelector('[data-rr-rule-editor]'), 'delete rule review');
  let review = await previewRule(api, editor);
  check(Number(review.dataset.rrRemoved) === 1 && Number(review.dataset.rrUpdated) === 1, 'Delete rule omitted support retraction');
  await cancelRule(api, root); await sameAuthority(app, before);
  const row = [...root.querySelectorAll('[data-rr-rule-id]')].find(row => row.dataset.rrRuleId === 'symmetric-ui');
  click(row, 'delete-rule'); editor = await until(api.Zotero, () => root.querySelector('[data-rr-rule-editor]'), 'second delete review');
  review = await previewRule(api, editor); await saveRule(api, root);
  const final = await app.read('self');
  check(final.snapshot.assertions.some(assertion => assertion.type === 'similar') && !final.snapshot.rules.some(rule => rule.id === 'symmetric-ui'),
    'Rule deletion damaged manual assertion or retained declaration');
}
