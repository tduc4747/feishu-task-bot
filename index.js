{
  "name": "feishu-task-bot",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "node-cron": "^3.0.3"
  }
}    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.items || [];
}

async function getTask(recordId) {
  const token = await getTenantToken();
  const res = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${recordId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.record;
}

async function updateTask(recordId, fields) {
  const token = await getTenantToken();
  await axios.put(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${recordId}`,
    { fields },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

async function createTask(fields) {
  const token = await getTenantToken();
  const res = await axios.post(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`,
    { fields },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.record;
}

// ─── Cards ──────────────────────────────────────────────────────
function cardSaleForm() {
  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": "📋 Gửi Task Mới" },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "div",
        "fields": [
          { "is_short": false, "text": { "tag": "lark_md", "content": "**Tên sản phẩm / SKU**" } }
        ]
      },
      {
        "tag": "input",
        "placeholder": { "tag": "plain_text", "content": "Nhập SKU..." },
        "action": { "type": "input_callback", "value": { "field": "sku" } }
      },
      {
        "tag": "div",
        "fields": [
          { "is_short": false, "text": { "tag": "lark_md", "content": "**Mô tả ngắn**" } }
        ]
      },
      {
        "tag": "input",
        "placeholder": { "tag": "plain_text", "content": "Mô tả công việc..." },
        "action": { "type": "input_callback", "value": { "field": "mo_ta_ngan" } }
      },
      {
        "tag": "div",
        "fields": [
          { "is_short": false, "text": { "tag": "lark_md", "content": "**Deadline (DD/MM/YYYY)**" } }
        ]
      },
      {
        "tag": "input",
        "placeholder": { "tag": "plain_text", "content": "VD: 30/06/2026" },
        "action": { "type": "input_callback", "value": { "field": "deadline" } }
      },
      {
        "tag": "div",
        "fields": [
          { "is_short": false, "text": { "tag": "lark_md", "content": "**Mô tả chi tiết** *(không bắt buộc)*" } }
        ]
      },
      {
        "tag": "input",
        "placeholder": { "tag": "plain_text", "content": "Thêm chi tiết nếu cần..." },
        "action": { "type": "input_callback", "value": { "field": "mo_ta_chi_tiet" } }
      },
      { "tag": "hr" },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "📤 Gửi Task" },
            "type": "primary",
            "value": { "action": "submit_task" }
          }
        ]
      }
    ]
  };
}

function cardMyTasks(tasks) {
  if (tasks.length === 0) {
    return {
      "config": { "wide_screen_mode": true },
      "header": {
        "title": { "tag": "plain_text", "content": "📋 Task Của Bạn" },
        "template": "blue"
      },
      "elements": [
        { "tag": "div", "text": { "tag": "lark_md", "content": "✅ Bạn không có task nào đang xử lý." } }
      ]
    };
  }

  const statusEmoji = (s) => {
    if (!s || s === 'Đang chờ') return '⏳';
    if (s === 'Đang làm') return '🔄';
    if (s === 'Chờ check') return '👀';
    if (s === 'Hoàn thành') return '✅';
    return '📌';
  };

  const elements = [];

  tasks.forEach((t, i) => {
    const taskName = getFieldText(t.fields['Task']);
    const nguoiGiao = getFieldText(t.fields['Người giao']);
    const deadline = formatDate(t.fields['Deadline']);
    const trangThai = getFieldText(t.fields['Trạng thái']);
    const recordId = t.record_id;

    elements.push({
      "tag": "div",
      "text": {
        "tag": "lark_md",
        "content": `**${i + 1}. ${taskName}**\n👤 Người giao: ${nguoiGiao}\n📅 Deadline: ${deadline}\n${statusEmoji(trangThai)} Trạng thái: **${trangThai}**`
      }
    });

    // Nút đổi trạng thái tùy theo trạng thái hiện tại
    const buttons = [];

    if (!trangThai || trangThai === 'Đang chờ') {
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "▶️ Bắt đầu làm" },
        "type": "primary",
        "value": { "action": "start_task", "record_id": recordId }
      });
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "👀 Chờ check" },
        "type": "default",
        "value": { "action": "pending_check", "record_id": recordId }
      });
    } else if (trangThai === 'Đang làm') {
      buttons.push({
        "tag": "button",
        "text": { "tag": "plain_text", "content": "👀 Chờ check" },
        "type": "default",
        "value": { "action": "pending_check", "record_id": recordId }
      });
    }

    if (buttons.length > 0) {
      elements.push({ "tag": "action", "actions": buttons });
    }

    // Thêm divider giữa các task (trừ task cuối)
    if (i < tasks.length - 1) {
      elements.push({ "tag": "hr" });
    }
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

