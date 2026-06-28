// Phải khớp 1:1 với config.js (COLS/STATUS) ở backend — nhân bản nhỏ vì frontend không import được file Node.
const COLS = {
  TASK_NAME: 'Task', SKU: 'Tên sản phẩm / SKU', MO_TA_CHI_TIET: 'Mô tả chi tiết',
  TRANG_THAI: 'Trạng thái', NGUOI_GIAO: 'Người giao', NGUOI_THUC_HIEN: 'Người thực hiện', DEADLINE: 'Deadline',
};
const STATUS = {
  CHO_GAN: 'Chờ gán người thực hiện', DANG_CHO: 'Đang chờ', DANG_LAM: 'Đang làm',
  CHO_CHECK: 'Chờ check', HOAN_THANH: 'Hoàn thành',
};
const STATUS_DOT = {
  [STATUS.CHO_GAN]: 'warn', [STATUS.DANG_CHO]: 'idle', [STATUS.DANG_LAM]: 'warn',
  [STATUS.CHO_CHECK]: 'warn', [STATUS.HOAN_THANH]: 'ok',
};

const mainEl = document.getElementById('main');
const navEl = document.getElementById('nav');
let state = { roles: [], tab: null, pendingAttachments: [] };

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function userName(val) { return val?.[0]?.name || 'N/A'; }
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;'); }

const ROLE_LABEL = { admin: 'ADMIN', sale: 'SALE', media: 'MEDIA' };
const ROLE_RANK = { admin: 3, sale: 2, media: 1 };
function highestRoleLabel(roles) {
  const top = [...roles].sort((a, b) => (ROLE_RANK[b] || 0) - (ROLE_RANK[a] || 0))[0];
  return ROLE_LABEL[top] || '';
}
// Tên hay có dạng "丁皇俊英 (Dustin)" — ưu tiên lấy chữ đầu trong dấu ngoặc (tên tiếng Anh dễ đọc hơn).
function initials(name) {
  const paren = (name || '').match(/\(([^)]+)\)/)?.[1];
  const source = (paren || name || '?').trim();
  return source[0]?.toUpperCase() || '?';
}

function grid(html) { return `<div class="grid">${html}</div>`; }
function statusPill(status) {
  return `<span class="status-pill"><span class="status-dot ${STATUS_DOT[status] || ''}"></span>${status || '—'}</span>`;
}
// ID hiện trước tên task trong mọi card, ví dụ "01-Lật hình sản phẩm".
function taskLabel(t) {
  return `${String(t.record_id).padStart(2, '0')}-${t.fields[COLS.TASK_NAME] || 'N/A'}`;
}
function attachmentsHtml(t) {
  const list = t.attachments || [];
  if (list.length === 0) return '';
  if (list.length === 1) {
    return `<div class="meta">${icon('paperclip', 14)}<a href="${list[0].url}" target="_blank" rel="noopener">Xem file đính kèm</a></div>`;
  }
  return `<div class="meta">${icon('paperclip', 14)}${list.map((a, i) => `<a href="${a.url}" target="_blank" rel="noopener">File ${i + 1}</a>`).join(', ')}</div>`;
}

const TAB_ICON = {
  create: 'send', sent: 'file', mine: 'check', pending: 'clock', workload: 'users',
  completed: 'check', users: 'user', templates: 'template', uploads: 'paperclip',
};

function setNav(tabs) {
  navEl.innerHTML = '';
  tabs.forEach(t => {
    const btn = document.createElement('button');
    btn.title = t.label;
    btn.innerHTML = `${icon(TAB_ICON[t.key] || 'file', 15)}<span class="label">${t.label}</span>`;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.className = state.tab === t.key ? 'active' : '';
    btn.onclick = () => { state.tab = t.key; render(); };
    navEl.appendChild(btn);
  });
}

// opts: { actionsHtml, titleActionsHtml, person: 'giao'|'thuchien'|'none', showStatus, showMota }
function taskCard(t, opts = {}) {
  const { actionsHtml = '', titleActionsHtml = '', person = 'none', showStatus = true, showMota = false } = opts;
  const f = t.fields;
  let personLine = '';
  if (person === 'giao') personLine = `<div class="meta">${icon('user', 14)}Người giao: ${userName(f[COLS.NGUOI_GIAO])}</div>`;
  else if (person === 'thuchien') personLine = `<div class="meta">${icon('user', 14)}Người thực hiện: ${userName(f[COLS.NGUOI_THUC_HIEN])}</div>`;

  return `
    <div class="card" data-id="${t.record_id}">
      <div class="card-title-row">
        <h3>${taskLabel(t)}</h3>
        ${titleActionsHtml ? `<div class="icon-actions">${titleActionsHtml}</div>` : ''}
      </div>
      <div class="meta">SKU: ${f[COLS.SKU] || 'N/A'}</div>
      ${personLine}
      <div class="meta">${icon('calendar', 14)}Deadline: ${fmtDate(f[COLS.DEADLINE])}${showStatus ? ` &nbsp;${statusPill(f[COLS.TRANG_THAI])}` : ''}</div>
      ${showMota && f[COLS.MO_TA_CHI_TIET] ? `<div class="note">${f[COLS.MO_TA_CHI_TIET]}</div>` : ''}
      ${attachmentsHtml(t)}
      ${actionsHtml}
    </div>`;
}

