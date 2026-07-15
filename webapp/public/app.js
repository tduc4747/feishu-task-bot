// COLS/STATUS lấy từ /app/config.js (sinh động từ config.js backend) — fallback phòng khi
// file config chưa load được (vd cache cũ) để app không trắng màn hình.
const COLS = window.APP_CONFIG?.COLS || {
  TASK_NAME: 'Task', SKU: 'Tên sản phẩm / SKU', MO_TA_CHI_TIET: 'Mô tả chi tiết',
  TRANG_THAI: 'Trạng thái', NGUOI_GIAO: 'Người giao', NGUOI_THUC_HIEN: 'Người thực hiện', DEADLINE: 'Deadline',
};
const STATUS = window.APP_CONFIG?.STATUS || {
  CHO_GAN: 'Chờ gán người thực hiện', DANG_CHO: 'Đang chờ', DANG_LAM: 'Đang làm',
  CHO_CHECK: 'Chờ check', HOAN_THANH: 'Hoàn thành',
};
// Mỗi trạng thái một màu riêng để liếc qua là biết task đang ở bước nào của pipeline.
const STATUS_DOT = {
  [STATUS.CHO_GAN]: 'pending', [STATUS.DANG_CHO]: 'idle', [STATUS.DANG_LAM]: 'active',
  [STATUS.CHO_CHECK]: 'review', [STATUS.HOAN_THANH]: 'ok',
};
// Phải khớp với MAX_FILE_SIZE ở api.js (giới hạn dung lượng do multer chặn).
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_MB = 50;

const mainEl = document.getElementById('main');
const navEl = document.getElementById('nav');
let state = { roles: [], tab: null, pendingAttachments: [] };

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function userName(val) { return val?.[0]?.name || 'N/A'; }
// Escape đầy đủ — dữ liệu người dùng (tên task, mô tả, tên người...) luôn đi qua đây
// trước khi đổ vào innerHTML, tránh stored XSS (vd tên task chứa <img onerror=...>).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ROLE_LABEL = { admin: 'ADMIN', sale: 'SALE', shenzhen: 'Shenzhen Team', media: 'MEDIA' };
const ROLE_RANK = { admin: 4, sale: 3, shenzhen: 2, media: 1 };
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

// Sale VN xếp trước, Shenzhen Team xếp sau, mỗi nhóm sort A-Z theo tên.
function sortSaleMembers(members) {
  return members
    .filter(m => (m.roles || []).some(r => r === 'sale' || r === 'shenzhen'))
    .sort((a, b) => {
      const aTQ = (a.roles || []).includes('shenzhen') ? 1 : 0;
      const bTQ = (b.roles || []).includes('shenzhen') ? 1 : 0;
      if (aTQ !== bTQ) return aTQ - bTQ;
      return a.name.localeCompare(b.name);
    });
}

function grid(html) { return `<div class="grid">${html}</div>`; }
function statusPill(status) {
  return `<span class="status-pill"><span class="status-dot ${STATUS_DOT[status] || ''}"></span>${esc(status) || '—'}</span>`;
}
// ID hiện trước tên task trong mọi card, ví dụ "12-Lật hình sản phẩm".
// Dùng đúng record_id (= cột id trong bảng tasks) — không đệm số 0, để khớp 100% với ID thật trong DB.
function taskLabel(t) {
  return `${t.record_id}-${esc(t.fields[COLS.TASK_NAME] || 'N/A')}`;
}

// Số ngày còn lại tới deadline (âm = quá hạn, Infinity = không có deadline)
function daysToDeadline(t) {
  const ms = t.fields[COLS.DEADLINE];
  if (!ms) return Infinity;
  const d = new Date(Number(ms)); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

// Badge "Mới" cho task vừa được gán (chưa bắt đầu, tạo trong vòng 24h) — media
// liếc qua biết ngay có việc mới. Dùng created_at vì thời điểm gán không được lưu riêng.
function newBadge(t) {
  if (t.fields[COLS.TRANG_THAI] !== STATUS.DANG_CHO || !t.created_at) return '';
  const ageMs = Date.now() - new Date(t.created_at).getTime();
  return ageMs < 24 * 3600 * 1000 ? ' <span class="badge badge-new">Mới</span>' : '';
}

// Badge cảnh báo deadline: quá hạn (đỏ), hôm nay/ngày mai (cam). Task đã hoàn thành không hiện.
function deadlineBadge(t) {
  if (t.fields[COLS.TRANG_THAI] === STATUS.HOAN_THANH) return '';
  const diff = daysToDeadline(t);
  if (diff === Infinity) return '';
  if (diff < 0) return ` <span class="badge badge-danger">Quá hạn ${-diff} ngày</span>`;
  if (diff === 0) return ' <span class="badge badge-warn">Hôm nay</span>';
  if (diff === 1) return ' <span class="badge badge-warn">Ngày mai</span>';
  return '';
}

// Mô tả dài cắt sau 2 dòng, bấm "Xem thêm" mở ra — card gọn, màn hình chứa được nhiều task hơn.
// Toggle xử lý bằng event delegation (gắn 1 lần ở init) vì card bị render lại liên tục.
function noteHtml(text) {
  if (!text) return '';
  const long = text.length > 140 || text.split('\n').length > 3;
  return `<div class="note-wrap"><div class="note${long ? ' clamp' : ''}">${esc(text)}</div>${long ? '<button type="button" class="link-btn" data-note-toggle>Xem thêm</button>' : ''}</div>`;
}

const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i;

// File đính kèm: ảnh hiện thumbnail bấm mở to; file khác hiện tên thật,
// quá 2 file thì gom lại sau nút "+N file khác" (delegation toggle).
function attachmentsHtml(t) {
  const list = t.attachments || [];
  if (list.length === 0) return '';
  const imgs = list.filter(a => IMG_EXT.test(a.url));
  const files = list.filter(a => !IMG_EXT.test(a.url));

  const thumbs = imgs.map(a =>
    `<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name || '')}"><img class="thumb" src="${esc(a.url)}" alt="${esc(a.name || 'ảnh')}" loading="lazy"></a>`).join('');

  const fileLink = (a, i) => {
    const n = a.name || `File ${i + 1}`;
    const s = n.length > 28 ? n.slice(0, 25) + '…' : n;
    return `<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name || '')}">${esc(s)}</a>`;
  };
  const shown = files.slice(0, 2);
  const extra = files.slice(2);

  return `<div class="att-wrap">
    ${thumbs ? `<div class="thumb-row">${thumbs}</div>` : ''}
    ${files.length ? `<div class="meta">${icon('paperclip', 14)}<span>${shown.map(fileLink).join(', ')}${extra.length ? `, <a href="#" data-att-toggle data-more="+${extra.length} file khác">+${extra.length} file khác</a>` : ''}</span></div>` : ''}
    ${extra.length ? `<div class="att-extra meta" hidden>${extra.map((a, i) => fileLink(a, i + 2)).join(', ')}</div>` : ''}
  </div>`;
}

const TAB_ICON = {
  home: 'home', create: 'send', createMedia: 'send', sent: 'file', mine: 'check', pending: 'clock', mediaCalendar: 'calendar', board: 'file',
  completed: 'check', users: 'user', templates: 'template', uploads: 'paperclip', manageAll: 'settings',
};

function navBtn(t) {
  const btn = document.createElement('button');
  btn.title = t.label;
  btn.dataset.key = t.key;
  btn.innerHTML = `${icon(TAB_ICON[t.key] || 'file', 15)}<span class="label">${t.label}</span>`;
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.gap = '6px';
  btn.className = state.tab === t.key ? 'active' : '';
  btn.onclick = () => { state.tab = t.key; render(); };
  return btn;
}

// Modal chọn tab (dùng cho nút "Quản trị" trên desktop và nút "Thêm" của bottom bar mobile)
function openTabPickerModal(title, tabs) {
  openModal({
    title,
    size: 'sm',
    bodyHtml: tabs.map(t => `
      <button type="button" class="btn-secondary nav-menu-item ${state.tab === t.key ? 'active' : ''}" data-tab="${t.key}">
        ${icon(TAB_ICON[t.key] || 'file', 15)}${t.label}
      </button>`).join(''),
    onMount: (panel) => {
      panel.querySelectorAll('[data-tab]').forEach(b => {
        b.onclick = () => { closeModal(); state.tab = b.dataset.tab; render(); };
      });
    },
  });
}

// Badge số đỏ trên tab: việc đang chờ mình (fetch nền sau khi vẽ nav, lỗi thì bỏ qua)
async function decorateNavBadges() {
  try {
    const c = await window.Api.getBadgeCounts();
    const map = { mine: c.mine, sent: c.sent, pending: c.pending };
    const addBadge = (btn, n) => {
      btn.querySelector('.nav-badge')?.remove();
      if (n > 0) {
        const span = document.createElement('span');
        span.className = 'nav-badge';
        span.textContent = n > 99 ? '99+' : n;
        btn.appendChild(span);
      }
    };
    document.querySelectorAll('nav button[data-key], #bottom-nav button[data-key]').forEach(b => addBadge(b, map[b.dataset.key] || 0));
    // Mobile: tab có badge nhưng bị gom vào nút "Thêm" -> dồn tổng số lên nút "Thêm".
    // Chỉ tính tab mà role này thực sự có (nav trên desktop chứa đủ tab của user) —
    // không thì sale bị đếm cả số "Chờ gán" vốn là tab của admin.
    const moreBtn = document.querySelector('#bottom-nav button[data-key="__more"]');
    if (moreBtn) {
      const myTabKeys = new Set([...document.querySelectorAll('nav button[data-key]')].map(b => b.dataset.key));
      const bottomKeys = new Set([...document.querySelectorAll('#bottom-nav button[data-key]')].map(b => b.dataset.key));
      const hiddenTotal = Object.entries(map).reduce(
        (sum, [k, n]) => sum + (myTabKeys.has(k) && !bottomKeys.has(k) ? n : 0), 0);
      addBadge(moreBtn, hiddenTotal);
    }
  } catch (err) { /* badge chỉ là trang trí, không chặn app */ }
}

// Bottom tab bar cho mobile (<640px): 4 tab đầu + nút "Thêm" mở modal chứa phần còn lại.
// Trên desktop bar này ẩn bằng CSS, nav ngang hiện như cũ.
function buildBottomNav(tabs, adminTabs) {
  let bar = document.getElementById('bottom-nav');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bottom-nav';
    document.body.appendChild(bar);
  }
  bar.innerHTML = '';

  const primary = tabs.slice(0, 4);
  const rest = [...tabs.slice(4), ...adminTabs];

  primary.forEach(t => {
    const btn = document.createElement('button');
    btn.dataset.key = t.key;
    btn.className = state.tab === t.key ? 'active' : '';
    btn.innerHTML = `${icon(TAB_ICON[t.key] || 'file', 18)}<span>${t.label}</span>`;
    btn.onclick = () => { state.tab = t.key; render(); };
    bar.appendChild(btn);
  });

  if (rest.length) {
    const isActive = rest.some(t => t.key === state.tab);
    const btn = document.createElement('button');
    btn.dataset.key = '__more';
    btn.className = isActive ? 'active' : '';
    btn.innerHTML = `${icon('menu', 18)}<span>Thêm</span>`;
    btn.onclick = () => openTabPickerModal('Tất cả chức năng', rest);
    bar.appendChild(btn);
  }
}

