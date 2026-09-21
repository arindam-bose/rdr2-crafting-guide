// ============================================================
// The undo toast.
//
// Inventory entry has no save button — every tap is a ledger row
// the moment you make it.  This is what makes that safe: one tap
// to put it back.
// ============================================================

const DURATION = 6000;

let element = null;
let timer = null;

/**
 * Show a message, optionally with one action.
 *
 *   toast('Added 1 Perfect Beaver Pelt', { label: 'Undo', run: () => … })
 */
export function toast(message, action = null) {
  element ??= document.getElementById('toast');
  clearTimeout(timer);

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  element.replaceChildren(text);

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      action.run();
    });
    element.append(button);
  }

  // A way out that does not depend on waiting.
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = 'x';
  close.addEventListener('click', dismiss);
  element.append(close);

  element.hidden = false;
  timer = setTimeout(dismiss, action?.duration ?? DURATION);
}

function dismiss() {
  clearTimeout(timer);
  if (element) element.hidden = true;
}