function cardAssignTask(recordId, taskName, sku) {
  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": "🔔 Task Mới Cần Gán" },
      "template": "orange"
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": `**Task:** ${taskName}\n**SKU:** ${sku}`
        }
      },
      { "tag": "hr" },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "select_person",
            "placeholder": { "tag": "plain_text", "content": "Chọn người thực hiện..." },
            "value": { "action": "assign_task", "record_id": recordId }
          }
        ]
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "✅ Xác nhận gán" },
            "type": "primary",
            "value": { "action": "confirm_assign", "record_id": recordId }
          }
        ]
      }
    ]
  };
}

function cardSaleApprove(recordId, taskName, sku) {
  return {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": "👀 Task Chờ Duyệt" },
      "template": "yellow"
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": `**Task:** ${taskName}\n**SKU:** ${sku}\n\nMedia đã hoàn thành, vui lòng kiểm tra và xác nhận.`
        }
      },
      { "tag": "hr" },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "✅ Hoàn Thành" },
            "type": "primary",
            "value": { "action": "complete_task", "record_id": recordId }
          }
        ]
      }
    ]
  };
}

// ─── Webhook ─────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  res.sendStatus(200);

  try {
    const event = body.event;
    if (!event) return;

    const msgType = event.message?.message_type;
    const senderId = event.sender?.sender_id?.open_id;
    if (!senderId) return;

    const text = msgType === 'text'
      ? JSON.parse(event.message.content).text.trim().toLowerCase()
      : '';

    if (msgType !== 'text') return;

    if (text === 'gửi task' || text === 'gui task' || text === 'tạo task' || text === 'tao task') {
      await sendCard(senderId, cardSaleForm());

    } else if (text === 'task của tôi' || text === 'task cua toi') {
      const allTasks = await getTasks();
      // Lọc task theo người thực hiện (open_id)
      const myTasks = allTasks.filter(t => {
        const nguoiThucHien = t.fields['Người thực hiện'];
        if (!nguoiThucHien) return false;
        if (Array.isArray(nguoiThucHien)) {
          return nguoiThucHien.some(u => u.id === senderId || u.open_id === senderId);
        }
        return false;
      }).filter(t => {
        const status = getFieldText(t.fields['Trạng thái']);
        return status !== 'Hoàn thành';
      });

      await sendCard(senderId, cardMyTasks(myTasks));

    } else if (text === 'task chờ gán' || text === 'task cho gan') {
      const allTasks = await getTasks();
      const pending = allTasks.filter(t => {
        const status = getFieldText(t.fields['Trạng thái']);
        return status === 'Đang chờ' && !t.fields['Người thực hiện'];
      });
      if (pending.length === 0) {
        await sendDM(senderId, '✅ Không có task nào đang chờ gán.');
      } else {
        for (const t of pending) {
          await sendCard(senderId, cardAssignTask(
            t.record_id,
            getFieldText(t.fields['Task']),
            getFieldText(t.fields['Tên sản phẩm / SKU'])
          ));
        }
      }

    } else {
      await sendDM(senderId, `Xin chào! Các lệnh:\n• "gửi task" — tạo task mới\n• "task của tôi" — xem task đang làm\n• "task chờ gán" — xem task chưa có người nhận (leader)`);
    }

  } catch (err) {
    console.error('Webhook error:', err.message, err.stack);
  }
});