function iconBtn(name, label) {
  return `<button type="button" class="icon-btn" data-act="${name}" title="${label}">${icon(name === 'edit-status' || name === 'edit' || name === 'edit-tpl' || name === 'edit-user' ? 'edit' : name.includes('delete') ? 'trash' : name, 16)}</button>`;
}

// ─── Modal: sửa trạng thái task (Media) ───
function openEditStatusModal(t, onSaved) {
  const current = t.fields[COLS.TRANG_THAI];
  const options = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK, STATUS.HOAN_THANH]
    .map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('');

  openModal({
    title: `Sửa trạng thái: ${taskLabel(t)}`,
    bodyHtml: `
      <label>Trạng thái</label>
      <select data-edit="status">${options}</select>
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      panel.querySelector('[data-act="save"]').onclick = async () => {
        const errEl = panel.querySelector('[data-form-error]');
        try {
          await window.Api.updateStatus(t.record_id, panel.querySelector('[data-edit="status"]').value);
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      };
    },
  });
}

async function renderMyTasks() {
  const tasks = await window.Api.getMyTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">Không có task nào.</div>'; return; }
  mainEl.innerHTML = grid(tasks.map(t => {
    const status = t.fields[COLS.TRANG_THAI];
    let action = '';
    if (status === STATUS.DANG_CHO) action = `<button class="btn-primary" data-act="start">${icon('arrowRight', 15)}Bắt đầu làm</button>`;
    else if (status === STATUS.DANG_LAM) action = `<button class="btn-secondary" data-act="pending-check">${icon('clock', 15)}Chờ check</button>`;
    return taskCard(t, { actionsHtml: action ? `<div class="actions">${action}</div>` : '', titleActionsHtml: iconBtn('edit-status', 'Sửa trạng thái'), person: 'giao', showMota: true });
  }).join(''));

  mainEl.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="start"]')?.addEventListener('click', async () => { await window.Api.startTask(id); renderMyTasks(); });
    card.querySelector('[data-act="pending-check"]')?.addEventListener('click', async () => { await window.Api.pendingCheck(id); renderMyTasks(); });
    card.querySelector('[data-act="edit-status"]')?.addEventListener('click', () => {
      openEditStatusModal(tasks.find(t => t.record_id === id), renderMyTasks);
    });
  });
}

// ─── Modal: sửa nội dung task (Sale) ───
function openEditTaskModal(t, onSaved) {
  const f = t.fields;
  const deadlineVal = f[COLS.DEADLINE] ? new Date(Number(f[COLS.DEADLINE])).toISOString().slice(0, 10) : '';

  openModal({
    title: `Sửa task: ${taskLabel(t)}`,
    bodyHtml: `
      <label>Yêu cầu</label>
      <input data-edit="taskName" maxlength="50" value="${esc(f[COLS.TASK_NAME])}" />
      <label>SKU</label>
      <input data-edit="sku" value="${esc(f[COLS.SKU])}" />
      <label>Mô tả chi tiết</label>
      <textarea data-edit="moTaChiTiet" rows="3">${f[COLS.MO_TA_CHI_TIET] || ''}</textarea>
      <label>Deadline</label>
      <input type="date" data-edit="deadline" value="${deadlineVal}" />
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      panel.querySelector('[data-act="save"]').onclick = async () => {
        const errEl = panel.querySelector('[data-form-error]');
        const deadlineVal2 = panel.querySelector('[data-edit="deadline"]').value;
        try {
          await window.Api.updateTask(t.record_id, {
            taskName: panel.querySelector('[data-edit="taskName"]').value,
            sku: panel.querySelector('[data-edit="sku"]').value,
            moTaChiTiet: panel.querySelector('[data-edit="moTaChiTiet"]').value,
            deadline: deadlineVal2 ? new Date(deadlineVal2).getTime() : null,
          });
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      };
    },
  });
}

