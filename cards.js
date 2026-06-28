const config = require('./config');
const { formatUser, formatText, formatDate } = require('./helpers');

const { STATUS } = config;

function cardMainMenu(roles) {
  const isSale = roles.includes('sale');
  const isMedia = roles.includes('media') || roles.includes('admin');
  const elements = [];

  if (isSale) {
    elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": "**📤 Sale**" } });
    elements.push({
      "tag": "action",
      "actions": [
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Gửi task mới" },
          "type": "primary",
          "url": config.WEBAPP_URL,
          "multi_url": { "url": config.WEBAPP_URL, "pc_url": config.WEBAPP_URL, "android_url": config.WEBAPP_URL, "ios_url": config.WEBAPP_URL }
        },
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Kiểm tra task đã gửi" },
          "type": "default",
          "value": { "key": "sale_my_tasks" }
        }
      ]
    });
    elements.push({ "tag": "hr" });
  }

  if (isMedia) {
    elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": "**🎨 Media & Admin**" } });
    elements.push({
      "tag": "action",
      "actions": [
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Task của tôi" },
          "type": "primary",
          "value": { "key": "media_my_tasks" }
        },
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Task chờ gán" },
          "type": "default",
          "value": { "key": "admin_pending_tasks" }
        },
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Workload team" },
          "type": "default",
          "value": { "key": "admin_workload" }
        }
      ]
    });
  }

  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": "📋 Task Manager" }, "template": "blue" },
    "elements": elements
  };
}

function cardMediaTasks(tasks) {
  if (tasks.length === 0) {
    return {
      "config": { "wide_screen_mode": true },
      "header": { "title": { "tag": "plain_text", "content": "📋 Task Của Bạn" }, "template": "blue" },
      "elements": [{ "tag": "div", "text": { "tag": "lark_md", "content": "✅ Không có task nào đang xử lý." } }]
    };
  }

  const { COLS } = config;
  const elements = [];

  tasks.forEach((t, i) => {
    const taskName = formatText(t.fields[COLS.TASK_NAME]);
    const nguoiGiao = formatUser(t.fields[COLS.NGUOI_GIAO]);
    const deadline = formatDate(t.fields[COLS.DEADLINE]);
    const trangThai = formatText(t.fields[COLS.TRANG_THAI]);
    const recordId = t.record_id;

    elements.push({
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": `**${i + 1}. ${taskName}**\n👤 Người giao: ${nguoiGiao}\n📅 Deadline: ${deadline}\n📌 Trạng thái: ${trangThai}`
      }
    });

    const buttons = [];
    if (trangThai === STATUS.DANG_CHO) {
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Bắt đầu làm" },
        "type": "primary",
        "value": { "key": "start_task", "record_id": recordId }
      });
    } else if (trangThai === STATUS.DANG_LAM) {
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Chờ check" },
        "type": "default",
        "value": { "key": "pending_check", "record_id": recordId }
      });
    } else if (trangThai === STATUS.CHO_CHECK) {
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Hoàn thành" },
        "type": "success",
        "value": { "key": "complete_task", "record_id": recordId }
      });
    }

    if (buttons.length > 0) elements.push({ "tag": "action", "actions": buttons });
    if (i < tasks.length - 1) elements.push({ "tag": "hr" });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": `📋 Task Của Bạn (${tasks.length})` }, "template": "blue" },
    "elements": elements
  };
}

function cardSaleTasks(tasks) {
  if (tasks.length === 0) {
    return {
      "config": { "wide_screen_mode": true },
      "header": { "title": { "tag": "plain_text", "content": "📤 Task Đã Gửi" }, "template": "green" },
      "elements": [{ "tag": "div", "text": { "tag": "lark_md", "content": "✅ Không có task nào đang xử lý." } }]
    };
  }

  const { COLS } = config;
  const elements = [];

  tasks.forEach((t, i) => {
    const taskName = formatText(t.fields[COLS.TASK_NAME]);
    const nguoiThucHien = formatUser(t.fields[COLS.NGUOI_THUC_HIEN]);
    const deadline = formatDate(t.fields[COLS.DEADLINE]);
    const trangThai = formatText(t.fields[COLS.TRANG_THAI]);
    const recordId = t.record_id;

    elements.push({
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": `**${i + 1}. ${taskName}**\n👤 Người thực hiện: ${nguoiThucHien}\n📅 Deadline: ${deadline}\n📌 Trạng thái: ${trangThai}`
      }
    });

    if (trangThai === STATUS.CHO_CHECK) {
      elements.push({
        "tag": "action",
        "actions": [{
          "tag": "button",
          "text": { "tag": "plain_text", "content": "✅ Hoàn Thành" },
          "type": "success",
          "value": { "key": "complete_task", "record_id": recordId }
        }]
      });
    }

    if (i < tasks.length - 1) elements.push({ "tag": "hr" });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": `📤 Task Đã Gửi (${tasks.length})` }, "template": "green" },
    "elements": elements
  };
}