// ─── Callback ────────────────────────────────────────────────────
app.post('/callback', async (req, res) => {
  console.log('RAW headers:', JSON.stringify(req.headers));
  console.log('RAW body:', JSON.stringify(req.body));
  const body = req.body;
  console.log('Callback received:', JSON.stringify(body));
  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  res.sendStatus(200);

  try {
    const action = body.action?.value?.action;
    const userId = body.operator?.open_id;

    if (action === 'submit_task') {
      const formVals = body.action?.form_value || {};
      const fields = {
        'Tên sản phẩm / SKU': formVals.sku || '',
        'Mô tả ngắn': formVals.mo_ta_ngan || '',
        'Mô tả chi tiết': formVals.mo_ta_chi_tiet || '',
        'Trạng thái': 'Đang chờ',
      };
      const record = await createTask(fields);
      await sendDM(userId, `✅ Task "${formVals.sku}" đã gửi! Đang chờ leader gán người thực hiện.`);
      await sendCard(LEADER_USER_ID, cardAssignTask(
        record.record_id,
        formVals.mo_ta_ngan || 'N/A',
        formVals.sku || 'N/A'
      ));

    } else if (action === 'confirm_assign') {
      const recordId = body.action?.value?.record_id;
      const formVals = body.action?.form_value || {};
      const assigneeId = Array.isArray(formVals.assignee)
        ? formVals.assignee[0]?.id || formVals.assignee[0]
        : formVals.assignee;
      if (!assigneeId) {
        await sendDM(userId, '⚠️ Vui lòng chọn người thực hiện trước!');
        return;
      }
      await updateTask(recordId, { 'Trạng thái': 'Đang chờ' });
      const task = await getTask(recordId);
      const fields = task.fields;
      await sendDM(assigneeId, `📌 Bạn có task mới!\n**SKU:** ${getFieldText(fields['Tên sản phẩm / SKU'])}\n**Mô tả:** ${getFieldText(fields['Mô tả ngắn'])}\nNhắn "task của tôi" để xem chi tiết.`);
      await sendDM(userId, `✅ Đã gán task thành công.`);

    } else if (action === 'start_task') {
      const recordId = body.action?.value?.record_id;
      await updateTask(recordId, {
        'Trạng thái': 'Đang làm',
        'Đang làm': true
      });
      const task = await getTask(recordId);
      const fields = task.fields;
      const saleId = Array.isArray(fields['Người giao'])
        ? fields['Người giao'][0]?.id
        : null;
      if (saleId) await sendDM(saleId, `🔄 Task "${getFieldText(fields['Tên sản phẩm / SKU'])}" đã được bắt đầu thực hiện.`);
      await sendDM(userId, `▶️ Đã chuyển sang "Đang làm"!`);

    } else if (action === 'pending_check') {
      const recordId = body.action?.value?.record_id;
      await updateTask(recordId, {
        'Trạng thái': 'Chờ check',
        'Chờ check': true
      });
      const task = await getTask(recordId);
      const fields = task.fields;
      const saleId = Array.isArray(fields['Người giao'])
        ? fields['Người giao'][0]?.id
        : null;
      if (saleId) await sendCard(saleId, cardSaleApprove(
        recordId,
        getFieldText(fields['Task']),
        getFieldText(fields['Tên sản phẩm / SKU'])
      ));
      await sendDM(userId, `👀 Đã chuyển sang "Chờ check". Đang chờ sale duyệt.`);

    } else if (action === 'complete_task') {
      const recordId = body.action?.value?.record_id;
      await updateTask(recordId, {
        'Trạng thái': 'Hoàn thành',
        'Done': true
      });
      const task = await getTask(recordId);
      const fields = task.fields;
      const mediaId = Array.isArray(fields['Người thực hiện'])
        ? fields['Người thực hiện'][0]?.id
        : null;
      const msg = `✅ Task "${getFieldText(fields['Tên sản phẩm / SKU'])}" đã hoàn thành!`;
      await sendDM(userId, msg);
      if (mediaId) await sendDM(mediaId, msg);
    }

  } catch (err) {
    console.error('Callback error:', err.message, err.stack);
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', message: 'Feishu Task Bot running' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