async function renderSentTasks() {
  const tasks = await window.Api.getSentTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">Không có task nào.</div>'; return; }
  mainEl.innerHTML = grid(tasks.map(t => {
    const status = t.fields[COLS.TRANG_THAI];
    const completeBtn = status === STATUS.CHO_CHECK ? `<div class="actions"><button class="btn-primary" data-act="complete">${icon('check', 15)}Hoàn thành</button></div>` : '';
    const titleActionsHtml = iconBtn('edit', 'Sửa') + iconBtn('delete', 'Xoá');
    return taskCard(t, { actionsHtml: completeBtn, titleActionsHtml, person: 'thuchien', showMota: true });
  }).join(''));

  mainEl.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="complete"]')?.addEventListener('click', async () => {
      await window.Api.completeTask(id); renderSentTasks();
    });
    card.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      if (!(await confirmModal('Xoá task này? Không thể hoàn tác.'))) return;
      await window.Api.deleteTask(id); renderSentTasks();
    });
    card.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
      openEditTaskModal(tasks.find(t => t.record_id === id), renderSentTasks);
    });
  });
}

// ─── Modal: gán người thực hiện (Admin) ───
function openAssignModal(t, mediaMembers, onSaved) {
  const options = mediaMembers.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  openModal({
    title: `Gán: ${taskLabel(t)}`,
    bodyHtml: `
      <label>Người thực hiện</label>
      <select data-f="assignee"><option value="">Chọn người thực hiện...</option>${options}</select>
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="confirm">${icon('check', 15)}Xác nhận</button>`,
    onMount: (panel) => {
      panel.querySelector('[data-act="confirm"]').onclick = async () => {
        const val = panel.querySelector('[data-f="assignee"]').value;
        const errEl = panel.querySelector('[data-form-error]');
        if (!val) { errEl.textContent = 'Chọn người thực hiện trước'; return; }
        try {
          await window.Api.assignTask(t.record_id, val);
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      };
    },
  });
}

async function renderPendingTasks() {
  const [tasks, members] = await Promise.all([window.Api.getPendingTasks(), window.Api.getTeamMembers()]);
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">Không có task chờ gán.</div>'; return; }
  const mediaMembers = members.filter(m => (m.roles || []).includes('media'));
  mainEl.innerHTML = grid(tasks.map(t => {
    const actionsHtml = `<div class="actions"><button class="btn-primary" data-act="assign">${icon('users', 15)}Gán người thực hiện</button></div>`;
    return taskCard(t, { actionsHtml, person: 'giao', showStatus: false, showMota: true });
  }).join(''));

  mainEl.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="assign"]').onclick = () => {
      openAssignModal(tasks.find(t => t.record_id === id), mediaMembers, renderPendingTasks);
    };
  });
}

// ─── Modal: chi tiết task của 1 người (Workload) ───
async function openWorkloadDetailModal(member) {
  openModal({ title: `Task của ${member.name}`, bodyHtml: '<p class="modal-text">Đang tải...</p>' });
  const tasks = await window.Api.getTasksByMedia(member.id);
  const bodyHtml = tasks.length === 0
    ? '<p class="modal-text">Không có task đang xử lý.</p>'
    : tasks.map(t => `<div class="meta" style="margin-bottom:6px;">• ${taskLabel(t)} ${statusPill(t.fields[COLS.TRANG_THAI])} — ${fmtDate(t.fields[COLS.DEADLINE])}</div>`).join('');
  openModal({ title: `Task của ${member.name}`, bodyHtml });
}

async function renderWorkload() {
  const workload = await window.Api.getWorkload();
  if (workload.length === 0) { mainEl.innerHTML = '<div class="empty">Team không có task nào.</div>'; return; }
  mainEl.innerHTML = grid(workload.map(m => `
    <div class="card" data-id="${m.id}">
      <h3 class="clickable" data-act="show-detail">${m.name}</h3>
      <div class="meta">Đang chờ: ${m.dang_cho} · Đang làm: ${m.dang_lam} · Chờ check: ${m.cho_check}</div>
      <div class="meta"><b>Tổng: ${m.total}</b></div>
    </div>`).join(''));

  mainEl.querySelectorAll('.card').forEach(card => {
    card.querySelector('[data-act="show-detail"]').onclick = () => {
      const m = workload.find(x => x.id === card.dataset.id);
      openWorkloadDetailModal(m);
    };
  });
}

function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}

