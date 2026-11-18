const selector = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]';
export function visibleFocusTargets(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(element => {
    if (element.matches(':disabled') || element.closest('fieldset:disabled,[inert],[hidden]')) return false;
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ visibilityProperty: true })) return false;
    if (!element.getClientRects().length) return false;
    // Some browser engines retain rectangles for inputs inside closed details.
    // Only the first summary (and its children) remains visible in that case.
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName !== 'DETAILS' || ancestor.hasAttribute('open')) continue;
      const summary = Array.from(ancestor.children).find(child => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
    return true;
  });
}