// Tab quản trị (admin) gom vào 1 nút mở modal chọn — nav 12 tab tràn màn hình,
// mobile chỉ còn icon phải đoán. Sale/Media không đổi gì (họ chỉ có 3-4 tab).
function setNav(tabs, adminTabs = []) {
  navEl.innerHTML = '';
  tabs.forEach(t => navEl.appendChild(navBtn(t)));

  if (adminTabs.length) {
    const isActive = adminTabs.some(t => t.key === state.tab);
    const btn = document.createElement('button');
    btn.title = 'Quản trị';
    btn.innerHTML = `${icon('settings', 15)}<span class="label">Quản trị</span>${icon('chevron', 13)}`;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '6px';
    btn.className = isActive ? 'active' : '';
    btn.onclick = () => openTabPickerModal('Quản trị', adminTabs);
    navEl.appendChild(btn);
  }

  buildBottomNav(tabs, adminTabs);
  decorateNavBadges();
}

// Chặn double-click gửi trùng request (thông báo DM bắn 2 lần) — disable nút khi đang chờ.
async function withBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

// opts: { actionsHtml, titleActionsHtml, person: 'giao'|'thuchien'|'both'|'none', showStatus, showMota }
function taskCard(t, opts = {}) {
  const { actionsHtml = '', titleActionsHtml = '', person = 'none', showStatus = true, showMota = false } = opts;
  const f = t.fields;
  let personLine = '';
  if (person === 'giao') personLine = `<div class="meta">${icon('user', 14)}Người giao: ${esc(userName(f[COLS.NGUOI_GIAO]))}</div>`;
  else if (person === 'thuchien') personLine = `<div class="meta">${icon('user', 14)}Người thực hiện: ${esc(userName(f[COLS.NGUOI_THUC_HIEN]))}</div>`;
  else if (person === 'both') personLine = `<div class="meta">${icon('user', 14)}Người giao: ${esc(userName(f[COLS.NGUOI_GIAO]))} → Người thực hiện: ${esc(userName(f[COLS.NGUOI_THUC_HIEN]))}</div>`;

  return `
    <div class="card" data-id="${t.record_id}">
      <div class="card-title-row">
        <h3>${taskLabel(t)}${newBadge(t)}</h3>
        ${titleActionsHtml ? `<div class="icon-actions">${titleActionsHtml}</div>` : ''}
      </div>
      <div class="meta">SKU: ${esc(f[COLS.SKU]) || 'N/A'}</div>
      ${personLine}
      <div class="meta">${icon('calendar', 14)}Deadline: ${fmtDate(f[COLS.DEADLINE])}${deadlineBadge(t)}${showStatus ? ` &nbsp;${statusPill(f[COLS.TRANG_THAI])}` : ''}</div>
      ${showMota ? noteHtml(f[COLS.MO_TA_CHI_TIET]) : ''}
      ${attachmentsHtml(t)}
      ${actionsHtml}
    </div>`;
}

function iconBtn(name, label) {
  const iconName = ['edit-status', 'edit', 'edit-tpl', 'edit-user'].includes(name) ? 'edit'
    : name.includes('delete') ? 'trash'
    : name === 'restore-tpl' ? 'restore'
    : name;
  return `<button type="button" class="icon-btn" data-act="${name}" title="${label}">${icon(iconName, 16)}</button>`;
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
      const saveBtn = panel.querySelector('[data-act="save"]');
      saveBtn.onclick = () => withBusy(saveBtn, async () => {
        const errEl = panel.querySelector('[data-form-error]');
        try {
          await window.Api.updateStatus(t.record_id, panel.querySelector('[data-edit="status"]').value);
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      });
    },
  });
}

// Chia danh sách task thành các cụm theo mức khẩn cấp, trả về HTML (cụm rỗng thì bỏ)
function urgencyGroupsHtml(tasks, cardFn) {
  const groups = [
    { title: '🔴 Quá hạn', items: tasks.filter(t => daysToDeadline(t) < 0) },
    { title: '🟡 Hôm nay / Ngày mai', items: tasks.filter(t => [0, 1].includes(daysToDeadline(t))) },
    { title: 'Sắp tới', items: tasks.filter(t => daysToDeadline(t) > 1) },
  ];
  return groups
    .filter(g => g.items.length)
    .map(g => `<h3 class="group-title">${g.title} (${g.items.length})</h3>${grid(g.items.map(cardFn).join(''))}`)
    .join('');
}

async function renderMyTasks() {
  const tasks = await window.Api.getMyTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">Không có task nào.</div>'; return; }
  tasks.sort((a, b) => daysToDeadline(a) - daysToDeadline(b));
  mainEl.innerHTML = urgencyGroupsHtml(tasks, t => {
    const status = t.fields[COLS.TRANG_THAI];
    let action = '';
    if (status === STATUS.DANG_CHO) action = `<button class="btn-primary" data-act="start">${icon('arrowRight', 15)}Bắt đầu làm</button>`;
    else if (status === STATUS.DANG_LAM) action = `<button class="btn-secondary" data-act="pending-check">${icon('clock', 15)}Chờ check</button>`;
    return taskCard(t, { actionsHtml: action ? `<div class="actions">${action}</div>` : '', titleActionsHtml: iconBtn('edit-status', 'Sửa trạng thái'), person: 'giao', showMota: true });
  });

  mainEl.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    const startBtn = card.querySelector('[data-act="start"]');
    if (startBtn) startBtn.onclick = () => withBusy(startBtn, async () => {
      try { await window.Api.startTask(id); toast('Đã bắt đầu làm', 'success'); renderMyTasks(); }
      catch (err) { toast(err.message, 'error'); }
    });
    const pcBtn = card.querySelector('[data-act="pending-check"]');
    if (pcBtn) pcBtn.onclick = () => withBusy(pcBtn, async () => {
      try { await window.Api.pendingCheck(id); toast('Đã chuyển "Chờ check", sale sẽ nhận được thông báo duyệt', 'success'); renderMyTasks(); }
      catch (err) { toast(err.message, 'error'); }
    });
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
      <textarea data-edit="moTaChiTiet" rows="3">${esc(f[COLS.MO_TA_CHI_TIET] || '')}</textarea>
      <label>Deadline</label>
      <input type="date" data-edit="deadline" value="${deadlineVal}" />
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      const saveBtn = panel.querySelector('[data-act="save"]');
      saveBtn.onclick = () => withBusy(saveBtn, async () => {
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
      });
    },
  });
}