async function renderCompleted() {
  if (!state.completedFilters) state.completedFilters = { month: currentMonthStr(), senderId: '' };
  const isAdmin = state.roles.includes('admin');

  const senderOptionsHtml = isAdmin
    ? (await window.Api.getTeamMembers()).filter(m => (m.roles || []).includes('sale'))
        .map(m => `<option value="${m.id}" ${state.completedFilters.senderId === m.id ? 'selected' : ''}>${m.name}</option>`).join('')
    : '';

  const filterBarHtml = `
    <div class="card" style="margin-bottom: 12px; flex-direction: row; flex-wrap: wrap; align-items: flex-end; gap: 12px;">
      <div><label>Tháng</label><input type="month" id="filter-month" value="${state.completedFilters.month}" /></div>
      ${isAdmin ? `<div><label>Người gửi</label><select id="filter-sender"><option value="">Tất cả</option>${senderOptionsHtml}</select></div>` : ''}
    </div>`;

  const tasks = await window.Api.getCompletedTasks({
    month: state.completedFilters.month,
    ...(state.completedFilters.senderId ? { senderId: state.completedFilters.senderId } : {}),
  });

  const listHtml = tasks.length === 0
    ? '<div class="empty">Chưa có task hoàn thành.</div>'
    : grid(tasks.map(t => `
      <div class="card">
        <h3>${taskLabel(t)}</h3>
        <div class="meta">SKU: ${t.fields[COLS.SKU]}</div>
        <div class="meta">${icon('user', 14)}${userName(t.fields[COLS.NGUOI_GIAO])} → ${userName(t.fields[COLS.NGUOI_THUC_HIEN])}</div>
        <div class="meta">${icon('calendar', 14)}Giao: ${fmtDate(new Date(t.created_at).getTime())} · Xong: ${t.completed_at ? fmtDate(new Date(t.completed_at).getTime()) : '—'}</div>
        ${t.fields[COLS.MO_TA_CHI_TIET] ? `<div class="note">${t.fields[COLS.MO_TA_CHI_TIET]}</div>` : ''}
        ${attachmentsHtml(t)}
      </div>`).join(''));

  mainEl.innerHTML = filterBarHtml + listHtml;

  document.getElementById('filter-month').onchange = (e) => {
    state.completedFilters.month = e.target.value;
    renderCompleted();
  };
  const senderSel = document.getElementById('filter-sender');
  if (senderSel) senderSel.onchange = (e) => { state.completedFilters.senderId = e.target.value; renderCompleted(); };
}

