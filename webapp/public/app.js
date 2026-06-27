// Phải khớp 1:1 với config.js (COLS/STATUS) ở backend — nhân bản nhỏ vì frontend không import được file Node.
const COLS = {
  TASK_NAME: 'Task', SKU: 'Tên sản phẩm / SKU', MO_TA_CHI_TIET: 'Mô tả chi tiết',
  TRANG_THAI: 'Trạng thái', NGUOI_GIAO: 'Người giao', NGUOI_THUC_HIEN: 'Người thực hiện', DEADLINE: 'Deadline',
};
const STATUS = {
  CHO_GAN: 'Chờ gán người thực hiện', DANG_CHO: 'Đang chờ', DANG_LAM: 'Đang làm',
  CHO_CHECK: 'Chờ check', HOAN_THANH: 'Hoàn thành',
};

const mainEl = document.getElementById('main');
const navEl = document.getElementById('nav');
let state = { roles: [], tab: null, pendingAttachment: null };

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function userName(val) { return val?.[0]?.name || 'N/A'; }

const ROLE_LABEL = { admin: 'ADMIN', sale: 'SALE', media: 'MEDIA' };
const ROLE_RANK = { admin: 3, sale: 2, media: 1 };
function highestRoleLabel(roles) {
  const top = [...roles].sort((a, b) => (ROLE_RANK[b] || 0) - (ROLE_RANK[a] || 0))[0];
  return ROLE_LABEL[top] || '';
}

function grid(html) { return `<div class="grid">${html}</div>`; }

function setNav(tabs) {
  navEl.innerHTML = '';
  tabs.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t.label;
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
  if (person === 'giao') personLine = `<div class="meta">👤 Người giao: ${userName(f[COLS.NGUOI_GIAO])}</div>`;
  else if (person === 'thuchien') personLine = `<div class="meta">👤 Người thực hiện: ${userName(f[COLS.NGUOI_THUC_HIEN])}</div>`;

  return `
    <div class="card" data-id="${t.record_id}">
      <div class="card-title-row">
        <h3>${f[COLS.TASK_NAME] || 'N/A'}</h3>
        ${titleActionsHtml ? `<div class="icon-actions">${titleActionsHtml}</div>` : ''}
      </div>
      <div class="meta">SKU: ${f[COLS.SKU] || 'N/A'}</div>
      ${personLine}
      <div class="meta">📅 Deadline: ${fmtDate(f[COLS.DEADLINE])}${showStatus ? ` | 📌 ${f[COLS.TRANG_THAI]}` : ''}</div>
      ${showMota && f[COLS.MO_TA_CHI_TIET] ? `<div class="note">📝 ${f[COLS.MO_TA_CHI_TIET]}</div>` : ''}
      ${actionsHtml}
    </div>`;
}

function editStatusForm(t) {
  const current = t.fields[COLS.TRANG_THAI];
  const options = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK, STATUS.HOAN_THANH]
    .map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('');
  return `
    <div class="card" data-id="${t.record_id}">
      <h3>${t.fields[COLS.TASK_NAME]}</h3>
      <label>Trạng thái</label>
      <select data-edit="status">${options}</select>
      <div class="error" data-edit-error></div>
      <div class="actions">
        <button class="primary" data-act="save-status">Lưu</button>
        <button class="secondary" data-act="cancel-edit">Huỷ</button>
      </div>
    </div>`;
}

