// A game may replace the floating controls only for the exact call it owns.
// Missing/hidden/unready game UI must leave the global escape controls intact.
export function hasVisibleMafiaCallControls(document, call) {
  if (!document || call?.scope !== 'mafia' || !call.id) return false;
  const usable = node => {
    if (node.closest('[hidden], [aria-hidden="true"], [inert]') || !node.getClientRects().length) return false;
    for (let element = node; element; element = element.parentElement) {
      const style = document.defaultView?.getComputedStyle(element);
      if (style && (style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0')) return false;
    }
    return true;
  };
  return [...document.querySelectorAll('[data-mafia-call-controls]')].some(node =>
    node.isConnected && node.getAttribute('data-mafia-call-controls') === call.id &&
    node.getAttribute('data-mafia-controls-ready') === 'true' &&
    usable(node));
}