function renderAttachmentList() {
  const wrap = document.getElementById('attachment-list');
  if (!wrap) return;
  wrap.innerHTML = state.pendingAttachments.map((a, i) => `
    <div class="meta" style="justify-content:space-between;">
      <span>${icon('file', 14)}${a.name}</span>
      <button type="button" class="icon-btn" data-remove-attachment="${i}" title="Bỏ file">${icon('close', 14)}</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-remove-attachment]').forEach(btn => {
    btn.onclick = () => {
      state.pendingAttachments.splice(Number(btn.dataset.removeAttachment), 1);
      renderAttachmentList();
    };
  });
}

let pasteListener = null;

async function renderCreateForm() {
  const members = await window.Api.getTeamMembers();
  const options = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  mainEl.innerHTML = `
    <form id="create-form">
      <label>Người giao (không bắt buộc)</label>
      <select name="nguoiGiaoId"><option value="">-- Chọn người giao --</option>${options}</select>
      <div class="hint">Để trống nếu chính bạn là người giao task này.</div>

      <label>Yêu cầu *</label>
      <div class="input-counter-wrap">
        <input name="taskName" id="task-name-input" required maxlength="50" placeholder="Ghi yêu cầu ngắn gọn (Lật hình)" />
        <span class="char-counter" id="task-name-counter">0/50</span>
      </div>

      <label>Tên sản phẩm / SKU *</label>
      <input name="sku" required placeholder="Nếu nhiều SKU thì ghi ngắn gọn (KBA-804X)" />

      <label>Mô tả chi tiết (không bắt buộc)</label>
      <textarea name="moTaChiTiet" rows="4" placeholder="Mô tả chi tiết task hoặc lưu ý khi làm task."></textarea>

      <label>Deadline *</label>
      <input type="date" name="deadline" required />

      <label>File gốc (không bắt buộc)</label>
      <div class="drop-zone" id="drop-zone">${icon('upload', 18)}<div>Dán hoặc kéo ảnh/tệp vào đây, hoặc bấm để chọn file (chọn được nhiều file)</div></div>
      <input type="file" id="file-input" multiple style="display:none" />
      <div class="hint" id="file-status"></div>
      <div id="attachment-list" style="margin-top:6px;"></div>

      <div class="error" id="form-error"></div>
      <div class="actions" style="margin-top:14px;">
        <button class="btn-primary" type="submit">${icon('send', 15)}Gửi task</button>
      </div>
    </form>`;

  const form = document.getElementById('create-form');

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileStatus = document.getElementById('file-status');
  state.pendingAttachments = [];
  renderAttachmentList();

  const taskNameInput = document.getElementById('task-name-input');
  const taskNameCounter = document.getElementById('task-name-counter');
  const updateCounter = () => taskNameCounter.textContent = `${taskNameInput.value.length}/50`;
  taskNameInput.addEventListener('input', updateCounter);
  updateCounter();

  async function handleFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (files.length === 0) return;
    fileStatus.textContent = `Đang tải lên ${files.length} file...`;
    try {
      for (const file of files) {
        const { attachmentUrl } = await window.Api.uploadFile(file);
        state.pendingAttachments.push({ url: attachmentUrl, name: file.name });
      }
      fileStatus.textContent = '';
      renderAttachmentList();
    } catch (err) {
      fileStatus.textContent = `Tải file lỗi: ${err.message}`;
    }
  }
  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => handleFiles(fileInput.files);
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
  dropZone.ondragleave = () => dropZone.classList.remove('dragover');
  dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); };

  if (pasteListener) document.removeEventListener('paste', pasteListener);
  pasteListener = (e) => {
    const items = [...e.clipboardData.items].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
    if (items.length) handleFiles(items);
  };
  document.addEventListener('paste', pasteListener);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('form-error');
    errEl.textContent = '';
    const fd = new FormData(form);
    const deadlineStr = fd.get('deadline');
    try {
      await window.Api.createTask({
        taskName: fd.get('taskName'),
        sku: fd.get('sku'),
        moTaChiTiet: fd.get('moTaChiTiet'),
        deadline: deadlineStr ? new Date(deadlineStr).getTime() : null,
        nguoiGiaoId: fd.get('nguoiGiaoId') || undefined,
        attachments: state.pendingAttachments,
      });
      form.reset();
      state.pendingAttachments = [];
      fileStatus.textContent = '';
      renderAttachmentList();
      updateCounter();
      toast('Đã gửi task!', 'success');
    } catch (err) {
      errEl.textContent = err.message;
    }
  };
}

// ─── Quản lý người (admin) ───────────────────────────────────────────
const ALL_ROLES = ['admin', 'sale', 'media'];

function userRolesCheckboxes(checked = []) {
  return ALL_ROLES.map(r => `
    <label style="display:inline-flex; align-items:center; gap:4px; font-weight:400; margin-right:14px;">
      <input type="checkbox" value="${r}" ${checked.includes(r) ? 'checked' : ''} style="width:auto; margin:0;" /> ${ROLE_LABEL[r]}
    </label>`).join('');
}

function openUserModal(u, onSaved) {
  openModal({
    title: u ? 'Sửa người dùng' : 'Thêm người',
    bodyHtml: `
      <label>Open ID${u ? '' : ' (lấy bằng cách nhắn "hi" cho bot lần đầu)'}</label>
      <input data-f="openId" value="${u ? u.id : ''}" ${u ? 'disabled' : ''} placeholder="ou_xxxxxxxx" />
      <label>Tên đầy đủ</label>
      <input data-f="name" value="${u ? esc(u.name) : ''}" placeholder="丁皇俊英 (Dustin)" />
      <label>Vị trí</label>
      <div data-f="roles">${userRolesCheckboxes(u ? u.roles : [])}</div>
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      panel.querySelector('[data-act="save"]').onclick = async () => {
        const errEl = panel.querySelector('[data-form-error]');
        const roles = [...panel.querySelectorAll('[data-f="roles"] input:checked')].map(i => i.value);
        const name = panel.querySelector('[data-f="name"]').value.trim();
        if (!name || !roles.length) { errEl.textContent = 'Cần tên và ít nhất 1 vị trí'; return; }
        try {
          if (u) {
            await window.Api.updateUser(u.id, { name, roles });
          } else {
            const openId = panel.querySelector('[data-f="openId"]').value.trim();
            if (!openId) { errEl.textContent = 'Cần Open ID'; return; }
            await window.Api.createUser({ openId, name, roles });
          }
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      };
    },
  });
}

