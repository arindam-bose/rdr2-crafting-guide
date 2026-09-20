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

  element.textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismiss();
      action.run();
    });
    element.append(button);
  }

  element.hidden = false;
  timer = setTimeout(dismiss, action?.duration ?? DURATION);
}

export function dismiss() {
  clearTimeout(timer);
  if (element) element.hidden = true;
}
