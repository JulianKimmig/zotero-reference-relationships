/** Named validation summaries receive focus only while the explicit action's original focus is still owned by its live form. */

/** Capture focus at an explicit user action without claiming a background callback or another window. @param root Current connected form. @returns Its actual focused element, or null when focus belongs elsewhere. */
export function formErrorOrigin(root: HTMLElement): Element | null {
  const document = root.ownerDocument, active = document.activeElement;
  return root.isConnected && document.hasFocus() && active && root.contains(active) ? active : null;
}

/** Clear both visible and accessible error text before a fresh review. @param error Owned validation summary. @returns No stale accessible name remains. */
export function clearFormError(error: HTMLElement): void {
  error.textContent = ''; error.removeAttribute('aria-label');
}

/** Expose the complete error and focus it only if the explicit action still owns focus. @param root Current form. @param error Owned alert summary. @param message Literal diagnostic. @param origin Focus captured at action start; null for background work. @returns Updated accessible error, preserving independent, inactive-window or retired-form focus. */
export function presentFormError(root: HTMLElement, error: HTMLElement, message: string, origin: Element | null): void {
  error.textContent = message; error.setAttribute('aria-label', message); error.tabIndex = -1;
  const document = root.ownerDocument;
  if (origin && root.isConnected && root.contains(error) && document.hasFocus() && document.activeElement === origin) error.focus();
}
