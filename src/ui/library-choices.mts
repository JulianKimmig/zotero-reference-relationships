/** Live native library choices retain an explicit unavailable selection instead of choosing another owner. */
import { element } from './dom.mts';
import type { ItemGateway, ZoteroPlatform } from '../adapters/native-contracts.mts';
import type { Localizer } from './contracts.mts';

/** Rebuild actual personal/group choices and retain the exact requested scope. @param {object} options {Zotero,gateway,document,select,selected,t}. @returns {object|null} Actual selected native owner or null when unavailable; native lookup failures propagate. */
export function libraryChoices({ Zotero, gateway, document, select, selected, t }: {
  Zotero: ZoteroPlatform; gateway: ItemGateway; document: Document; select: HTMLSelectElement; selected: string; t: Localizer;
}) {
  const rows = Zotero.Libraries.getAll().filter(owner => ['user', 'group'].includes(owner.libraryType))
    .map(owner => ({ owner, scope: gateway.scope(owner.libraryID) }));
  select.replaceChildren(...rows.map(({ owner, scope }) => element(document, 'option', { value: scope }, owner.name)));
  const current = rows.find(row => row.scope === selected);
  if (!current) select.append(element(document, 'option', { value: selected, disabled: true }, `${selected} · ${t('unavailable')}`));
  select.value = selected;
  return current ? current.owner : null;
}