async function renderMyTasks() {
  const tasks = await window.Api.getMyTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Không có task nào.</div>'; return; }
  mainEl.innerHTML = grid(tasks.map(t => {
    const status = t.fields[COLS.TRANG_THAI];
    let action = '';
    if (status === STATUS.DANG_CHO) action = `<button class="primary" data-act="start">Bắt đầu làm</button>`;
    else if (status === STATUS.DANG_LAM) action = `<button class="secondary" data-act="pending-check">Chờ check</button>`;
    const titleActionsHtml = `<button class="icon-btn" data-act="edit-status" title="Sửa trạng thái">✏️</button>`;
    return taskCard(t, { actionsHtml: action ? `<div class="actions">${action}</div>` : '', titleActionsHtml, person: 'giao', showMota: true });
  }).join(''));

  mainEl.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="start"]')?.addEventListener('click', async () => { await window.Api.startTask(id); renderMyTasks(); });
    card.querySelector('[data-act="pending-check"]')?.addEventListener('click', async () => { await window.Api.pendingCheck(id); renderMyTasks(); });
    card.querySelector('[data-act="edit-status"]')?.addEventListener('click', () => {
      const task = tasks.find(t => t.record_id === id);
      card.outerHTML = editStatusForm(task);
      const newCard = mainEl.querySelector(`.card[data-id="${id}"]`);
      newCard.querySelector('[data-act="cancel-edit"]').onclick = () => renderMyTasks();
      newCard.querySelector('[data-act="save-status"]').onclick = async () => {
        const errEl = newCard.querySelector('[data-edit-error]');
        try {
          await window.Api.updateStatus(id, newCard.querySelector('[data-edit="status"]').value);
          renderMyTasks();
        } catch (err) {
          errEl.textContent = err.message;
        }
      };
    });
  });
}

function editTaskForm(t) {
  const f = t.fields;
  const deadlineVal = f[COLS.DEADLINE] ? new Date(Number(f[COLS.DEADLINE])).toISOString().slice(0, 10) : '';
  return `
    <div class="card" data-id="${t.record_id}">
      <label>Yêu cầu</label>
      <input data-edit="taskName" maxlength="50" value="${(f[COLS.TASK_NAME] || '').replace(/"/g, '&quot;')}" />
      <label>SKU</label>
      <input data-edit="sku" value="${(f[COLS.SKU] || '').replace(/"/g, '&quot;')}" />
      <label>Mô tả chi tiết</label>
      <textarea data-edit="moTaChiTiet" rows="3">${f[COLS.MO_TA_CHI_TIET] || ''}</textarea>
      <label>Deadline</label>
      <input type="date" data-edit="deadline" value="${deadlineVal}" />
      <div class="error" data-edit-error></div>
      <div class="actions">
        <button class="primary" data-act="save-edit">Lưu</button>
        <button class="secondary" data-act="cancel-edit">Huỷ</button>
      </div>
    </div>`;
}

async function renderSentTasks() {
  const tasks = await window.Api.getSentTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Không có task nào.</div>'; return; }
  mainEl.innerHTML = grid(tasks.map(t => {
    const status = t.fields[COLS.TRANG_THAI];
    const completeBtn = status === STATUS.CHO_CHECK ? `<div class="actions"><button class="primary" data-act="complete">✅ Hoàn thành</button></div>` : '';
    const titleActionsHtml = `
      <button class="icon-btn" data-act="edit" title="Sửa">✏️</button>
      <button class="icon-btn" data-act="delete" title="Xoá">🗑️</button>`;
    return taskCard(t, { actionsHtml: completeBtn, titleActionsHtml, person: 'thuchien', showMota: true });
  }).join(''));

  mainEl.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="complete"]')?.addEventListener('click', async () => {
      await window.Api.completeTask(id); renderSentTasks();
    });
    card.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      if (!confirm('Xoá task này? Không thể hoàn tác.')) return;
      await window.Api.deleteTask(id); renderSentTasks();
    });
    card.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
      const task = tasks.find(t => t.record_id === id);
      card.outerHTML = editTaskForm(task);
      bindEditForm(id, renderSentTasks);
    });
  });
}

