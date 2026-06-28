// ─── Modal/toast dùng chung — mọi popup trong app đi qua đây ───
const modalRoot = document.getElementById('modal-root');

function closeModal() {
  modalRoot.innerHTML = '';
  modalRoot.classList.remove('open');
  document.removeEventListener('keydown', onModalKeydown);
}

function onModalKeydown(e) {
  if (e.key === 'Escape') closeModal();
}

// opts: { title, bodyHtml, footerHtml, onMount(panelEl), size: 'sm'|'md'|'lg' }
function openModal(opts = {}) {
  const { title = '', bodyHtml = '', footerHtml = '', onMount, size = 'md' } = opts;
  modalRoot.innerHTML = `
    <div class="modal-overlay" data-modal-close>
      <div class="modal-panel modal-${size}" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h2>${title}</h2>
          <button type="button" class="icon-btn" data-modal-close aria-label="Đóng">${icon('close', 16)}</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      </div>
    </div>`;
  modalRoot.classList.add('open');

  modalRoot.querySelectorAll('[data-modal-close]').forEach(el => {
    el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  });
  document.addEventListener('keydown', onModalKeydown);

  const panel = modalRoot.querySelector('.modal-panel');
  if (onMount) onMount(panel);
  return panel;
}

function confirmModal(message, { title = 'Xác nhận', confirmLabel = 'Xác nhận', danger = true } = {}) {
  return new Promise(resolve => {
    openModal({
      title,
      bodyHtml: `<p class="modal-text">${message}</p>`,
      footerHtml: `
        <button type="button" class="btn-secondary" data-act="cancel">Huỷ</button>
        <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm">${confirmLabel}</button>`,
      onMount: (panel) => {
        panel.querySelector('[data-act="cancel"]').onclick = () => { closeModal(); resolve(false); };
        panel.querySelector('[data-act="confirm"]').onclick = () => { closeModal(); resolve(true); };
      },
    });
  });
}

let toastTimer = null;
function toast(message, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