async function renderUsers() {
  const users = await window.Api.getUsers();
  mainEl.innerHTML = `
    <div class="actions" style="margin-bottom:12px;"><button class="btn-primary" data-act="add-user">${icon('plus', 15)}Thêm người</button></div>
    ${grid(users.map(u => `
      <div class="card" data-id="${u.id}">
        <div class="card-title-row">
          <h3>${u.name}</h3>
          <div class="icon-actions">${iconBtn('edit-user', 'Sửa')}${iconBtn('delete-user', 'Xoá')}</div>
        </div>
        <div class="meta">${(u.roles || []).map(r => ROLE_LABEL[r] || r).join(', ') || '—'}</div>
      </div>`).join(''))}`;

  document.querySelector('[data-act="add-user"]').onclick = () => openUserModal(null, renderUsers);
  mainEl.querySelectorAll('.card[data-id]').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="edit-user"]').onclick = () => openUserModal(users.find(x => x.id === id), renderUsers);
    card.querySelector('[data-act="delete-user"]').onclick = async () => {
      if (!(await confirmModal('Xoá người dùng này? Họ sẽ không thể đăng nhập/nhận thông báo nữa.'))) return;
      try { await window.Api.deleteUser(id); renderUsers(); } catch (err) { toast(err.message, 'error'); }
    };
  });
}

// ─── Quản lý mẫu tin nhắn (admin) ─────────────────────────────────────
function openTemplateModal(variables, tpl, onSaved) {
  const helpHtml = `<div class="hint">Biến dùng được: ${variables.map(v => `$${v}`).join(', ')}</div>`;
  openModal({
    title: tpl ? 'Sửa mẫu tin nhắn' : 'Thêm mẫu tin nhắn',
    size: 'lg',
    bodyHtml: `
      ${tpl ? '' : '<label>Tiêu đề</label><input data-f="title" placeholder="VD: Nhắc deadline" />'}
      <label>Nội dung</label>
      <textarea data-f="content" rows="5">${tpl ? tpl.content : ''}</textarea>
      ${helpHtml}
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      panel.querySelector('[data-act="save"]').onclick = async () => {
        const errEl = panel.querySelector('[data-form-error]');
        const content = panel.querySelector('[data-f="content"]').value.trim();
        if (!content) { errEl.textContent = 'Cần nội dung'; return; }
        try {
          if (tpl) {
            await window.Api.updateMessageTemplate(tpl.key, { content });
          } else {
            const title = panel.querySelector('[data-f="title"]').value.trim();
            if (!title) { errEl.textContent = 'Cần tiêu đề'; return; }
            await window.Api.createMessageTemplate({ title, content });
          }
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      };
    },
  });
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function openSettingsModal(s) {
  const activeDays = (s.morning_report_days || '').split(',');
  const timeVal = `${String(s.morning_report_hour).padStart(2, '0')}:${String(s.morning_report_minute).padStart(2, '0')}`;

  openModal({
    title: 'Cài đặt báo cáo sáng',
    bodyHtml: `
      <label>Giờ gửi</label>
      <input type="time" id="set-time" value="${timeVal}">
      <label>Ngày gửi trong tuần</label>
      <div id="set-days" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        ${DAY_LABELS.map((label, idx) => `
          <div class="day-chip ${activeDays.includes(String(idx)) ? 'active' : ''}" data-day="${idx}">${label}</div>
        `).join('')}
      </div>
      <label>Đối tượng gửi báo cáo Admin</label>
      <select id="set-target">
        <option value="individual" ${s.morning_report_target === 'individual' ? 'selected' : ''}>Gửi riêng từng Admin</option>
        <option value="group" ${s.morning_report_target === 'group' ? 'selected' : ''}>Gửi vào 1 group chat</option>
      </select>
      <label>Chat ID của group (chỉ dùng khi chọn "Gửi vào group")</label>
      <input type="text" id="set-chatid" placeholder="oc_xxxxxxxx" value="${s.morning_report_group_chat_id || ''}">
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save-settings">${icon('check', 15)}Lưu cài đặt</button>`,
    onMount: (panel) => {
      panel.querySelectorAll('#set-days .day-chip').forEach(chip => {
        chip.onclick = () => chip.classList.toggle('active');
      });
      panel.querySelector('[data-act="save-settings"]').onclick = async () => {
        const errEl = panel.querySelector('[data-form-error]');
        const [hour, minute] = panel.querySelector('#set-time').value.split(':');
        const days = Array.from(panel.querySelectorAll('#set-days .day-chip.active')).map(c => c.dataset.day).join(',');
        try {
          await window.Api.updateSettings({
            morning_report_hour: hour,
            morning_report_minute: minute,
            morning_report_days: days,
            morning_report_target: panel.querySelector('#set-target').value,
            morning_report_group_chat_id: panel.querySelector('#set-chatid').value,
          });
          closeModal();
          toast('Đã lưu cài đặt', 'success');
        } catch (err) { errEl.textContent = err.message; }
      };
    },
  });
}