function bindEditForm(id, onDone) {
  const card = mainEl.querySelector(`.card[data-id="${id}"]`);
  card.querySelector('[data-act="cancel-edit"]').onclick = () => onDone();
  card.querySelector('[data-act="save-edit"]').onclick = async () => {
    const errEl = card.querySelector('[data-edit-error]');
    errEl.textContent = '';
    const deadlineVal = card.querySelector('[data-edit="deadline"]').value;
    try {
      await window.Api.updateTask(id, {
        taskName: card.querySelector('[data-edit="taskName"]').value,
        sku: card.querySelector('[data-edit="sku"]').value,
        moTaChiTiet: card.querySelector('[data-edit="moTaChiTiet"]').value,
        deadline: deadlineVal ? new Date(deadlineVal).getTime() : null,
      });
      onDone();
    } catch (err) {
      errEl.textContent = err.message;
    }
  };
}

async function renderPendingTasks() {
  const [tasks, members] = await Promise.all([window.Api.getPendingTasks(), window.Api.getTeamMembers()]);
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Không có task chờ gán.</div>'; return; }
  const mediaMembers = members.filter(m => (m.roles || []).includes('media'));
  mainEl.innerHTML = grid(tasks.map(t => {
    const options = mediaMembers.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    const actionsHtml = `
      <div class="actions" style="flex-direction:column; align-items:stretch;">
        <select data-act="assign-select"><option value="">Chọn người thực hiện...</option>${options}</select>
        <button class="primary" data-act="assign-confirm" style="margin-top:6px;" disabled>Xác nhận gán</button>
      </div>`;
    return taskCard(t, { actionsHtml, person: 'giao', showStatus: false, showMota: true });
  }).join(''));
  mainEl.querySelectorAll('.card').forEach(card => {
    const sel = card.querySelector('[data-act="assign-select"]');
    const btn = card.querySelector('[data-act="assign-confirm"]');
    sel.onchange = () => { btn.disabled = !sel.value; };
    btn.onclick = async () => {
      if (!sel.value) return;
      await window.Api.assignTask(card.dataset.id, sel.value);
      renderPendingTasks();
    };
  });
}