async function renderSentTasks() {
  const tasks = await window.Api.getSentTasks();
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">Không có task nào.</div>'; return; }

  // Cụm "Chờ bạn duyệt" nổi lên đầu — đây là việc duy nhất sale cần động tay ngay.
  const sentCard = (t) => {
    const status = t.fields[COLS.TRANG_THAI];
    const completeBtn = status === STATUS.CHO_CHECK ? `<div class="actions"><button class="btn-primary" data-act="complete">${icon('check', 15)}Hoàn thành</button></div>` : '';
    const titleActionsHtml = iconBtn('edit', 'Sửa') + iconBtn('delete', 'Xoá');
    return taskCard(t, { actionsHtml: completeBtn, titleActionsHtml, person: 'thuchien', showMota: true });
  };
  const needApprove = tasks.filter(t => t.fields[COLS.TRANG_THAI] === STATUS.CHO_CHECK);
  const others = tasks.filter(t => t.fields[COLS.TRANG_THAI] !== STATUS.CHO_CHECK)
    .sort((a, b) => daysToDeadline(a) - daysToDeadline(b));
  mainEl.innerHTML =
    (needApprove.length ? `<h3 class="group-title">👀 Chờ bạn duyệt (${needApprove.length})</h3>${grid(needApprove.map(sentCard).join(''))}` : '') +
    (others.length ? `<h3 class="group-title">Đang xử lý (${others.length})</h3>${grid(others.map(sentCard).join(''))}` : '');

  mainEl.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    const completeBtn = card.querySelector('[data-act="complete"]');
    if (completeBtn) completeBtn.onclick = () => withBusy(completeBtn, async () => {
      try { await window.Api.completeTask(id); toast('Đã xác nhận hoàn thành', 'success'); renderSentTasks(); }
      catch (err) { toast(err.message, 'error'); }
    });
    card.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      if (!(await confirmModal('Xoá task này? Không thể hoàn tác.'))) return;
      try { await window.Api.deleteTask(id); renderSentTasks(); } catch (err) { toast(err.message, 'error'); }
    });
    card.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
      openEditTaskModal(tasks.find(t => t.record_id === id), renderSentTasks);
    });
  });
}