function cardPendingTasks(tasks, mediaMembers) {
  if (tasks.length === 0) {
    return {
      "config": { "wide_screen_mode": true },
      "header": { "title": { "tag": "plain_text", "content": "⏳ Task Chờ Gán" }, "template": "orange" },
      "elements": [{ "tag": "div", "text": { "tag": "lark_md", "content": "✅ Không có task nào chờ gán." } }]
    };
  }

  const { COLS } = config;
  const elements = [];
  const options = mediaMembers.map(m => ({
    "text": { "tag": "plain_text", "content": m.name },
    "value": m.id
  }));

  tasks.forEach((t, i) => {
    const taskName = formatText(t.fields[COLS.TASK_NAME]);
    const nguoiGiao = formatUser(t.fields[COLS.NGUOI_GIAO]);
    const deadline = formatDate(t.fields[COLS.DEADLINE]);
    const recordId = t.record_id;

    elements.push({
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": `**${i + 1}. ${taskName}**\n👤 Người giao: ${nguoiGiao}\n📅 Deadline: ${deadline}`
      }
    });
    elements.push({
      "tag": "action",
      "actions": [
        {
          "tag": "select_static",
          "placeholder": { "tag": "plain_text", "content": "Chọn người thực hiện..." },
          "options": options,
          "value": { "key": "assign_task", "record_id": recordId }
        }
      ]
    });

    if (i < tasks.length - 1) elements.push({ "tag": "hr" });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": `⏳ Task Chờ Gán (${tasks.length})` }, "template": "orange" },
    "elements": elements
  };
}

function cardSaleApprove(recordId, taskName, sku) {
  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": "👀 Task Chờ Duyệt" }, "template": "yellow" },
    "elements": [
      {
        "tag": "div",
        "text": { "tag": "lark_md", "content": `**Task:** ${taskName}\n**SKU:** ${sku}\n\nMedia đã hoàn thành, vui lòng kiểm tra và xác nhận.` }
      },
      { "tag": "hr" },
      {
        "tag": "action",
        "actions": [{
          "tag": "button",
          "text": { "tag": "plain_text", "content": "✅ Hoàn Thành" },
          "type": "primary",
          "value": { "key": "complete_task", "record_id": recordId }
        }]
      }
    ]
  };
}

function cardWorkload(workload) {
  const elements = workload.map(m => ({
    "tag": "div",
    "text": {
      "tag": "lark_md",
      "content": `**@${m.name}**\nĐang chờ: ${m.dang_cho} | Đang làm: ${m.dang_lam} | Chờ check: ${m.cho_check} | **Tổng: ${m.total}**`
    }
  }));

  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": "👥 Workload Team" }, "template": "purple" },
    "elements": elements.length > 0 ? elements : [{ "tag": "div", "text": { "tag": "lark_md", "content": "✅ Team không có task nào đang xử lý." } }]
  };
}

// greeting: lời chào đã render từ mẫu tin nhắn "morning_media_greeting" (đã thay $ten_nguoi_nhan)
function cardMorningMedia(tasks, greeting) {
  const { COLS } = config;
  const elements = [
    { "tag": "div", "text": { "tag": "lark_md", "content": greeting } },
    { "tag": "hr" }
  ];

  tasks.forEach((t, i) => {
    const taskName = formatText(t.fields[COLS.TASK_NAME]);
    const deadline = formatDate(t.fields[COLS.DEADLINE]);
    const trangThai = formatText(t.fields[COLS.TRANG_THAI]);
    elements.push({
      "tag": "div",
      "text": { "tag": "lark_md", "content": `**${i + 1}. ${taskName}**\n📅 Deadline: ${deadline} | 📌 ${trangThai}` }
    });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": `☀️ Báo cáo sáng (${tasks.length} task)` }, "template": "yellow" },
    "elements": elements
  };
}

// pendingTasks: task[] đang Chờ gán (hiện đầy đủ tên + SKU + mô tả ngắn).
// tasksByPerson: [{ name, tasks: [{ taskName, trangThai, deadline }] }] — task đang xử lý, gom theo người.
// title: tiêu đề đã render từ mẫu "morning_admin_title".
function cardMorningAdmin(pendingTasks, tasksByPerson, title) {
  const { COLS } = config;
  const elements = [];

  elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": `⏳ **Task chờ gán (${pendingTasks.length})**` } });
  if (pendingTasks.length === 0) {
    elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": "Không có" } });
  } else {
    pendingTasks.forEach(t => {
      const taskName = formatText(t.fields[COLS.TASK_NAME]);
      const sku = formatText(t.fields[COLS.SKU]);
      const moTa = formatText(t.fields[COLS.MO_TA_CHI_TIET]);
      elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": `• **${taskName}** (${sku})\n${moTa}` } });
    });
  }

  elements.push({ "tag": "hr" });
  elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": "**Task đang xử lý:**" } });

  if (tasksByPerson.length === 0) {
    elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": "Không có" } });
  } else {
    tasksByPerson.forEach(p => {
      const lines = p.tasks.map(t => `• ${t.taskName} — ${t.trangThai} — ${t.deadline}`).join('\n');
      elements.push({ "tag": "div", "text": { "tag": "lark_md", "content": `**@${p.name}**\n${lines}` } });
    });
  }

  return {
    "config": { "wide_screen_mode": true },
    "header": { "title": { "tag": "plain_text", "content": title || '☀️ Báo cáo sáng cho Admin' }, "template": "red" },
    "elements": elements
  };
}

module.exports = {
  cardMainMenu, cardMediaTasks, cardSaleTasks,
  cardPendingTasks, cardSaleApprove, cardWorkload,
  cardMorningMedia, cardMorningAdmin
};