async function renderWorkload() {
  const workload = await window.Api.getWorkload();
  if (workload.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Team không có task nào.</div>'; return; }
  mainEl.innerHTML = grid(workload.map(m => `
    <div class="card">
      <h3 class="clickable" data-act="show-detail" data-id="${m.id}">@${m.name}</h3>
      <div class="meta">Đang chờ: ${m.dang_cho} | Đang làm: ${m.dang_lam} | Chờ check: ${m.cho_check} | <b>Tổng: ${m.total}</b></div>
      <div class="detail" id="detail-${m.id}" style="display:none;"></div>
    </div>`).join(''));

  mainEl.querySelectorAll('[data-act="show-detail"]').forEach(el => {
    el.onclick = async () => {
      const id = el.dataset.id;
      const detailEl = document.getElementById(`detail-${id}`);
      const isOpen = detailEl.style.display !== 'none';
      detailEl.style.display = isOpen ? 'none' : 'block';
      if (isOpen || detailEl.dataset.loaded) return;
      const tasks = await window.Api.getTasksByMedia(id);
      detailEl.dataset.loaded = '1';
      detailEl.innerHTML = tasks.length === 0
        ? '<div class="meta">Không có task đang xử lý.</div>'
        : tasks.map(t => `<div class="meta">• ${t.fields[COLS.TASK_NAME]} (${t.fields[COLS.TRANG_THAI]}) — ${fmtDate(t.fields[COLS.DEADLINE])}</div>`).join('');
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
    <div class="card" style="margin-bottom: 12px;">
      <label>Tháng</label>
      <input type="month" id="filter-month" value="${state.completedFilters.month}" />
      ${isAdmin ? `<label>Người gửi</label><select id="filter-sender"><option value="">Tất cả</option>${senderOptionsHtml}</select>` : ''}
    </div>`;

  const tasks = await window.Api.getCompletedTasks({
    month: state.completedFilters.month,
    ...(state.completedFilters.senderId ? { senderId: state.completedFilters.senderId } : {}),
  });

  const listHtml = tasks.length === 0
    ? '<div class="empty">Chưa có task hoàn thành.</div>'
    : grid(tasks.map(t => `
      <div class="card">
        <h3>${t.fields[COLS.TASK_NAME]}</h3>
        <div class="meta">SKU: ${t.fields[COLS.SKU]}</div>
        <div class="meta">👤 Giao: ${userName(t.fields[COLS.NGUOI_GIAO])} → Thực hiện: ${userName(t.fields[COLS.NGUOI_THUC_HIEN])}</div>
        <div class="meta">📅 Ngày giao: ${fmtDate(new Date(t.created_at).getTime())} | ✅ Hoàn thành: ${t.completed_at ? fmtDate(new Date(t.completed_at).getTime()) : '—'}</div>
        ${t.fields[COLS.MO_TA_CHI_TIET] ? `<div class="note">📝 ${t.fields[COLS.MO_TA_CHI_TIET]}</div>` : ''}
        ${t.attachment_url ? `<div class="meta">📎 ${t.attachment_url}</div>` : ''}
      </div>`).join(''));

  mainEl.innerHTML = filterBarHtml + listHtml;

  document.getElementById('filter-month').onchange = (e) => {
    state.completedFilters.month = e.target.value;
    renderCompleted();
  };
  const senderSel = document.getElementById('filter-sender');
  if (senderSel) senderSel.onchange = (e) => { state.completedFilters.senderId = e.target.value; renderCompleted(); };
}

async function renderCreateForm() {
  const members = await window.Api.getTeamMembers();
  const options = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  mainEl.innerHTML = `
    <form id="create-form">
      <label>Người giao (không bắt buộc)</label>
      <select name="nguoiGiaoId"><option value="">Để trống nếu chính bạn là người giao task này.</option>${options}</select>

      <label>Yêu cầu *</label>
      <input name="taskName" required maxlength="50" placeholder="Tên ngắn gọn cho task" />

      <label>Tên sản phẩm / SKU *</label>
      <input name="sku" required placeholder="Nếu nhiều SKU thì ghi ngắn gọn (KBA-804X)" />

      <label>Mô tả chi tiết (không bắt buộc)</label>
      <textarea name="moTaChiTiet" rows="4" placeholder="Ghi chi tiết hơn ở trên"></textarea>

      <label>Deadline *</label>
      <input type="date" name="deadline" required />

      <label>File gốc (không bắt buộc)</label>
      <div class="drop-zone" id="drop-zone">Dán hoặc kéo ảnh/tệp vào đây, hoặc bấm để chọn file</div>
      <input type="file" id="file-input" style="display:none" />
      <div class="hint" id="file-status"></div>

      <div class="error" id="form-error"></div>
      <div class="actions" style="margin-top:14px;">
        <button class="primary" type="submit">Gửi task</button>
      </div>
    </form>`;

  const form = document.getElementById('create-form');

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileStatus = document.getElementById('file-status');
  state.pendingAttachment = null;

  async function handleFile(file) {
    if (!file) return;
    fileStatus.textContent = 'Đang tải lên...';
    try {
      const { attachmentUrl } = await window.Api.uploadFile(file);
      state.pendingAttachment = attachmentUrl;
      fileStatus.textContent = `✅ Đã đính kèm: ${file.name}`;
    } catch (err) {
      fileStatus.textContent = `❌ Tải file lỗi: ${err.message}`;
    }
  }
  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => handleFile(fileInput.files[0]);
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('dragover'); };
  dropZone.ondragleave = () => dropZone.classList.remove('dragover');
  dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); };
  document.addEventListener('paste', (e) => {
    const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  });

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
        attachmentUrl: state.pendingAttachment,
      });
      form.reset();
      state.pendingAttachment = null;
      fileStatus.textContent = '';
      alert('✅ Đã gửi task!');
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

function userForm(u = null) {
  return `
    <div class="card" data-user-form="${u ? u.id : 'new'}">
      <label>Open ID${u ? '' : ' (lấy bằng cách nhắn "hi" cho bot lần đầu)'}</label>
      <input data-f="openId" value="${u ? u.id : ''}" ${u ? 'disabled' : ''} placeholder="ou_xxxxxxxx" />
      <label>Tên đầy đủ</label>
      <input data-f="name" value="${u ? u.name.replace(/"/g, '&quot;') : ''}" placeholder="丁皇俊英 (Dustin)" />
      <label>Vị trí</label>
      <div data-f="roles">${userRolesCheckboxes(u ? u.roles : [])}</div>
      <div class="error" data-form-error></div>
      <div class="actions">
        <button class="primary" data-act="save-user">Lưu</button>
        <button class="secondary" data-act="cancel-user">Huỷ</button>
      </div>
    </div>`;
}

async function renderUsers() {
  const users = await window.Api.getUsers();
  mainEl.innerHTML = `
    <div class="actions" style="margin-bottom:12px;"><button class="primary" data-act="add-user">+ Thêm người</button></div>
    <div id="user-form-slot"></div>
    ${grid(users.map(u => `
      <div class="card" data-id="${u.id}">
        <div class="card-title-row">
          <h3>${u.name}</h3>
          <div class="icon-actions">
            <button class="icon-btn" data-act="edit-user" title="Sửa">✏️</button>
            <button class="icon-btn" data-act="delete-user" title="Xoá">🗑️</button>
          </div>
        </div>
        <div class="meta">Vị trí: ${(u.roles || []).map(r => ROLE_LABEL[r] || r).join(', ') || '—'}</div>
      </div>`).join(''))}`;

  function bindForm(slotHtml, existingUser) {
    const slot = document.getElementById('user-form-slot');
    slot.innerHTML = slotHtml;
    const formEl = slot.querySelector('[data-user-form]');
    formEl.querySelector('[data-act="cancel-user"]').onclick = () => renderUsers();
    formEl.querySelector('[data-act="save-user"]').onclick = async () => {
      const errEl = formEl.querySelector('[data-form-error]');
      errEl.textContent = '';
      const roles = [...formEl.querySelectorAll('[data-f="roles"] input:checked')].map(i => i.value);
      const name = formEl.querySelector('[data-f="name"]').value.trim();
      if (!name || !roles.length) { errEl.textContent = 'Cần tên và ít nhất 1 vị trí'; return; }
      try {
        if (existingUser) {
          await window.Api.updateUser(existingUser.id, { name, roles });
        } else {
          const openId = formEl.querySelector('[data-f="openId"]').value.trim();
          if (!openId) { errEl.textContent = 'Cần Open ID'; return; }
          await window.Api.createUser({ openId, name, roles });
        }
        renderUsers();
      } catch (err) {
        errEl.textContent = err.message;
      }
    };
  }

  document.querySelector('[data-act="add-user"]').onclick = () => bindForm(userForm(), null);
  mainEl.querySelectorAll('.card[data-id]').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-act="edit-user"]').onclick = () => {
      const u = users.find(x => x.id === id);
      bindForm(userForm(u), u);
    };
    card.querySelector('[data-act="delete-user"]').onclick = async () => {
      if (!confirm('Xoá người dùng này? Họ sẽ không thể đăng nhập/nhận thông báo nữa.')) return;
      try { await window.Api.deleteUser(id); renderUsers(); } catch (err) { alert(err.message); }
    };
  });
}

// ─── Quản lý mẫu tin nhắn (admin) ─────────────────────────────────────
function templateForm(variables, tpl = null) {
  const helpHtml = `<div class="hint">Biến dùng được: ${variables.map(v => `$${v}`).join(', ')}</div>`;
  return `
    <div class="card" data-tpl-form="${tpl ? tpl.key : 'new'}">
      ${tpl ? '' : '<label>Tiêu đề</label><input data-f="title" placeholder="VD: Nhắc deadline" />'}
      <label>Nội dung</label>
      <textarea data-f="content" rows="4">${tpl ? tpl.content : ''}</textarea>
      ${helpHtml}
      <div class="error" data-form-error></div>
      <div class="actions">
        <button class="primary" data-act="save-tpl">Lưu</button>
        <button class="secondary" data-act="cancel-tpl">Huỷ</button>
      </div>
    </div>`;
}

async function renderTemplates() {
  const { templates, variables } = await window.Api.getMessageTemplates();
  mainEl.innerHTML = `
    <div class="actions" style="margin-bottom:12px;"><button class="primary" data-act="add-tpl">+ Thêm mẫu tin nhắn</button></div>
    <div id="tpl-form-slot"></div>
    ${grid(templates.map(t => `
      <div class="card" data-key="${t.key}">
        <div class="card-title-row">
          <h3>${t.title}${t.is_system ? ' <span class="meta" style="display:inline;">(hệ thống)</span>' : ''}</h3>
          <div class="icon-actions">
            <button class="icon-btn" data-act="edit-tpl" title="Sửa">✏️</button>
            ${t.is_system ? '' : '<button class="icon-btn" data-act="delete-tpl" title="Xoá">🗑️</button>'}
          </div>
        </div>
        <div class="note" style="white-space:pre-wrap;">${t.content}</div>
      </div>`).join(''))}`;

  function bindForm(slotHtml, existingTpl) {
    const slot = document.getElementById('tpl-form-slot');
    slot.innerHTML = slotHtml;
    const formEl = slot.querySelector('[data-tpl-form]');
    formEl.querySelector('[data-act="cancel-tpl"]').onclick = () => renderTemplates();
    formEl.querySelector('[data-act="save-tpl"]').onclick = async () => {
      const errEl = formEl.querySelector('[data-form-error]');
      errEl.textContent = '';
      const content = formEl.querySelector('[data-f="content"]').value.trim();
      if (!content) { errEl.textContent = 'Cần nội dung'; return; }
      try {
        if (existingTpl) {
          await window.Api.updateMessageTemplate(existingTpl.key, { content });
        } else {
          const title = formEl.querySelector('[data-f="title"]').value.trim();
          if (!title) { errEl.textContent = 'Cần tiêu đề'; return; }
          await window.Api.createMessageTemplate({ title, content });
        }
        renderTemplates();
      } catch (err) {
        errEl.textContent = err.message;
      }
    };
  }

  document.querySelector('[data-act="add-tpl"]').onclick = () => bindForm(templateForm(variables), null);
  mainEl.querySelectorAll('.card[data-key]').forEach(card => {
    const key = card.dataset.key;
    card.querySelector('[data-act="edit-tpl"]').onclick = () => {
      const t = templates.find(x => x.key === key);
      bindForm(templateForm(variables, t), t);
    };
    card.querySelector('[data-act="delete-tpl"]')?.addEventListener('click', async () => {
      if (!confirm('Xoá mẫu tin nhắn này?')) return;
      try { await window.Api.deleteMessageTemplate(key); renderTemplates(); } catch (err) { alert(err.message); }
    });
  });
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
  }

  if (!state.tab) state.tab = tabs[0]?.key;
  setNav(tabs);

  const renderers = {
    create: renderCreateForm, sent: renderSentTasks, mine: renderMyTasks, pending: renderPendingTasks,
    workload: renderWorkload, completed: renderCompleted, users: renderUsers, templates: renderTemplates,
  };
  (renderers[state.tab] || (() => { mainEl.innerHTML = '<div class="empty">Không có quyền truy cập.</div>'; }))();
}

(async function init() {
  try {
    await window.Api.ensureLoggedIn();
    const me = await window.Api.getMe();
    if (me.roles.length === 0) {
      mainEl.innerHTML = '<div class="error">⛔ Bạn chưa được thêm vào hệ thống. Vui lòng liên hệ admin.</div>';
      return;
    }
    state.roles = me.roles;
    document.getElementById('user-info').textContent = me.name ? `${me.name} - ${highestRoleLabel(me.roles)}` : '';
    render();
  } catch (err) {
    if (err.message !== 'redirecting') {
      mainEl.innerHTML = `<div class="error">Lỗi: ${err.message}</div>`;
    }
  }
})();