// ─── Modal: gán người thực hiện (Admin) ───
function openAssignModal(t, mediaMembers, onSaved) {
  const options = mediaMembers.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
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
      const confirmBtn = panel.querySelector('[data-act="confirm"]');
      confirmBtn.onclick = () => withBusy(confirmBtn, async () => {
        const val = panel.querySelector('[data-f="assignee"]').value;
        const errEl = panel.querySelector('[data-form-error]');
        if (!val) { errEl.textContent = 'Chọn người thực hiện trước'; return; }
        try {
          await window.Api.assignTask(t.record_id, val);
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      });
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

// ─── Modal: chi tiết task của 1 người (dùng ở Lịch Media) ───
async function openWorkloadDetailModal(member) {
  openModal({ title: `Task của ${esc(member.name)}`, size: 'lg', bodyHtml: '<p class="modal-text">Đang tải...</p>' });
  const tasks = await window.Api.getTasksByMedia(member.id);
  const bodyHtml = tasks.length === 0
    ? '<p class="modal-text">Không có task đang xử lý.</p>'
    : grid(tasks.map(t => taskCard(t, { person: 'giao', showMota: true })).join(''));
  openModal({ title: `Task của ${esc(member.name)}`, size: 'lg', bodyHtml });
}

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Modal: task của 1 media đang phủ qua 1 ngày cụ thể (từ ngày giao tới deadline) ───
async function openMediaCalendarDayModal(member, dateKey) {
  const [y, mo, da] = dateKey.split('-').map(Number);
  const dayLabel = `${String(da).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
  openModal({ title: `${esc(member.name)} — ${dayLabel}`, size: 'lg', bodyHtml: '<p class="modal-text">Đang tải...</p>' });
  const tasks = await window.Api.getTasksByMedia(member.id);
  const inRange = tasks.filter(t => {
    if (!t.fields[COLS.DEADLINE]) return false;
    const end = new Date(Number(t.fields[COLS.DEADLINE])); end.setHours(0, 0, 0, 0);
    const start = t.created_at ? new Date(t.created_at) : new Date(end);
    start.setHours(0, 0, 0, 0);
    const day = new Date(y, mo - 1, da);
    return day >= start && day <= end;
  });
  const bodyHtml = inRange.length === 0
    ? '<p class="modal-text">Không có task nào phủ qua ngày này.</p>'
    : grid(inRange.map(t => taskCard(t, { person: 'giao', showMota: true })).join(''));
  openModal({ title: `${esc(member.name)} — ${dayLabel}`, size: 'lg', bodyHtml });
}

// ─── Lịch deadline media (Sale + Admin) — dạng lịch tháng, tô đậm theo số task chồng nhau
// (từ ngày giao tới deadline). Thay luôn cho tab Workload cũ: dòng đếm theo trạng thái
// ở đầu mỗi card cho admin thấy nhanh ai đang gánh bao nhiêu việc. ───
let mediaCalendarMonthOffset = 0; // 0 = tháng hiện tại, -1 = tháng trước (giới hạn xem lùi 1 tháng)
const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

async function renderMediaCalendar() {
  const calendar = await window.Api.getMediaCalendar();
  if (calendar.length === 0) { mainEl.innerHTML = '<div class="empty">Chưa có media nào.</div>'; return; }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(today.getFullYear(), today.getMonth() + mediaCalendarMonthOffset, 1);
  const year = base.getFullYear();
  const month = base.getMonth();
  const gridStart = new Date(year, month, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const cellDates = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const todayKey = localDateKey(today);
  const canGoBack = mediaCalendarMonthOffset > -1;
  const canGoForward = mediaCalendarMonthOffset < 0;

  const tierStyle = (count) => {
    if (count >= 3) return 'background:color-mix(in srgb, var(--accent) 60%, white); color:var(--accent-contrast); font-weight:700;';
    if (count === 2) return 'background:color-mix(in srgb, var(--accent) 35%, white); color:var(--accent); font-weight:700;';
    if (count === 1) return 'background:color-mix(in srgb, var(--accent) 15%, white); color:var(--accent); font-weight:600;';
    return 'color:var(--text-muted);';
  };

  const weekdayHeader = WEEKDAY_LABELS.map(w => `<div style="text-align:center; font-size:11px; color:var(--text-muted); padding:2px 0;">${w}</div>`).join('');

  mainEl.innerHTML = `
    <div class="hint" style="margin-bottom:12px;">Dải màu thể hiện khoảng thời gian xử lý task (từ ngày giao đến deadline) của từng media — ô càng đậm nghĩa là càng nhiều task đang chồng nhau vào ngày đó, kể cả task chưa tới hạn. Bấm số trên ô để xem danh sách task, bấm tên media để xem toàn bộ task đang xử lý.</div>
    <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:14px;">
      <button type="button" class="icon-btn" data-act="prev-month" ${canGoBack ? '' : 'disabled'} style="transform:rotate(90deg); ${canGoBack ? '' : 'opacity:.4; cursor:default;'}">${icon('chevron', 16)}</button>
      <div style="font-weight:600;">Tháng ${month + 1}/${year}</div>
      <button type="button" class="icon-btn" data-act="next-month" ${canGoForward ? '' : 'disabled'} style="transform:rotate(-90deg); ${canGoForward ? '' : 'opacity:.4; cursor:default;'}">${icon('chevron', 16)}</button>
    </div>
    ${grid(calendar.map(m => {
      const counts = { [STATUS.DANG_CHO]: 0, [STATUS.DANG_LAM]: 0, [STATUS.CHO_CHECK]: 0 };
      const load = {};
      for (const t of m.tasks) {
        if (t.status in counts) counts[t.status] += 1;
        if (!t.deadline) continue;
        const end = new Date(t.deadline); end.setHours(0, 0, 0, 0);
        const start = t.createdAt ? new Date(t.createdAt) : new Date(end);
        start.setHours(0, 0, 0, 0);
        if (start > end) continue;
        const cur = new Date(start);
        while (cur <= end) {
          const key = localDateKey(cur);
          load[key] = (load[key] || 0) + 1;
          cur.setDate(cur.getDate() + 1);
        }
      }
      const cellsHtml = cellDates.map(d => {
        const inMonth = d.getMonth() === month;
        const key = localDateKey(d);
        const count = load[key] || 0;
        const todayOutline = key === todayKey ? 'outline:1px solid var(--accent); outline-offset:-1px;' : '';
        const clickable = inMonth && count > 0;
        return `<div ${clickable ? `class="clickable" data-act="show-day" data-day="${key}"` : ''} style="opacity:${inMonth ? '1' : '.35'}; text-align:center; padding:5px 2px; border-radius:6px; font-size:11.5px; ${tierStyle(count)} ${todayOutline} ${clickable ? 'cursor:pointer;' : ''}">
          <div>${d.getDate()}</div>
          <div>${count || ''}</div>
        </div>`;
      }).join('');
      return `
        <div class="card" data-id="${esc(m.id)}">
          <h3 class="clickable" data-act="show-detail">${esc(m.name)}</h3>
          <div class="meta"><b>${m.tasks.length} task</b>&nbsp;— Đang chờ: ${counts[STATUS.DANG_CHO]} · Đang làm: ${counts[STATUS.DANG_LAM]} · Chờ check: ${counts[STATUS.CHO_CHECK]}</div>
          <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:3px; margin-top:8px;">${weekdayHeader}${cellsHtml}</div>
        </div>`;
    }).join(''))}`;

  mainEl.querySelector('[data-act="prev-month"]')?.addEventListener('click', () => {
    if (!canGoBack) return;
    mediaCalendarMonthOffset -= 1;
    renderMediaCalendar();
  });
  mainEl.querySelector('[data-act="next-month"]')?.addEventListener('click', () => {
    if (!canGoForward) return;
    mediaCalendarMonthOffset += 1;
    renderMediaCalendar();
  });

  mainEl.querySelectorAll('.card[data-id]').forEach(card => {
    const m = calendar.find(x => x.id === card.dataset.id);
    card.querySelector('[data-act="show-detail"]').onclick = () => openWorkloadDetailModal(m);
    card.querySelectorAll('[data-act="show-day"]').forEach(cell => {
      cell.onclick = () => openMediaCalendarDayModal(m, cell.dataset.day);
    });
  });
}

// ─── Modal: sửa toàn bộ thông tin task (Admin, tab Quản lý tổng) — trừ người giao ───
function openManageTaskModal(t, mediaMembers, onSaved) {
  const f = t.fields;
  const deadlineVal = f[COLS.DEADLINE] ? new Date(Number(f[COLS.DEADLINE])).toISOString().slice(0, 10) : '';
  const currentAssigneeId = f[COLS.NGUOI_THUC_HIEN]?.[0]?.id || '';
  const assigneeOptions = mediaMembers.map(m => `<option value="${esc(m.id)}" ${m.id === currentAssigneeId ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  const statusOptions = Object.values(STATUS).map(s => `<option value="${s}" ${s === f[COLS.TRANG_THAI] ? 'selected' : ''}>${s}</option>`).join('');

  openModal({
    title: `Sửa task: ${taskLabel(t)}`,
    size: 'lg',
    bodyHtml: `
      <label>Người giao (không thể đổi)</label>
      <input value="${esc(userName(f[COLS.NGUOI_GIAO]))}" disabled />
      <label>Yêu cầu</label>
      <input data-edit="taskName" maxlength="50" value="${esc(f[COLS.TASK_NAME])}" />
      <label>SKU</label>
      <input data-edit="sku" value="${esc(f[COLS.SKU])}" />
      <label>Mô tả chi tiết</label>
      <textarea data-edit="moTaChiTiet" rows="3">${esc(f[COLS.MO_TA_CHI_TIET] || '')}</textarea>
      <label>Deadline</label>
      <input type="date" data-edit="deadline" value="${deadlineVal}" />
      <label>Người thực hiện</label>
      <select data-edit="assignee"><option value="">Chưa gán</option>${assigneeOptions}</select>
      <label>Trạng thái</label>
      <select data-edit="status">${statusOptions}</select>
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      const saveBtn = panel.querySelector('[data-act="save"]');
      saveBtn.onclick = () => withBusy(saveBtn, async () => {
        const errEl = panel.querySelector('[data-form-error]');
        const deadlineVal2 = panel.querySelector('[data-edit="deadline"]').value;
        const assigneeVal = panel.querySelector('[data-edit="assignee"]').value;
        try {
          await window.Api.updateTaskAdmin(t.record_id, {
            taskName: panel.querySelector('[data-edit="taskName"]').value,
            sku: panel.querySelector('[data-edit="sku"]').value,
            moTaChiTiet: panel.querySelector('[data-edit="moTaChiTiet"]').value,
            deadline: deadlineVal2 ? new Date(deadlineVal2).getTime() : null,
            assigneeId: assigneeVal || null,
            status: panel.querySelector('[data-edit="status"]').value,
          });
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      });
    },
  });
}

// ─── Quản lý tổng (Admin): lọc theo trạng thái/người + tìm kiếm, mới nhất lên đầu ───
async function renderManageAll() {
  const [tasks, members] = await Promise.all([window.Api.getAllTasksAdmin(), window.Api.getTeamMembers()]);
  const mediaMembers = members.filter(m => (m.roles || []).includes('media'));
  if (tasks.length === 0) { mainEl.innerHTML = '<div class="empty">Chưa có task nào.</div>'; return; }

  tasks.sort((a, b) => Number(b.record_id) - Number(a.record_id));
  if (!state.manageFilters) state.manageFilters = { status: '', person: '', q: '' };
  const f = state.manageFilters;

  const isOverdue = (t) => t.fields[COLS.TRANG_THAI] !== STATUS.HOAN_THANH && daysToDeadline(t) < 0;
  const countByStatus = {};
  for (const t of tasks) {
    const s = t.fields[COLS.TRANG_THAI];
    countByStatus[s] = (countByStatus[s] || 0) + 1;
  }
  const overdueCount = tasks.filter(isOverdue).length;
  // '__overdue' là chip đặc biệt (không phải trạng thái DB): task chưa xong đã trễ deadline
  const chipDefs = [
    { value: '', label: `Tất cả (${tasks.length})` },
    { value: '__overdue', label: `🔴 Quá hạn (${overdueCount})` },
    ...Object.values(STATUS).map(s => ({ value: s, label: `${s} (${countByStatus[s] || 0})` })),
  ];
  const statusChips = chipDefs.map(c => `
    <div class="chip ${f.status === c.value ? 'active' : ''}" data-status="${c.value}">${c.label}</div>`).join('');

  const personOptions = members
    .map(m => `<option value="${esc(m.id)}" ${f.person === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

  mainEl.innerHTML = `
    <div class="card" style="margin-bottom:12px; gap:8px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <input id="manage-q" placeholder="Tìm theo tên task / SKU..." value="${esc(f.q)}" style="flex:1; min-width:180px; margin-top:0;" />
        <select id="manage-person" style="width:auto; min-width:160px; margin-top:0;">
          <option value="">Mọi người</option>${personOptions}
        </select>
      </div>
      <div class="chip-row">${statusChips}</div>
    </div>
    <div id="manage-list"></div>`;

  const listEl = document.getElementById('manage-list');

  function draw() {
    const q = f.q.trim().toLowerCase();
    const filtered = tasks.filter(t =>
      (!f.status || (f.status === '__overdue' ? isOverdue(t) : t.fields[COLS.TRANG_THAI] === f.status)) &&
      (!f.person || t.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.id === f.person || t.fields[COLS.NGUOI_GIAO]?.[0]?.id === f.person) &&
      (!q || `${t.fields[COLS.TASK_NAME] || ''} ${t.fields[COLS.SKU] || ''}`.toLowerCase().includes(q))
    );
    listEl.innerHTML = filtered.length === 0
      ? '<div class="empty">Không có task nào khớp bộ lọc.</div>'
      : grid(filtered.map(t => taskCard(t, { titleActionsHtml: iconBtn('edit', 'Sửa'), person: 'both', showMota: true })).join(''));
    listEl.querySelectorAll('.card').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('[data-act="edit"]').onclick = () => {
        openManageTaskModal(tasks.find(t => t.record_id === id), mediaMembers, renderManageAll);
      };
    });
  }

  document.getElementById('manage-q').oninput = (e) => { f.q = e.target.value; draw(); };
  document.getElementById('manage-person').onchange = (e) => { f.person = e.target.value; draw(); };
  mainEl.querySelectorAll('.chip[data-status]').forEach(chip => {
    chip.onclick = () => {
      f.status = chip.dataset.status;
      mainEl.querySelectorAll('.chip[data-status]').forEach(c => c.classList.toggle('active', c === chip));
      draw();
    };
  });

  draw();
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function renderCompleted() {
  if (!state.completedFilters) state.completedFilters = { month: currentMonthStr(), senderId: '' };
  const isAdmin = state.roles.includes('admin');

  const senderOptionsHtml = isAdmin
    ? sortSaleMembers(await window.Api.getTeamMembers())
        .map(m => `<option value="${esc(m.id)}" ${state.completedFilters.senderId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')
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

  // Tổng kết tháng: số task, thời gian xử lý trung bình; admin thêm số task theo từng media.
  let summaryHtml = '';
  if (tasks.length > 0) {
    const leadDays = tasks
      .filter(t => t.completed_at && t.created_at)
      .map(t => (new Date(t.completed_at) - new Date(t.created_at)) / 86400000);
    const avg = leadDays.length ? (leadDays.reduce((a, b) => a + b, 0) / leadDays.length).toFixed(1) : null;
    let perMedia = '';
    if (isAdmin) {
      const byMedia = {};
      for (const t of tasks) {
        const name = userName(t.fields[COLS.NGUOI_THUC_HIEN]);
        byMedia[name] = (byMedia[name] || 0) + 1;
      }
      perMedia = `<div class="meta" style="flex-wrap:wrap;">${Object.entries(byMedia)
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${esc(name)}: <b>${n}</b>`).join(' · ')}</div>`;
    }
    summaryHtml = `
      <div class="card" style="margin-bottom:12px;">
        <div class="meta"><b>${tasks.length}</b>&nbsp;task hoàn thành trong tháng${avg ? ` · trung bình <b>&nbsp;${avg}&nbsp;</b> ngày/task` : ''}</div>
        ${perMedia}
      </div>`;
  }

  const listHtml = tasks.length === 0
    ? '<div class="empty">Chưa có task hoàn thành.</div>'
    : grid(tasks.map(t => `
      <div class="card">
        <h3>${taskLabel(t)}</h3>
        <div class="meta">SKU: ${esc(t.fields[COLS.SKU]) || 'N/A'}</div>
        <div class="meta">${icon('user', 14)}${esc(userName(t.fields[COLS.NGUOI_GIAO]))} → ${esc(userName(t.fields[COLS.NGUOI_THUC_HIEN]))}</div>
        <div class="meta">${icon('calendar', 14)}Giao: ${fmtDate(new Date(t.created_at).getTime())} · Xong: ${t.completed_at ? fmtDate(new Date(t.completed_at).getTime()) : '—'}</div>
        ${t.fields[COLS.MO_TA_CHI_TIET] ? `<div class="note">${esc(t.fields[COLS.MO_TA_CHI_TIET])}</div>` : ''}
        ${attachmentsHtml(t)}
      </div>`).join(''));

  mainEl.innerHTML = filterBarHtml + summaryHtml + listHtml;

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
      <span>${icon('file', 14)}${esc(a.name)}</span>
      <button type="button" class="icon-btn" data-remove-attachment="${i}" title="Bỏ file">${icon('close', 14)}</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-remove-attachment]').forEach(btn => {
    btn.onclick = () => {
      state.pendingAttachments.splice(Number(btn.dataset.removeAttachment), 1);
      renderAttachmentList();
    };
  });
}

// Listener paste gắn vào document — phải gỡ khi rời form (render() gọi removePasteListener),
// nếu không đứng ở tab khác Ctrl+V ảnh vẫn âm thầm upload file rác lên server.
let pasteListener = null;
function removePasteListener() {
  if (pasteListener) { document.removeEventListener('paste', pasteListener); pasteListener = null; }
}

// ─── Màn hình xác nhận sau khi gửi task thành công ───
function showCreateSuccess(task, mode) {
  mainEl.innerHTML = `
    <div class="card" style="max-width:480px; margin:0 auto;">
      <h3>✅ Đã gửi task!</h3>
      <div class="meta">${taskLabel(task)}</div>
      <div class="meta">SKU: ${esc(task.fields[COLS.SKU]) || 'N/A'}</div>
      <div class="meta">${icon('calendar', 14)}Deadline: ${fmtDate(task.fields[COLS.DEADLINE])}</div>
      ${task.fields[COLS.NGUOI_THUC_HIEN] ? `<div class="meta">${icon('user', 14)}Người thực hiện: ${esc(userName(task.fields[COLS.NGUOI_THUC_HIEN]))}</div>` : ''}
      <div class="actions" style="margin-top:10px;">
        <button class="btn-primary" data-act="again">${icon('send', 15)}Gửi task khác</button>
      </div>
    </div>`;
  mainEl.querySelector('[data-act="again"]').onclick = () => renderTaskForm(mode);
}

// ─── Form gửi task dùng chung cho 2 luồng (trước đây là 2 hàm nhân bản ~120 dòng/hàm):
// mode 'sale':  Sale VN gửi task — "Người giao" tuỳ chọn, chỉ hiện Sale VN.
// mode 'media': Media gửi thay Sale TQ — "Người giao" bắt buộc là Sale TQ,
//               thêm ô "Người thực hiện" để gán luôn, khỏi qua bước "Task chờ gán". ───
async function renderTaskForm(mode) {
  const allMembers = await window.Api.getTeamMembers();
  const todayStr = new Date().toLocaleDateString('en-CA'); // chặn chọn deadline quá khứ

  let giaoFieldHtml = '';
  let assigneeFieldHtml = '';
  if (mode === 'sale') {
    const members = sortSaleMembers(allMembers).filter(m => !(m.roles || []).includes('shenzhen'));
    const options = members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    giaoFieldHtml = `
      <label>Người giao (không bắt buộc)</label>
      <select name="nguoiGiaoId" id="nguoi-giao-select" class="placeholder-active"><option value="">Để trống nếu chính bạn là người giao task này.</option>${options}</select>`;
  } else {
    const szOptions = allMembers.filter(m => (m.roles || []).includes('shenzhen'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    const mediaOptions = allMembers.filter(m => (m.roles || []).includes('media'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    giaoFieldHtml = `
      <label>Người giao (Shenzhen Team) *</label>
      <select name="nguoiGiaoId" required><option value="">Chọn thành viên Shenzhen Team...</option>${szOptions}</select>`;
    assigneeFieldHtml = `
      <label>Người thực hiện (không bắt buộc)</label>
      <select name="assigneeId"><option value="">Để trống nếu chính bạn là người thực hiện.</option>${mediaOptions}</select>`;
  }

  mainEl.innerHTML = `
    <form id="create-form">
      ${giaoFieldHtml}
      ${assigneeFieldHtml}

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
      <input type="date" name="deadline" required min="${todayStr}" />

      <label>File gốc (không bắt buộc, tối đa ${MAX_ATTACHMENTS} file, mỗi file ≤ ${MAX_ATTACHMENT_MB}MB)</label>
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

  const nguoiGiaoSelect = document.getElementById('nguoi-giao-select');
  if (nguoiGiaoSelect) nguoiGiaoSelect.onchange = () => nguoiGiaoSelect.classList.toggle('placeholder-active', !nguoiGiaoSelect.value);

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
    let files = [...(fileList || [])].filter(Boolean);
    if (files.length === 0) return;
    const remaining = MAX_ATTACHMENTS - state.pendingAttachments.length;
    if (files.length > remaining) {
      files = files.slice(0, Math.max(remaining, 0));
      toast(`Chỉ được đính kèm tối đa ${MAX_ATTACHMENTS} file/task, đã bỏ qua các file dư`, 'error');
      if (files.length === 0) return;
    }
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

  removePasteListener();
  pasteListener = (e) => {
    const items = [...e.clipboardData.items].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
    if (items.length) handleFiles(items);
  };
  document.addEventListener('paste', pasteListener);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    await withBusy(submitBtn, async () => {
      const errEl = document.getElementById('form-error');
      errEl.textContent = '';
      const fd = new FormData(form);
      const deadlineStr = fd.get('deadline');
      const body = {
        taskName: fd.get('taskName'),
        sku: fd.get('sku'),
        moTaChiTiet: fd.get('moTaChiTiet'),
        deadline: deadlineStr ? new Date(deadlineStr).getTime() : null,
        attachments: state.pendingAttachments,
      };
      try {
        let task;
        if (mode === 'sale') {
          task = await window.Api.createTask({ ...body, nguoiGiaoId: fd.get('nguoiGiaoId') || undefined });
        } else {
          task = await window.Api.createTaskFromMedia({
            ...body,
            nguoiGiaoId: fd.get('nguoiGiaoId'),
            assigneeId: fd.get('assigneeId') || undefined,
          });
        }
        state.pendingAttachments = [];
        removePasteListener();
        toast('Đã gửi task!', 'success');
        showCreateSuccess(task, mode);
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  };
}

// ─── Quản lý người (admin) ───────────────────────────────────────────
const ALL_ROLES = ['admin', 'sale', 'shenzhen', 'media'];
// Thành viên Shenzhen Team có thể là user ảo (không Open ID) khi chỉ dùng làm "Người giao".
function isTqOnly(roles) { return roles.length > 0 && roles.every(r => r === 'shenzhen'); }

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
      <label>Open ID${u ? '' : ' (lấy bằng cách nhắn "hi" cho bot lần đầu — bỏ trống nếu chỉ là Shenzhen Team)'}</label>
      <input data-f="openId" value="${u ? esc(u.id) : ''}" ${u ? 'disabled' : ''} placeholder="ou_xxxxxxxx" />
      <label>Tên đầy đủ</label>
      <input data-f="name" value="${u ? esc(u.name) : ''}" placeholder="丁皇俊英 (Dustin)" />
      <label>Vị trí</label>
      <div data-f="roles">${userRolesCheckboxes(u ? u.roles : [])}</div>
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      const saveBtn = panel.querySelector('[data-act="save"]');
      saveBtn.onclick = () => withBusy(saveBtn, async () => {
        const errEl = panel.querySelector('[data-form-error]');
        const roles = [...panel.querySelectorAll('[data-f="roles"] input:checked')].map(i => i.value);
        const name = panel.querySelector('[data-f="name"]').value.trim();
        if (!name || !roles.length) { errEl.textContent = 'Cần tên và ít nhất 1 vị trí'; return; }
        try {
          if (u) {
            await window.Api.updateUser(u.id, { name, roles });
          } else {
            const openId = panel.querySelector('[data-f="openId"]').value.trim();
            if (!openId && !isTqOnly(roles)) { errEl.textContent = 'Cần Open ID'; return; }
            await window.Api.createUser({ openId: openId || undefined, name, roles });
          }
          closeModal();
          onSaved();
        } catch (err) { errEl.textContent = err.message; }
      });
    },
  });
}

// ─── Đồng bộ Open ID từ danh bạ Feishu (không cần ai nhắn "hi" cho bot) ───
function openContactSyncModal(onDone) {
  openModal({ title: 'Đồng bộ từ danh bạ Feishu', size: 'lg', bodyHtml: '<p class="modal-text">Đang tải danh bạ...</p>' });

  window.Api.syncContacts().then(members => {
    const newMembers = members.filter(m => !m.alreadyAdded);
    const bodyHtml = newMembers.length === 0
      ? '<p class="modal-text">Không có người mới — mọi người trong danh bạ đã được thêm vào hệ thống.</p>'
      : `
        <div class="hint" style="margin-bottom:10px;">${newMembers.length} người chưa có trong hệ thống. Chọn vị trí rồi bấm "Thêm" cho từng người.</div>
        ${newMembers.map(m => `
          <div class="card" data-open-id="${esc(m.openId)}" style="margin-bottom:8px;">
            <div class="card-title-row">
              <h3>${esc(m.name)}</h3>
              <button type="button" class="btn-primary" data-act="add-contact">${icon('plus', 14)}Thêm</button>
            </div>
            <div data-f="roles">${userRolesCheckboxes([])}</div>
          </div>`).join('')}`;

    openModal({
      title: `Đồng bộ từ danh bạ Feishu (${newMembers.length} người mới)`,
      size: 'lg',
      bodyHtml,
      onMount: (panel) => {
        panel.querySelectorAll('[data-act="add-contact"]').forEach(btn => {
          btn.onclick = () => withBusy(btn, async () => {
            const card = btn.closest('[data-open-id]');
            const roles = [...card.querySelectorAll('[data-f="roles"] input:checked')].map(i => i.value);
            if (!roles.length) { toast('Chọn ít nhất 1 vị trí', 'error'); return; }
            try {
              await window.Api.createUser({ openId: card.dataset.openId, name: card.querySelector('h3').textContent, roles });
              card.remove();
              toast('Đã thêm', 'success');
              onDone();
            } catch (err) { toast(err.message, 'error'); }
          });
        });
      },
    });
  }).catch(err => {
    openModal({ title: 'Đồng bộ từ danh bạ Feishu', bodyHtml: `<p class="modal-text" style="color:var(--danger);">${esc(err.message)}</p>` });
  });
}

async function renderUsers() {
  const users = await window.Api.getUsers();
  mainEl.innerHTML = `
    <div class="actions" style="margin-bottom:12px;">
      <button class="btn-primary" data-act="add-user">${icon('plus', 15)}Thêm người</button>
      <button class="btn-secondary" data-act="sync-contacts">${icon('users', 15)}Đồng bộ từ danh bạ Feishu</button>
      <button class="btn-secondary" data-act="sync-bitable-full">${icon('check', 15)}Đồng bộ lại toàn bộ Bitable</button>
    </div>
    ${grid(users.map(u => `
      <div class="card" data-id="${esc(u.id)}">
        <div class="card-title-row">
          <h3>${esc(u.name)}</h3>
          <div class="icon-actions">${iconBtn('edit-user', 'Sửa')}${iconBtn('delete-user', 'Xoá')}</div>
        </div>
        <div class="meta">${(u.roles || []).map(r => ROLE_LABEL[r] || esc(r)).join(', ') || '—'}</div>
      </div>`).join(''))}`;

  document.querySelector('[data-act="add-user"]').onclick = () => openUserModal(null, renderUsers);
  document.querySelector('[data-act="sync-contacts"]').onclick = () => openContactSyncModal(renderUsers);
  document.querySelector('[data-act="sync-bitable-full"]').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const { synced } = await window.Api.syncBitableFull();
      toast(`Đã đồng bộ lại ${synced} task lên Bitable`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
    }
  };
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
      <textarea data-f="content" rows="5">${tpl ? esc(tpl.content) : ''}</textarea>
      ${helpHtml}
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save">${icon('check', 15)}Lưu</button>`,
    onMount: (panel) => {
      const saveBtn = panel.querySelector('[data-act="save"]');
      saveBtn.onclick = () => withBusy(saveBtn, async () => {
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
      });
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
      <input type="text" id="set-chatid" placeholder="oc_xxxxxxxx" value="${esc(s.morning_report_group_chat_id || '')}">
      <div class="error" data-form-error></div>`,
    footerHtml: `
      <button type="button" class="btn-secondary" data-modal-close>Huỷ</button>
      <button type="button" class="btn-primary" data-act="save-settings">${icon('check', 15)}Lưu cài đặt</button>`,
    onMount: (panel) => {
      panel.querySelectorAll('#set-days .day-chip').forEach(chip => {
        chip.onclick = () => chip.classList.toggle('active');
      });
      const saveBtn = panel.querySelector('[data-act="save-settings"]');
      saveBtn.onclick = () => withBusy(saveBtn, async () => {
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
      });
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
      <h3 style="margin:20px 0 8px; font-size:13px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.03em;">${esc(g.name)}</h3>
      ${grid(g.items.map(t => `
        <div class="card" data-key="${esc(t.key)}">
          <div class="card-title-row">
            <h3>${esc(t.title)}${t.is_system ? ' <span class="meta" style="display:inline;">(hệ thống)</span>' : ''}</h3>
            <div class="icon-actions">${iconBtn('edit-tpl', 'Sửa')}${t.is_system ? iconBtn('restore-tpl', 'Khôi phục nội dung mặc định') : iconBtn('delete-tpl', 'Xoá')}</div>
          </div>
          <div class="note">${t.content ? esc(t.content) : '<i>(trống — không gửi)</i>'}</div>
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
    card.querySelector('[data-act="restore-tpl"]')?.addEventListener('click', async () => {
      if (!(await confirmModal('Khôi phục nội dung mặc định cho mẫu này? Nội dung đã sửa sẽ mất.', { danger: false, confirmLabel: 'Khôi phục' }))) return;
      try { await window.Api.deleteMessageTemplate(key); toast('Đã khôi phục nội dung mặc định', 'success'); renderTemplates(); } catch (err) { toast(err.message, 'error'); }
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
          <input type="checkbox" class="file-checkbox" data-filename="${esc(f.name)}" data-group="${groupKey}" style="width:auto;margin:0;flex-shrink:0;">
          <a href="${esc(f.url)}" target="_blank" rel="noopener" style="flex:1;word-break:break-all;">${esc(f.name)}</a>
          <span>${fmtSize(f.size)}</span>
        </label>`).join('')}
    </div>`;
}

async function renderUploads() {
  const { groups, orphans } = await window.Api.listUploads();
  if (groups.length === 0 && orphans.length === 0) { mainEl.innerHTML = '<div class="empty">Chưa có file nào.</div>'; return; }

  const allFiles = [...groups.flatMap(g => g.files), ...orphans];
  const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);

  const groupsHtml = groups.map(g => uploadGroupHtml(String(g.taskId), esc(`${String(g.taskId).padStart(2, '0')}-${g.taskName}`), g.files)).join('');
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

// ─── Tab "Hôm nay" — màn hình vào mặc định, mỗi role thấy đúng thứ mình cần làm ngay ───
// Media: task khẩn cấp nhất + nút hành động. Sale: khối "Chờ bạn duyệt" + tiến độ.
// Admin: 4 ô số bấm được + danh sách tắc lâu nhất. User nhiều role thấy các khối xếp chồng.

function displayName(name) {
  return (name || '').match(/\(([^)]+)\)/)?.[1] || name || 'bạn';
}

function deadlinePhrase(t) {
  const d = daysToDeadline(t);
  if (d === Infinity) return 'không có deadline';
  if (d < 0) return `<span class="t-danger">quá hạn ${-d} ngày</span>`;
  if (d === 0) return '<span class="t-warn">deadline hôm nay</span>';
  if (d === 1) return '<span class="t-warn">deadline ngày mai</span>';
  return `deadline ${fmtDate(t.fields[COLS.DEADLINE])}`;
}

function homeTaskRow(t, subHtml, actionHtml) {
  const d = daysToDeadline(t);
  const cls = d < 0 ? 'urgent' : (d <= 1 ? 'soon' : '');
  return `
    <div class="home-task ${cls}" data-id="${t.record_id}">
      <div class="ht-info">
        <div class="ht-title">${taskLabel(t)}</div>
        <div class="ht-sub">${subHtml}</div>
      </div>
      ${actionHtml}
    </div>`;
}

async function renderHome() {
  const roles = state.roles;
  const isMedia = roles.includes('media');
  const isSale = roles.includes('sale');
  const isAdmin = roles.includes('admin');

  const [myTasks, sentTasks, allTasks, completedMonth] = await Promise.all([
    (isMedia || isAdmin) ? window.Api.getMyTasks() : [],
    (isSale || isAdmin) ? window.Api.getSentTasks() : [],
    isAdmin ? window.Api.getAllTasksAdmin() : [],
    isAdmin ? window.Api.getCompletedTasks({ month: currentMonthStr() }) : [],
  ]);

  const sections = [];

  // ── Khối Media: hôm nay phải làm gì trước ──
  if (isMedia || (isAdmin && myTasks.length > 0)) {
    const overdue = myTasks.filter(t => daysToDeadline(t) < 0);
    const soon = myTasks.filter(t => [0, 1].includes(daysToDeadline(t)));
    const later = myTasks.filter(t => daysToDeadline(t) > 1);
    const sorted = [...myTasks].sort((a, b) => daysToDeadline(a) - daysToDeadline(b));

    const rows = sorted.slice(0, 3).map(t => {
      const status = t.fields[COLS.TRANG_THAI];
      let action = '';
      if (status === STATUS.DANG_CHO) action = `<button class="btn-primary" data-act="start">${icon('arrowRight', 14)}Bắt đầu làm</button>`;
      else if (status === STATUS.DANG_LAM) action = `<button class="btn-secondary" data-act="pending-check">${icon('clock', 14)}Chờ check</button>`;
      else if (status === STATUS.CHO_CHECK) action = '<span class="ht-wait">đang chờ sale duyệt</span>';
      const sub = `giao bởi ${esc(userName(t.fields[COLS.NGUOI_GIAO]))} · ${deadlinePhrase(t)}${newBadge(t)}`;
      return homeTaskRow(t, sub, action);
    }).join('');

    const dateStr = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' });
    sections.push(`
      <div class="card home-sec" data-sec="media">
        <p class="home-greet">Chào ${esc(displayName(state.me?.name))} 👋</p>
        <p class="home-date">${dateStr[0].toUpperCase() + dateStr.slice(1)} — bạn có ${myTasks.length} task đang xử lý${overdue.length ? `, <span class="t-danger">${overdue.length} task quá hạn</span>` : ''}.</p>
        <div class="stat-grid">
          <div class="stat ${overdue.length ? 'stat-danger' : ''}"><div class="stat-n">${overdue.length}</div><div class="stat-l">Quá hạn</div></div>
          <div class="stat ${soon.length ? 'stat-warn' : ''}"><div class="stat-n">${soon.length}</div><div class="stat-l">Hôm nay / mai</div></div>
          <div class="stat"><div class="stat-n">${later.length}</div><div class="stat-l">Sắp tới</div></div>
        </div>
        ${rows || '<div class="empty" style="padding:16px 0;">Không có task nào — thảnh thơi!</div>'}
        ${myTasks.length > 3 ? `<button type="button" class="link-btn" data-tab-go="mine">Xem tất cả ${myTasks.length} task →</button>` : ''}
      </div>`);
  }

  // ── Khối Sale: chờ duyệt trên cùng + tiến độ ──
  if (isSale || (isAdmin && sentTasks.length > 0)) {
    const needApprove = sentTasks.filter(t => t.fields[COLS.TRANG_THAI] === STATUS.CHO_CHECK);
    const inProgress = sentTasks.filter(t => t.fields[COLS.TRANG_THAI] !== STATUS.CHO_CHECK)
      .sort((a, b) => daysToDeadline(a) - daysToDeadline(b));

    const approveRows = needApprove.map(t => homeTaskRow(
      t,
      `${esc(userName(t.fields[COLS.NGUOI_THUC_HIEN]))} đã xong, đang chờ bạn kiểm tra`,
      `<button class="btn-primary" data-act="complete">${icon('check', 14)}Duyệt xong</button>`
    )).join('');

    const progressRows = inProgress.slice(0, 5).map(t => `
      <div class="ht-row">
        <span class="ht-row-title">${taskLabel(t)}</span>
        <span class="ht-row-dl">${deadlinePhrase(t)}</span>
        <span class="ht-row-who">${esc(userName(t.fields[COLS.NGUOI_THUC_HIEN]))}</span>
        ${statusPill(t.fields[COLS.TRANG_THAI])}
      </div>`).join('');

    sections.push(`
      <div class="card home-sec" data-sec="sale">
        <div class="home-sec-head">
          <p class="home-sec-title">Chờ bạn duyệt ${needApprove.length ? `<span class="badge badge-warn">${needApprove.length}</span>` : ''}</p>
          <button type="button" class="btn-secondary" data-tab-go="create">${icon('plus', 14)}Giao task VN</button>
        </div>
        ${approveRows || '<div class="hint" style="margin:4px 0 10px;">Không có task nào chờ duyệt.</div>'}
        ${inProgress.length ? `<p class="home-sub-title">Đang xử lý (${inProgress.length})</p>${progressRows}` : ''}
        ${inProgress.length > 5 ? `<button type="button" class="link-btn" data-tab-go="sent">Xem tất cả →</button>` : ''}
      </div>`);
  }

  // ── Khối Admin: hệ thống tắc ở đâu ──
  if (isAdmin) {
    const activeSet = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK];
    const choGan = allTasks.filter(t => t.fields[COLS.TRANG_THAI] === STATUS.CHO_GAN);
    const overdueAll = allTasks.filter(t => t.fields[COLS.TRANG_THAI] !== STATUS.HOAN_THANH && daysToDeadline(t) < 0);
    const choCheck = allTasks.filter(t => t.fields[COLS.TRANG_THAI] === STATUS.CHO_CHECK);

    const stuck = [...overdueAll].sort((a, b) => daysToDeadline(a) - daysToDeadline(b)).slice(0, 3);
    const stuckRows = stuck.map(t => {
      const who = t.fields[COLS.NGUOI_THUC_HIEN]
        ? `${esc(userName(t.fields[COLS.NGUOI_THUC_HIEN]))} · ${esc(t.fields[COLS.TRANG_THAI])}`
        : 'Chưa gán';
      return `
        <div class="ht-row">
          <span class="t-danger" style="font-weight:600; flex-shrink:0;">${-daysToDeadline(t)} ngày</span>
          <span class="ht-row-title">${taskLabel(t)}</span>
          <span class="ht-row-who">${who}</span>
        </div>`;
    }).join('');

    sections.push(`
      <div class="card home-sec" data-sec="admin">
        <p class="home-sec-title">Toàn hệ thống</p>
        <div class="stat-grid stat-grid-4">
          <div class="stat ${choGan.length ? 'stat-warn' : ''} clickable" data-go="pending"><div class="stat-n">${choGan.length}</div><div class="stat-l">Chờ gán</div></div>
          <div class="stat ${overdueAll.length ? 'stat-danger' : ''} clickable" data-go="overdue"><div class="stat-n">${overdueAll.length}</div><div class="stat-l">Quá hạn</div></div>
          <div class="stat clickable" data-go="chocheck"><div class="stat-n">${choCheck.length}</div><div class="stat-l">Chờ duyệt</div></div>
          <div class="stat stat-ok clickable" data-go="completed"><div class="stat-n">${completedMonth.length}</div><div class="stat-l">Xong tháng ${new Date().getMonth() + 1}</div></div>
        </div>
        ${stuck.length ? `<p class="home-sub-title">Tắc lâu nhất</p>${stuckRows}` : '<div class="hint">Không có task quá hạn 🎉</div>'}
      </div>`);
  }

  mainEl.innerHTML = sections.join('') || '<div class="empty">Không có gì cần chú ý hôm nay.</div>';

  // Nút hành động trên từng dòng task
  mainEl.querySelectorAll('.home-task').forEach(row => {
    const id = row.dataset.id;
    const bind = (act, fn, okMsg) => {
      const btn = row.querySelector(`[data-act="${act}"]`);
      if (btn) btn.onclick = () => withBusy(btn, async () => {
        try { await fn(id); toast(okMsg, 'success'); renderHome(); decorateNavBadges(); }
        catch (err) { toast(err.message, 'error'); }
      });
    };
    bind('start', window.Api.startTask, 'Đã bắt đầu làm');
    bind('pending-check', window.Api.pendingCheck, 'Đã chuyển "Chờ check", sale sẽ nhận được thông báo duyệt');
    bind('complete', window.Api.completeTask, 'Đã xác nhận hoàn thành');
  });

  // Link "Xem tất cả" / "Gửi task mới" → nhảy tab
  mainEl.querySelectorAll('[data-tab-go]').forEach(btn => {
    btn.onclick = () => { state.tab = btn.dataset.tabGo; render(); };
  });

  // Ô số của admin → nhảy tới danh sách đã lọc sẵn
  mainEl.querySelectorAll('[data-go]').forEach(el => {
    el.onclick = () => {
      const go = el.dataset.go;
      if (go === 'pending') state.tab = 'pending';
      else if (go === 'completed') state.tab = 'completed';
      else {
        state.tab = 'manageAll';
        state.manageFilters = { status: go === 'overdue' ? '__overdue' : STATUS.CHO_CHECK, person: '', q: '' };
      }
      render();
    };
  });
}

// Mở từ "+" menu shortcut trong chat Feishu (panel nhỏ): chỉ hiện đúng form
// "Gửi task mới" của Sale, không có thanh tab, để gọn cho không gian hẹp của panel "+".
function renderEmbedCreate() {
  const roles = state.roles;
  navEl.style.display = 'none';
  document.getElementById('bottom-nav')?.remove();
  if (roles.includes('sale') || roles.includes('admin')) { renderTaskForm('sale'); return; }
  mainEl.innerHTML = '<div class="empty">Bạn không có quyền gửi task.</div>';
}

// ─── Bảng task chỉ-đọc cho người xem TQ (tiếng Trung) ─────────────
// Nội dung task (tên, mô tả) đã được backend dịch sẵn sang tiếng Trung; ở đây chỉ dịch các
// NHÃN CỐ ĐỊNH (~12 cái) + trạng thái. SKU/tên người giữ nguyên. Không có nút thao tác.
const BOARD_ZH = {
  tab: '任务看板',
  hint: '您可以查看任务看板（仅查看，不可编辑）。',
  empty: '暂无任务。',
  sku: 'SKU', giao: '派单人', thuc: '处理人', deadline: '截止日期',
  grpOverdue: '🔴 已逾期', grpToday: '🟡 今天 / 明天', grpUpcoming: '即将到来',
  today: '今天', tomorrow: '明天', overdueDays: (n) => `逾期 ${n} 天`,
  status: { 'Chờ gán người thực hiện': '待分配处理人', 'Đang chờ': '等待中', 'Đang làm': '进行中', 'Chờ check': '待检查', 'Hoàn thành': '已完成' },
};

function boardStatusPill(vnStatus) {
  const zh = BOARD_ZH.status[vnStatus] || vnStatus || '—';
  return `<span class="status-pill"><span class="status-dot ${STATUS_DOT[vnStatus] || ''}"></span>${esc(zh)}</span>`;
}
function boardDeadlineBadge(t) {
  const diff = daysToDeadline(t);
  if (diff === Infinity) return '';
  if (diff < 0) return ` <span class="badge badge-danger">${BOARD_ZH.overdueDays(-diff)}</span>`;
  if (diff === 0) return ` <span class="badge badge-warn">${BOARD_ZH.today}</span>`;
  if (diff === 1) return ` <span class="badge badge-warn">${BOARD_ZH.tomorrow}</span>`;
  return '';
}
function boardCard(t) {
  const f = t.fields;
  const mota = f[COLS.MO_TA_CHI_TIET];
  return `
    <div class="card">
      <h3>${t.record_id}-${esc(f[COLS.TASK_NAME] || 'N/A')}</h3>
      <div class="meta">${BOARD_ZH.sku}: ${esc(f[COLS.SKU]) || 'N/A'}</div>
      <div class="meta">${icon('user', 14)}${BOARD_ZH.giao}: ${esc(userName(f[COLS.NGUOI_GIAO]))} → ${BOARD_ZH.thuc}: ${esc(userName(f[COLS.NGUOI_THUC_HIEN]))}</div>
      <div class="meta">${icon('calendar', 14)}${BOARD_ZH.deadline}: ${fmtDate(f[COLS.DEADLINE])}${boardDeadlineBadge(t)} &nbsp;${boardStatusPill(f[COLS.TRANG_THAI])}</div>
      ${mota ? `<div class="note">${esc(mota)}</div>` : ''}
      ${attachmentsHtml(t)}
    </div>`;
}
async function renderBoard() {
  const all = await window.Api.getBoard();
  const tasks = all.filter(t => t.fields[COLS.TRANG_THAI] !== STATUS.HOAN_THANH);
  if (tasks.length === 0) { mainEl.innerHTML = `<div class="empty">${BOARD_ZH.empty}</div>`; return; }
  tasks.sort((a, b) => daysToDeadline(a) - daysToDeadline(b));
  const groups = [
    { title: BOARD_ZH.grpOverdue, items: tasks.filter(t => daysToDeadline(t) < 0) },
    { title: BOARD_ZH.grpToday, items: tasks.filter(t => [0, 1].includes(daysToDeadline(t))) },
    { title: BOARD_ZH.grpUpcoming, items: tasks.filter(t => daysToDeadline(t) > 1) },
  ];
  mainEl.innerHTML = `<div class="hint" style="margin-bottom:12px;">${BOARD_ZH.hint}</div>` +
    groups.filter(g => g.items.length).map(g => `<h3 class="group-title">${g.title} (${g.items.length})</h3>${grid(g.items.map(boardCard).join(''))}`).join('');
}

// Người chỉ có vai trò shenzhen (Shenzhen Team), không có vai trò thao tác nào = chỉ được xem.
function isViewerOnly(roles) {
  const hasWrite = roles.includes('sale') || roles.includes('media') || roles.includes('admin');
  return !hasWrite && roles.includes('shenzhen');
}

function render() {
  // Rời form tạo task thì gỡ paste listener — tránh Ctrl+V ở tab khác âm thầm upload file.
  removePasteListener();
  if (state.embed) { renderEmbedCreate(); return; }
  const roles = state.roles;

  // Người xem TQ: chỉ 1 tab bảng task chỉ-đọc (tiếng Trung), không có nhóm quản trị.
  if (isViewerOnly(roles)) {
    setNav([{ key: 'board', label: BOARD_ZH.tab }], []);
    state.tab = 'board';
    mainEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    Promise.resolve(renderBoard()).catch(err => { mainEl.innerHTML = `<div class="error">${esc(err.message)}</div>`; });
    // Tự làm mới mỗi 2 phút để thấy task mới mà không cần refresh tay (đặt 1 lần).
    if (!window.__boardTimer) window.__boardTimer = setInterval(() => { renderBoard().catch(() => {}); }, 120000);
    return;
  }

  const tabs = [{ key: 'home', label: 'Hôm nay' }];
  // Giao task VN: Sale VN (+admin). Giao task TQ: Media VN (+admin). Admin thấy cả 2.
  if (roles.includes('sale') || roles.includes('admin')) tabs.push({ key: 'create', label: 'Giao task VN' });
  if (roles.includes('media') || roles.includes('admin')) tabs.push({ key: 'createMedia', label: 'Giao task TQ' });
  if (roles.includes('sale') || roles.includes('admin')) tabs.push({ key: 'sent', label: 'Task đã gửi' });
  if (roles.includes('sale') || roles.includes('admin')) tabs.push({ key: 'mediaCalendar', label: 'Lịch Media' });
  if (roles.includes('media') || roles.includes('admin')) tabs.push({ key: 'mine', label: 'Task của tôi' });
  if (roles.includes('admin')) tabs.push({ key: 'pending', label: 'Task chờ gán' });
  tabs.push({ key: 'completed', label: 'Task đã làm' });

  // Nhóm quản trị gom vào 1 nút riêng để nav không tràn (chỉ admin có).
  const adminTabs = roles.includes('admin') ? [
    { key: 'manageAll', label: 'Quản lý tổng' },
    { key: 'users', label: 'Quản lý người' },
    { key: 'templates', label: 'Mẫu tin nhắn' },
    { key: 'uploads', label: 'File đính kèm' },
  ] : [];

  if (!state.tab) state.tab = tabs[0]?.key;
  setNav(tabs, adminTabs);

  const renderers = {
    home: renderHome,
    create: () => renderTaskForm('sale'), createMedia: () => renderTaskForm('media'),
    sent: renderSentTasks, mine: renderMyTasks, pending: renderPendingTasks,
    mediaCalendar: renderMediaCalendar, completed: renderCompleted, manageAll: renderManageAll, users: renderUsers,
    templates: renderTemplates, uploads: renderUploads,
  };
  const renderTab = renderers[state.tab] || (() => { mainEl.innerHTML = '<div class="empty">Không có quyền truy cập.</div>'; });
  // Hiện spinner ngay khi chuyển tab — không giữ nguyên nội dung tab cũ trong lúc chờ fetch.
  mainEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  // Nếu renderTab lỗi (vd 403 do thiếu role ở backend), báo lỗi rõ ràng thay vì im lặng.
  Promise.resolve(renderTab()).catch(err => {
    mainEl.innerHTML = `<div class="error">Lỗi: ${esc(err.message)}</div>`;
  });
}

// ─── Header: profile chip + modal hồ sơ + welcome modal (chỉ lần đầu mỗi ngày) ───
function setupProfileChip(me) {
  const chip = document.getElementById('profile-chip');
  chip.innerHTML = `<span class="avatar">${esc(initials(me.name))}</span><span class="name">${esc(me.name || '')}</span>`;
  chip.onclick = () => openModal({
    title: 'Hồ sơ',
    bodyHtml: `
      <div class="welcome-body">
        <div class="welcome-avatar">${esc(initials(me.name))}</div>
        <p class="welcome-name">${esc(me.name || '')}</p>
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
  // Chỉ chào lần đầu trong ngày — mở app chục lần/ngày mà lần nào cũng phải bấm "Bắt đầu" thì phiền.
  const todayStr = new Date().toLocaleDateString('en-CA');
  if (localStorage.getItem('welcomeShownDate') === todayStr) return;
  localStorage.setItem('welcomeShownDate', todayStr);

  // Người xem TQ (Shenzhen Team) chào bằng tiếng Trung; còn lại tiếng Việt như cũ.
  const viewer = isViewerOnly(me.roles);
  const greet = viewer ? `你好，${esc(me.name || '')}！` : `Chào ${esc(me.name || 'bạn')}!`;
  const roleLabel = viewer ? 'Shenzhen Team' : highestRoleLabel(me.roles);
  const startBtn = viewer ? '开始' : 'Bắt đầu';

  openModal({
    title: '',
    size: 'sm',
    bodyHtml: `
      <div class="welcome-body">
        <div class="welcome-avatar">${esc(initials(me.name))}</div>
        <p class="welcome-name">${greet}</p>
        <p class="welcome-role">${roleLabel}</p>
      </div>`,
    footerHtml: `<button type="button" class="btn-primary" style="width:100%;justify-content:center;" data-modal-close>${startBtn}</button>`,
  });
}

(async function init() {
  try {
    await window.Api.ensureLoggedIn();
    // Đọc sau khi ensureLoggedIn xong (không phải trước): nếu vừa đăng nhập lần đầu,
    // query string gốc (?embed=1) chỉ được khôi phục vào URL sau khi xử lý code OAuth.
    state.embed = new URLSearchParams(window.location.search).get('embed') === '1';
    const me = await window.Api.getMe();
    if (me.roles.length === 0) {
      // Đã ở trong tổ chức, đăng nhập được nhưng admin chưa gán vị trí (song ngữ cho cả người TQ).
      mainEl.innerHTML = '<div class="empty">Bạn đang chờ admin cấp quyền truy cập.<br>您正在等待管理员授予访问权限。</div>';
      return;
    }
    state.roles = me.roles;
    state.me = me;

    // Toggle "Xem thêm" của mô tả và "+N file khác" của đính kèm — delegation 1 lần
    // vì card bị render lại liên tục ở mọi tab.
    document.addEventListener('click', (e) => {
      const noteBtn = e.target.closest('[data-note-toggle]');
      if (noteBtn) {
        const expanded = noteBtn.closest('.note-wrap').querySelector('.note').classList.toggle('expanded');
        noteBtn.textContent = expanded ? 'Thu gọn' : 'Xem thêm';
        return;
      }
      const attBtn = e.target.closest('[data-att-toggle]');
      if (attBtn) {
        e.preventDefault();
        const hidden = attBtn.closest('.att-wrap').querySelector('.att-extra').toggleAttribute('hidden');
        attBtn.textContent = hidden ? attBtn.dataset.more : 'Thu gọn';
      }
    });

    setupProfileChip(me);
    render();
    if (!state.embed) showWelcomeModal(me);
  } catch (err) {
    if (err.message !== 'redirecting') {
      mainEl.innerHTML = `<div class="error">Lỗi: ${esc(err.message)}</div>`;
    }
  }
})();
