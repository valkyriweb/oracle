import type { BrowserModelStrategy } from "../types.js";
import { buildClickDispatcher } from "./domEvents.js";

export function isAstraModelLabel(label: string): boolean {
  return /^(?:(?:gpt|chatgpt)[\s._-]*)?6(?:[\s._-]+astra)?$/i.test(label.trim());
}

export function isAstraSelectionLabel(label: string): boolean {
  return /^(?:(?:gpt|chatgpt)[\s._-]*)?6(?:[\s._-]+astra)?(?:\s*(?:pro|instant|medium|high|extra[ -]high))?$/i.test(
    label.trim(),
  );
}

/** Latest is a moving alias: require the observed version, not just its checked row. */
export function buildAstraModelSelectionExpression(strategy: BrowserModelStrategy): string {
  return `(async () => {
    ${buildClickDispatcher()}
    const matchesVersion = ${isAstraSelectionLabel.toString()};
    const visible = (node) => {
      if (!node || node.closest('[inert]')) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const findButton = () => Array.from(document.querySelectorAll(
      'main button.__composer-pill[aria-haspopup="menu"], button[data-testid="model-switcher-dropdown-button"]'
    )).find(node => visible(node) && /(?:^6|gpt|pro|instant|medium|high|thinking)/i.test(node.textContent.trim()));
    // While its menu is open, the composer pill temporarily reads "Thinking effort".
    // The picker view toggle retains the actual model + effort during that transition.
    const label = () => document.querySelector(
      '[data-testid="composer-intelligence-picker-content"] [role="menuitem"][aria-expanded]'
    )?.textContent?.trim() || findButton()?.textContent?.trim() || '';
    const button = findButton();
    if (!button) return { status: 'button-missing' };
    if (${JSON.stringify(strategy)} === 'current' || matchesVersion(label())) {
      return { status: 'already-selected', label: label() };
    }
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const deadline = performance.now() + 20000;
    const picker = () => Array.from(document.querySelectorAll(
      '[data-testid="composer-intelligence-picker-content"]'
    )).find(visible);
    const close = () => {
      if (findButton()?.getAttribute('aria-expanded') === 'true') dispatchClickSequence(findButton());
    };
    if (button.getAttribute('aria-expanded') !== 'true') dispatchClickSequence(button);
    while (!picker() && performance.now() < deadline) await sleep(100);
    let root = picker();
    if (!root) { close(); return { status: 'option-not-found' }; }
    const advanced = () => picker()?.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]');
    if (advanced()?.getAttribute('data-active') !== 'true') {
      // This is the model-list view toggle, not the Power keyboard owner.
      const toggle = root.querySelector('[role="menuitem"][aria-expanded]');
      if (!visible(toggle)) { close(); return { status: 'option-not-found' }; }
      dispatchClickSequence(toggle);
    }
    while ((!advanced() || !visible(advanced())) && performance.now() < deadline) await sleep(100);
    const rows = Array.from(advanced()?.querySelectorAll('[role="menuitemradio"]') ?? []).filter(visible);
    const option = rows.find(node => matchesVersion(node.textContent.trim())) ??
      rows.find(node => node.textContent.trim().toLowerCase() === 'latest');
    if (!option || option.getAttribute('aria-disabled') === 'true') {
      close();
      return { status: 'option-not-found', hint: { availableOptions: rows.map(node => node.textContent.trim()) } };
    }
    dispatchClickSequence(option);
    close();
    while (performance.now() < deadline) {
      if (matchesVersion(label())) {
        const observed = label();
        close();
        return { status: 'switched', label: observed };
      }
      await sleep(100);
    }
    const observed = label();
    close();
    return { status: 'option-not-found', hint: { availableOptions: [observed] } };
  })()`;
}
