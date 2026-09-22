// ============================================================
// The detail dialog a card opens.
//
// Materials and Recipes both open one, and the plumbing is the
// same: a native modal <dialog>, a close button, Esc and a
// backdrop click to leave, and a body that repaints whenever the
// store changes underneath it.  What goes in the body, and what
// its buttons do, is the view's business.
//
//   const detail = detailDialog({
//     render: (id) => html | null,   // null: the thing is gone, close
//     onClick: (event) => {},        // anything but the close button
//   });
//   detail.open(id); detail.refresh(); detail.destroy();
//
// The rendered body must give its heading id="detail-title" and
// its close button data-close.  Any button that should keep focus
// across a repaint carries a data-key naming it.
// ============================================================

export function detailDialog({ render, onClick = () => {} }) {
  // On <body>, not inside the view: the view is an aria-live region,
  // and every refresh of an open dialog would be read out again.
  const dialog = document.createElement('dialog');
  dialog.className = 'detail';
  dialog.setAttribute('aria-labelledby', 'detail-title');

  // Only the body is repainted: the undo toast moves into the dialog
  // while it is open, and must not be wiped along with the content.
  const body = document.createElement('div');
  body.className = 'detail-body';
  dialog.append(body);
  document.body.append(dialog);

  let current = null;

  function paint() {
    const html = render(current);
    if (html == null) { dialog.close(); return; }

    // The button just pressed is replaced by the repaint, so put the
    // focus back on its successor rather than losing it to <body>.
    const focused = document.activeElement;
    const key = dialog.contains(focused) ? focused.dataset.key : null;

    body.innerHTML = html;

    if (key) {
      const again = body.querySelector(`[data-key="${CSS.escape(key)}"]`);
      (again && !again.disabled ? again : body.querySelector('[data-close]'))?.focus();
    }
  }

  dialog.addEventListener('close', () => {
    current = null;
    body.innerHTML = '';
  });

  dialog.addEventListener('click', (event) => {
    // A click on the backdrop lands on the <dialog> itself: the body
    // inside it covers every pixel of the box.
    if (event.target === dialog || event.target.closest('[data-close]')) {
      dialog.close();
      return;
    }
    onClick(event);
  });

  return {
    open(id) {
      current = id;
      paint();
      if (!dialog.open) dialog.showModal();
      body.querySelector('[data-close]')?.focus();
    },

    /** Repaint if open -- called on every store change. */
    refresh() {
      if (dialog.open) paint();
    },

    destroy() {
      // `close` fires a task later, after the dialog is gone, so the
      // toast it would have sent home is rescued by hand first.
      const note = document.getElementById('toast');
      if (note && dialog.contains(note)) document.body.append(note);
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}

/**
 * Whether a click on a card should open it: always from its name,
 * and from anywhere else unless the click ended a text selection --
 * that is someone copying a name, not asking for more.
 */
export function opensCard(event) {
  return Boolean(event.target.closest('[data-open]')) || !String(getSelection());
}
