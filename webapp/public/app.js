// Phải khớp 1:1 với config.js (COLS/STATUS) ở backend — nhân bản nhỏ vì frontend không import được file Node.
const COLS = {
  TASK_NAME: 'Task', SKU: 'Tên sản phẩm / SKU', MO_TA_NGAN: 'Mô tả ngắn', MO_TA_CHI_TIET: 'Mô tả chi tiết',
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

function taskCard(t, actionsHtml) {
  const f = t.fields;
  return `
    <div class="card" data-id="${t.record_id}">
      <h3>${f[COLS.TASK_NAME] || 'N/A'}</h3>
      <div class="meta">SKU: ${f[COLS.SKU] || 'N/A'}</div>
      <div class="meta">👤 Giao: ${userName(f[COLS.NGUOI_GIAO])} → Thực hiện: ${userName(f[COLS.NGUOI_THUC_HIEN])}</div>
      <div class="meta">📅 Deadline: ${fmtDate(f[COLS.DEADLINE])} | 📌 ${f[COLS.TRANG_THAI]}</div>
      ${actionsHtml || ''}
    </div>`;
}

async function renderMyTasks() {
  const tasks = await window.Api.getMyTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Không có task nào.</div>'; return; }
  mainEl.innerHTML = tasks.map(t => {
    const status = t.fields[COLS.TRANG_THAI];
    let action = '';
    if (status === STATUS.DANG_CHO) action = `<button class="primary" data-act="start">Bắt đầu làm</button>`;
    else if (status === STATUS.DANG_LAM) action = `<button class="secondary" data-act="pending-check">Chờ check</button>`;
    return taskCard(t, action ? `<div class="actions">${action}</div>` : '');
  }).join('');
  mainEl.querySelectorAll('[data-act]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.closest('.card').dataset.id;
      const act = btn.dataset.act;
      if (act === 'start') await window.Api.startTask(id);
      else if (act === 'pending-check') await window.Api.pendingCheck(id);
      renderMyTasks();
    };
  });
}

async function renderSentTasks() {
  const tasks = await window.Api.getSentTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Không có task nào.</div>'; return; }
  mainEl.innerHTML = tasks.map(t => {
    const status = t.fields[COLS.TRANG_THAI];
    const action = status === STATUS.CHO_CHECK ? `<button class="primary" data-act="complete">✅ Hoàn thành</button>` : '';
    return taskCard(t, action ? `<div class="actions">${action}</div>` : '');
  }).join('');
  mainEl.querySelectorAll('[data-act]').forEach(btn => {
    btn.onclick = async () => { await window.Api.completeTask(btn.closest('.card').dataset.id); renderSentTasks(); };
  });
}

async function renderPendingTasks() {
  const [tasks, members] = await Promise.all([window.Api.getPendingTasks(), window.Api.getTeamMembers()]);
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Không có task chờ gán.</div>'; return; }
  const mediaMembers = members.filter(m => (m.roles || []).includes('media'));
  mainEl.innerHTML = tasks.map(t => {
    const options = mediaMembers.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    return taskCard(t, `
      <div class="actions" style="flex-direction:column; align-items:stretch;">
        <select data-act="assign"><option value="">Chọn người thực hiện...</option>${options}</select>
      </div>`);
  }).join('');
  mainEl.querySelectorAll('[data-act="assign"]').forEach(sel => {
    sel.onchange = async () => {
      if (!sel.value) return;
      await window.Api.assignTask(sel.closest('.card').dataset.id, sel.value);
      renderPendingTasks();
    };
  });
}

async function renderWorkload() {
  const workload = await window.Api.getWorkload();
  if (workload.length === 0) { mainEl.innerHTML = '<div class="empty">✅ Team không có task nào.</div>'; return; }
  mainEl.innerHTML = workload.map(m => `
    <div class="card">
      <h3>@${m.name}</h3>
      <div class="meta">Đang chờ: ${m.dang_cho} | Đang làm: ${m.dang_lam} | Chờ check: ${m.cho_check} | <b>Tổng: ${m.total}</b></div>
    </div>`).join('');
}

async function renderCompleted() {
  const tasks = await window.Api.getCompletedTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">Chưa có task hoàn thành.</div>'; return; }
  mainEl.innerHTML = tasks.map(t => `
    <div class="card">
      <h3>${t.fields[COLS.TASK_NAME]}</h3>
      <div class="meta">SKU: ${t.fields[COLS.SKU]}</div>
      <div class="meta">👤 Giao: ${userName(t.fields[COLS.NGUOI_GIAO])} → Thực hiện: ${userName(t.fields[COLS.NGUOI_THUC_HIEN])}</div>
      <div class="meta">📅 Ngày giao: ${fmtDate(new Date(t.created_at).getTime())} | ✅ Hoàn thành: ${t.completed_at ? fmtDate(new Date(t.completed_at).getTime()) : '—'}</div>
      <div class="meta">${t.fields[COLS.MO_TA_NGAN] || ''}</div>
      ${t.attachment_url ? `<div class="meta">📎 ${t.attachment_url}</div>` : ''}
    </div>`).join('');
}

async function renderCreateForm() {
  const members = await window.Api.getTeamMembers();
  const options = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  mainEl.innerHTML = `
    <form id="create-form">
      <label>Người giao</label>
      <select name="nguoiGiaoId"><option value="">— Mặc định là tôi —</option>${options}</select>
      <div class="hint">Để trống nếu chính bạn là người giao task này.</div>

      <label>Tên sản phẩm / SKU *</label>
      <input name="sku" required placeholder="Nếu nhiều SKU thì ghi ngắn gọn (KBA-804X)" />

      <label>Mô tả ngắn *</label>
      <input name="moTaNgan" required maxlength="150" placeholder="Lật hình, xoá brand,..." />
      <div class="charcount"><span id="char-count">0</span>/150</div>

      <label>Tên task *</label>
      <input name="taskName" required placeholder="Tên ngắn gọn cho task" />

      <label>Deadline *</label>
      <input type="date" name="deadline" required />

      <label>Mô tả chi tiết</label>
      <textarea name="moTaChiTiet" rows="4" placeholder="Ghi chi tiết hơn ở trên"></textarea>

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
  const moTaNganInput = form.moTaNgan;
  moTaNganInput.oninput = () => { document.getElementById('char-count').textContent = moTaNganInput.value.length; };

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
        moTaNgan: fd.get('moTaNgan'),
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

function render() {
  const roles = state.roles;
  const tabs = [];
  if (roles.includes('sale') || roles.includes('admin')) tabs.push({ key: 'create', label: 'Gửi task mới' });
  if (roles.includes('sale')) tabs.push({ key: 'sent', label: 'Task đã gửi' });
  if (roles.includes('media') || roles.includes('admin')) tabs.push({ key: 'mine', label: 'Task của tôi' });
  if (roles.includes('admin')) {
    tabs.push({ key: 'pending', label: 'Task chờ gán' });
    tabs.push({ key: 'workload', label: 'Workload' });
  }
  tabs.push({ key: 'completed', label: 'Task đã làm' });

  if (!state.tab) state.tab = tabs[0]?.key;
  setNav(tabs);

  const renderers = { create: renderCreateForm, sent: renderSentTasks, mine: renderMyTasks, pending: renderPendingTasks, workload: renderWorkload, completed: renderCompleted };
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
    render();
  } catch (err) {
    if (err.message !== 'redirecting') {
      mainEl.innerHTML = `<div class="error">Lỗi: ${err.message}</div>`;
    }
  }
})();
