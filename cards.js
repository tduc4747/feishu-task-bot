const config = require('./config');
const { formatUser, formatText, formatDate } = require('./helpers');

const { STATUS } = config;

// ─── Card menu chính ─────────────────────────────────────────────
function cardMainMenu(roles) {
  const isSale = roles.includes('sale');
  const isMedia = roles.includes('media') || roles.includes('admin');

  const elements = [];

  if (isSale) {
    elements.push({
      "tag": "div",
      "text": { "tag": "lark_md", "content": "**📤 Sale**" }
    });
    elements.push({
      "tag": "action",
      "actions": [
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Gửi task mới" },
          "type": "primary",
          "url": config.FORM_URL,
          "multi_url": {
            "url": config.FORM_URL,
            "pc_url": config.FORM_URL,
            "android_url": config.FORM_URL,
            "ios_url": config.FORM_URL
          }
        },
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Kiểm tra task đã gửi" },
          "type": "default",
          "value": { "action": "sale_my_tasks" }
        }
      ]
    });
    elements.push({ "tag": "hr" });
  }

  if (isMedia) {
    elements.push({
      "tag": "div",
      "text": { "tag": "lark_md", "content": "**🎨 Media & Admin**" }
    });

    const mediaButtons = [
      {
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Task của tôi" },
        "type": "primary",
        "value": { "action": "media_my_tasks" }
      },
      {
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Task chờ gán" },
        "type": "default",
        "value": { "action": "admin_pending_tasks" }
      },
      {
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Workload team" },
        "type": "default",
        "value": { "action": "admin_workload" }
      }
    ];

    elements.push({ "tag": "action", "actions": mediaButtons });
  }

  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": "📋 Task Manager" },
      "template": "blue"
    },
    "elements": elements
  };
}

// ─── Card task của media ─────────────────────────────────────────
function cardMediaTasks(tasks, messageId) {
  if (tasks.length === 0) {
    return {
      "config": { "wide_screen_mode": true },
      "header": {
        "title": { "tag": "plain_text", "content": "📋 Task Của Bạn" },
        "template": "blue"
      },
      "elements": [
        { "tag": "div", "text": { "tag": "lark_md", "content": "✅ Không có task nào đang xử lý." } }
      ]
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
        "value": { "action": "start_task", "record_id": recordId, "message_id": messageId }
      });
    } else if (trangThai === STATUS.DANG_LAM) {
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Chờ check" },
        "type": "default",
        "value": { "action": "pending_check", "record_id": recordId, "message_id": messageId }
      });
    } else if (trangThai === STATUS.CHO_CHECK) {
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "Hoàn thành" },
        "type": "success",
        "value": { "action": "complete_task", "record_id": recordId, "message_id": messageId }
      });
    }

    if (buttons.length > 0) {
      elements.push({ "tag": "action", "actions": buttons });
    }

    if (i < tasks.length - 1) elements.push({ "tag": "hr" });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": `📋 Task Của Bạn (${tasks.length})` },
      "template": "blue"
    },
    "elements": elements
  };
}

// ─── Card task của sale ──────────────────────────────────────────
function cardSaleTasks(tasks, messageId) {
  if (tasks.length === 0) {
    return {
      "config": { "wide_screen_mode": true },
      "header": {
        "title": { "tag": "plain_text", "content": "📤 Task Đã Gửi" },
        "template": "green"
      },
      "elements": [
        { "tag": "div", "text": { "tag": "lark_md", "content": "✅ Không có task nào đang xử lý." } }
      ]
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
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "Hoàn thành" },
            "type": "success",
            "value": { "action": "complete_task", "record_id": recordId, "message_id": messageId }
          }
        ]
      });
    }

    if (i < tasks.length - 1) elements.push({ "tag": "hr" });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": `📤 Task Đã Gửi (${tasks.length})` },
      "template": "green"
    },
    "elements": elements
  };
}

// ─── Card task chờ gán (admin) ───────────────────────────────────
function cardPendingTasks(tasks, mediaMembers) {
  if (tasks.length === 0) {
    return {
      "config": { "wide_screen_mode": true },
      "header": {
        "title": { "tag": "plain_text", "content": "⏳ Task Chờ Gán" },
        "template": "orange"
      },
      "elements": [
        { "tag": "div", "text": { "tag": "lark_md", "content": "✅ Không có task nào chờ gán." } }
      ]
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
          "value": { "action": "select_assignee", "record_id": recordId }
        },
        {
          "tag": "button",
          "text": { "tag": "plain_text", "content": "Gán" },
          "type": "primary",
          "value": { "action": "assign_task", "record_id": recordId }
        }
      ]
    });

    if (i < tasks.length - 1) elements.push({ "tag": "hr" });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": `⏳ Task Chờ Gán (${tasks.length})` },
      "template": "orange"
    },
    "elements": elements
  };
}

// ─── Card workload team (admin) ──────────────────────────────────
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
    "header": {
      "title": { "tag": "plain_text", "content": "👥 Workload Team" },
      "template": "purple"
    },
    "elements": elements.length > 0 ? elements : [
      { "tag": "div", "text": { "tag": "lark_md", "content": "✅ Team không có task nào đang xử lý." } }
    ]
  };
}

// ─── Card thông báo 8h sáng cho media ───────────────────────────
function cardMorningMedia(tasks, name) {
  const { COLS } = config;
  const elements = [
    {
      "tag": "div",
      "text": { "tag": "lark_md", "content": `Chào ${name}! Đây là danh sách task chưa hoàn thành của bạn hôm nay:` }
    },
    { "tag": "hr" }
  ];

  tasks.forEach((t, i) => {
    const taskName = formatText(t.fields[COLS.TASK_NAME]);
    const deadline = formatDate(t.fields[COLS.DEADLINE]);
    const trangThai = formatText(t.fields[COLS.TRANG_THAI]);
    elements.push({
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": `**${i + 1}. ${taskName}**\n📅 Deadline: ${deadline} | 📌 ${trangThai}`
      }
    });
  });

  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": `☀️ Báo cáo sáng (${tasks.length} task)` },
      "template": "yellow"
    },
    "elements": elements
  };
}

// ─── Card thông báo 8h sáng cho admin ───────────────────────────
function cardMorningAdmin(pendingCount, activeTasks) {
  const { COLS } = config;

  const activeLines = activeTasks.map(t => {
    const taskName = formatText(t.fields[COLS.TASK_NAME]);
    const nguoiThucHien = formatUser(t.fields[COLS.NGUOI_THUC_HIEN]);
    const trangThai = formatText(t.fields[COLS.TRANG_THAI]);
    return `• ${taskName} — ${nguoiThucHien} — ${trangThai}`;
  }).join('\n');

  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": "☀️ Báo cáo sáng cho Admin" },
      "template": "red"
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": `⏳ **Task chờ gán: ${pendingCount}**`
        }
      },
      { "tag": "hr" },
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": `**Task đang xử lý (${activeTasks.length}):**\n${activeLines || 'Không có'}`
        }
      }
    ]
  };
}

module.exports = {
  cardMainMenu,
  cardMediaTasks,
  cardSaleTasks,
  cardPendingTasks,
  cardWorkload,
  cardMorningMedia,
  cardMorningAdmin
};