async function renderTemplates() {
  const [{ templates, variables }, settings] = await Promise.all([
    window.Api.getMessageTemplates(),
    window.Api.getSettings(),
  ]);

  // Gom theo cụm (bước) để dễ quản lý/thêm-bớt: mỗi bước tối đa 3 mẫu (Sale/Media/Admin).
  const groups = [];
  const groupIndex = {};
  templates.forEach(t => {
    if (!(t.group in groupIndex)) { groupIndex[t.group] = groups.length; groups.push({ name: t.group, items: [] }); }
    groups[groupIndex[t.group]].items.push(t);
  });

  mainEl.innerHTML = `
    <div class="actions" style="margin-bottom:12px;">
      <button class="btn-primary" data-act="add-tpl">${icon('plus', 15)}Thêm mẫu tin nhắn</button>
      <button class="btn-secondary" data-act="open-settings">${icon('settings', 15)}Cài đặt báo cáo sáng</button>
    </div>
    ${groups.map(g => `
      <h3 style="margin:20px 0 8px; font-size:13px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.03em;">${g.name}</h3>
      ${grid(g.items.map(t => `
        <div class="card" data-key="${t.key}">
          <div class="card-title-row">
            <h3>${t.title}${t.is_system ? ' <span class="meta" style="display:inline;">(hệ thống)</span>' : ''}</h3>
            <div class="icon-actions">${iconBtn('edit-tpl', 'Sửa')}${t.is_system ? '' : iconBtn('delete-tpl', 'Xoá')}</div>
          </div>
          <div class="note">${t.content || '<i>(trống — không gửi)</i>'}</div>
        </div>`).join(''))}`).join('')}`;

  document.querySelector('[data-act="open-settings"]').onclick = () => openSettingsModal(settings);
  document.querySelector('[data-act="add-tpl"]').onclick = () => openTemplateModal(variables, null, renderTemplates);
  mainEl.querySelectorAll('.card[data-key]').forEach(card => {
    const key = card.dataset.key;
    card.querySelector('[data-act="edit-tpl"]').onclick = () => openTemplateModal(variables, templates.find(x => x.key === key), renderTemplates);
    card.querySelector('[data-act="delete-tpl"]')?.addEventListener('click', async () => {
      if (!(await confirmModal('Xoá mẫu tin nhắn này?'))) return;
      try { await window.Api.deleteMessageTemplate(key); renderTemplates(); } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ─── Quản lý file đính kèm đã lưu trên volume (admin dọn dẹp định kỳ) ───
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function uploadGroupHtml(groupKey, titleHtml, files) {
  return `
    <div class="card">
      <div class="card-title-row">
        <h3 style="display:flex;align-items:center;gap:8px;flex:1;">
          <input type="checkbox" class="group-checkbox" data-group-check="${groupKey}" style="width:auto;margin:0;flex-shrink:0;">
          <span>${titleHtml}</span>
        </h3>
        <span class="meta">${files.length} file</span>
      </div>
      ${files.map(f => `
        <label class="meta" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" class="file-checkbox" data-filename="${f.name}" data-group="${groupKey}" style="width:auto;margin:0;flex-shrink:0;">
          <a href="${f.url}" target="_blank" rel="noopener" style="flex:1;word-break:break-all;">${f.name}</a>
          <span>${fmtSize(f.size)}</span>
        </label>`).join('')}
    </div>`;
}

async function renderUploads() {
  const { groups, orphans } = await window.Api.listUploads();
  if (groups.length === 0 && orphans.length === 0) { mainEl.innerHTML = '<div class="empty">Chưa có file nào.</div>'; return; }

  const allFiles = [...groups.flatMap(g => g.files), ...orphans];
  const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);

  const groupsHtml = groups.map(g => uploadGroupHtml(String(g.taskId), `${String(g.taskId).padStart(2, '0')}-${g.taskName}`, g.files)).join('');
  const orphansHtml = orphans.length ? uploadGroupHtml('orphan', 'Không thuộc task nào', orphans) : '';

  mainEl.innerHTML = `
    <div class="meta" style="margin-bottom:12px;">${allFiles.length} file — ${fmtSize(totalBytes)}</div>
    <div class="card" id="bulk-bar" style="display:none; flex-direction:row; align-items:center; justify-content:space-between; margin-bottom:12px; position:sticky; top:8px; z-index:10;">
      <span class="meta" id="selected-count"></span>
      <button class="btn-danger" id="bulk-delete">${icon('trash', 15)}Xoá đã chọn</button>
    </div>
    ${grid(groupsHtml + orphansHtml)}`;

  function updateBulkBar() {
    const checked = mainEl.querySelectorAll('.file-checkbox:checked');
    document.getElementById('bulk-bar').style.display = checked.length ? 'flex' : 'none';
    document.getElementById('selected-count').textContent = `Đã chọn ${checked.length} file`;
  }

  mainEl.querySelectorAll('.group-checkbox').forEach(gc => {
    gc.onchange = () => {
      mainEl.querySelectorAll(`.file-checkbox[data-group="${gc.dataset.groupCheck}"]`).forEach(fc => { fc.checked = gc.checked; });
      updateBulkBar();
    };
  });
  mainEl.querySelectorAll('.file-checkbox').forEach(fc => { fc.onchange = updateBulkBar; });

  document.getElementById('bulk-delete').onclick = async () => {
    const filenames = [...mainEl.querySelectorAll('.file-checkbox:checked')].map(c => c.dataset.filename);
    if (!filenames.length) return;
    if (!(await confirmModal(`Xoá ${filenames.length} file đã chọn? Nếu còn task đang gắn link tới các file này, link sẽ bị hỏng.`))) return;
    try { await window.Api.deleteUploads(filenames); renderUploads(); } catch (err) { toast(err.message, 'error'); }
  };
}

function render() {
  const roles = state.roles;
  const tabs = [];
  if (roles.includes('sale') || roles.includes('admin')) tabs.push({ key: 'create', label: 'Gửi task mới' });
  if (roles.includes('sale') || roles.includes('admin')) tabs.push({ key: 'sent', label: 'Task đã gửi' });
  if (roles.includes('media') || roles.includes('admin')) tabs.push({ key: 'mine', label: 'Task của tôi' });
  if (roles.includes('admin')) {
    tabs.push({ key: 'pending', label: 'Task chờ gán' });
    tabs.push({ key: 'workload', label: 'Workload' });
  }
  tabs.push({ key: 'completed', label: 'Task đã làm' });
  if (roles.includes('admin')) {
    tabs.push({ key: 'users', label: 'Quản lý người' });
    tabs.push({ key: 'templates', label: 'Mẫu tin nhắn' });
    tabs.push({ key: 'uploads', label: 'File đính kèm' });
  }

  if (!state.tab) state.tab = tabs[0]?.key;
  setNav(tabs);

  const renderers = {
    create: renderCreateForm, sent: renderSentTasks, mine: renderMyTasks, pending: renderPendingTasks,
    workload: renderWorkload, completed: renderCompleted, users: renderUsers, templates: renderTemplates,
    uploads: renderUploads,
  };
  (renderers[state.tab] || (() => { mainEl.innerHTML = '<div class="empty">Không có quyền truy cập.</div>'; }))();
}

// ─── Header: profile chip + modal hồ sơ + welcome modal mỗi lần mở app ───
function setupProfileChip(me) {
  const chip = document.getElementById('profile-chip');
  chip.innerHTML = `<span class="avatar">${initials(me.name)}</span><span class="name">${me.name || ''}</span>`;
  chip.onclick = () => openModal({
    title: 'Hồ sơ',
    bodyHtml: `
      <div class="welcome-body">
        <div class="welcome-avatar">${initials(me.name)}</div>
        <p class="welcome-name">${me.name || ''}</p>
        <p class="welcome-role">${highestRoleLabel(me.roles)}</p>
      </div>`,
    footerHtml: `<button type="button" class="btn-secondary" data-act="logout">${icon('logout', 15)}Đăng xuất</button>`,
    onMount: (panel) => {
      panel.querySelector('[data-act="logout"]').onclick = () => {
        localStorage.removeItem('sessionToken');
        location.reload();
      };
    },
  });
}

function showWelcomeModal(me) {
  openModal({
    title: '',
    size: 'sm',
    bodyHtml: `
      <div class="welcome-body">
        <div class="welcome-avatar">${initials(me.name)}</div>
        <p class="welcome-name">Chào ${me.name || 'bạn'}!</p>
        <p class="welcome-role">${highestRoleLabel(me.roles)}</p>
      </div>`,
    footerHtml: `<button type="button" class="btn-primary" style="width:100%;justify-content:center;" data-modal-close>Bắt đầu</button>`,
  });
}

(async function init() {
  try {
    await window.Api.ensureLoggedIn();
    const me = await window.Api.getMe();
    if (me.roles.length === 0) {
      mainEl.innerHTML = '<div class="error">Bạn chưa được thêm vào hệ thống. Vui lòng liên hệ admin.</div>';
      return;
    }
    state.roles = me.roles;
    setupProfileChip(me);
    render();
    showWelcomeModal(me);
  } catch (err) {
    if (err.message !== 'redirecting') {
      mainEl.innerHTML = `<div class="error">Lỗi: ${err.message}</div>`;
    }
  }
})();
