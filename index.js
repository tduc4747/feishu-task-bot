require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const BITABLE_TABLE_ID = process.env.BITABLE_TABLE_ID;
const LEADER_USER_ID = process.env.LEADER_USER_ID;

// ─── Lấy access token ───────────────────────────────────────────
async function getTenantToken() {
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  });
  return res.data.tenant_access_token;
}

// ─── Gửi DM cho user ────────────────────────────────────────────
async function sendDM(userId, content) {
  const token = await getTenantToken();
  await axios.post('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    receive_id: userId,
    msg_type: 'text',
    content: JSON.stringify({ text: content })
  }, { headers: { Authorization: `Bearer ${token}` } });
}

// ─── Gửi card cho user ──────────────────────────────────────────
async function sendCard(userId, card) {
  const token = await getTenantToken();
  await axios.post('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    receive_id: userId,
    msg_type: 'interactive',
    content: JSON.stringify(card)
  }, { headers: { Authorization: `Bearer ${token}` } });
}

// ─── Lấy danh sách task từ Bitable ──────────────────────────────
async function getTasks() {
  const token = await getTenantToken();
  const res = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data.items || [];
}

// ─── Cập nhật task trong Bitable ────────────────────────────────
async function updateTask(recordId, fields) {
  const token = await getTenantToken();
  await axios.put(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${recordId}`,
    { fields },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// ─── Tạo task mới trong Bitable ─────────────────────────────────
async function createTask(fields) {
  const token = await getTenantToken();
  const res = await axios.post(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`,
    { fields },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data.record;
}

// ─── Lấy 1 record theo ID ───────────────────────────────────────
async function getTask(recordId) {
  const token = await getTenantToken();
  const res = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${recordId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data.record;
}

// ─── Cards ──────────────────────────────────────────────────────
function cardSaleForm() {
  return {
    schema: "2.0",
    body: {
      type: "page",
      elements: [
        { tag: "markdown", content: "## 📋 Gửi Task Mới" },
        { tag: "input", placeholder: { tag: "plain_text", content: "Tên sản phẩm / SKU" }, name: "sku" },
        { tag: "input", placeholder: { tag: "plain_text", content: "Mô tả ngắn" }, name: "mo_ta_ngan" },
        { tag: "input", placeholder: { tag: "plain_text", content: "Deadline (DD/MM/YYYY)" }, name: "deadline" },
        { tag: "input", placeholder: { tag: "plain_text", content: "Mô tả chi tiết (không bắt buộc)" }, name: "mo_ta_chi_tiet", multiline: true },
        {
          tag: "button",
          text: { tag: "plain_text", content: "📤 Gửi Task" },
          type: "primary",
          behaviors: [{ type: "callback", value: { action: "submit_task" } }]
        }
      ]
    }
  };
}

function cardAssignTask(recordId, taskName, sku) {
  return {
    schema: "2.0",
    body: {
      type: "page",
      elements: [
        { tag: "markdown", content: `## 🔔 Task Mới Cần Gán\n**Task:** ${taskName}\n**SKU:** ${sku}` },
        {
          tag: "select_person",
          placeholder: { tag: "plain_text", content: "Chọn người thực hiện..." },
          name: "assignee"
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "✅ Gán Task" },
          type: "primary",
          behaviors: [{ type: "callback", value: { action: "assign_task", record_id: recordId } }]
        }
      ]
    }
  };
}

function cardMediaTask(recordId, taskName, sku, moTa) {
  return {
    schema: "2.0",
    body: {
      type: "page",
      elements: [
        { tag: "markdown", content: `## 📌 Task Mới Của Bạn\n**Task:** ${taskName}\n**SKU:** ${sku}\n**Mô tả:** ${moTa}` },
        {
          tag: "button",
          text: { tag: "plain_text", content: "▶️ Bắt Đầu Làm" },
          type: "primary",
          behaviors: [{ type: "callback", value: { action: "start_task", record_id: recordId } }]
        }
      ]
    }
  };
}

function cardMediaInProgress(recordId, taskName) {
  return {
    schema: "2.0",
    body: {
      type: "page",
      elements: [
        { tag: "markdown", content: `## 🔄 Đang Làm\n**Task:** ${taskName}` },
        {
          tag: "button",
          text: { tag: "plain_text", content: "👀 Chờ Check" },
          type: "default",
          behaviors: [{ type: "callback", value: { action: "pending_check", record_id: recordId } }]
        }
      ]
    }
  };
}

function cardSaleApprove(recordId, taskName, sku) {
  return {
    schema: "2.0",
    body: {
      type: "page",
      elements: [
        { tag: "markdown", content: `## 👀 Task Chờ Duyệt\n**Task:** ${taskName}\n**SKU:** ${sku}\n\nMedia đã hoàn thành, vui lòng kiểm tra và xác nhận.` },
        {
          tag: "button",
          text: { tag: "plain_text", content: "✅ Hoàn Thành" },
          type: "primary",
          behaviors: [{ type: "callback", value: { action: "complete_task", record_id: recordId } }]
        }
      ]
    }
  };
}

// ─── Webhook: nhận events từ Feishu ─────────────────────────────
app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log('Webhook received:', JSON.stringify(body));

  // Feishu URL verification
  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  // Phải trả 200 ngay để Feishu không retry
  res.sendStatus(200);

  try {
    const event = body.event;
    if (!event) return;

    const msgType = event.message?.message_type;
    const senderId = event.sender?.sender_id?.open_id;
    const text = msgType === 'text'
      ? JSON.parse(event.message.content).text.trim().toLowerCase()
      : '';

    if (msgType === 'text') {
      if (text === 'gửi task' || text === 'tạo task' || text === 'gui task' || text === 'tao task') {
        await sendCard(senderId, cardSaleForm());

      } else if (text === 'task của tôi' || text === 'task cua toi') {
        const tasks = await getTasks();
        const myTasks = tasks.filter(t => t.fields['Trạng thái'] !== 'Hoàn thành');
        if (myTasks.length === 0) {
          await sendDM(senderId, '✅ Bạn không có task nào đang chờ xử lý.');
        } else {
          const list = myTasks.map((t, i) =>
            `${i + 1}. ${t.fields['Task'] || 'N/A'} — ${t.fields['Trạng thái'] || 'N/A'}`
          ).join('\n');
          await sendDM(senderId, `📋 Task của bạn:\n${list}`);
        }

      } else if (text === 'task chờ gán' || text === 'task cho gan') {
        const tasks = await getTasks();
        const pending = tasks.filter(t => t.fields['Trạng thái'] === 'Đang chờ' && !t.fields['Người thực hiện']);
        if (pending.length === 0) {
          await sendDM(senderId, '✅ Không có task nào đang chờ gán.');
        } else {
          for (const t of pending) {
            await sendCard(senderId, cardAssignTask(
              t.record_id,
              t.fields['Task'] || 'N/A',
              t.fields['Tên sản phẩm / SKU'] || 'N/A'
            ));
          }
        }

      } else {
        await sendDM(senderId, `Xin chào! Các lệnh:\n• "gửi task" — tạo task mới\n• "task của tôi" — xem task đang làm\n• "task chờ gán" — xem task chưa có người nhận (leader)`);
      }
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── Callback: nhận button click từ Feishu cards ─────────────────
app.post('/callback', async (req, res) => {
  const body = req.body;
  console.log('Callback received:', JSON.stringify(body));

  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  res.sendStatus(200);

  try {
    const action = body.action?.value?.action;
    const userId = body.operator?.open_id;
    const formValues = body.action?.form_value || {};

    if (action === 'submit_task') {
      const fields = {
        'Tên sản phẩm / SKU': formValues.sku || '',
        'Mô tả ngắn': formValues.mo_ta_ngan || '',
        'Mô tả chi tiết': formValues.mo_ta_chi_tiet || '',
        'Trạng thái': 'Đang chờ',
      };
      const record = await createTask(fields);
      await sendDM(userId, `✅ Task đã gửi! Đang chờ leader gán người thực hiện.`);
      await sendCard(LEADER_USER_ID, cardAssignTask(
        record.record_id,
        formValues.mo_ta_ngan || 'N/A',
        formValues.sku || 'N/A'
      ));

    } else if (action === 'assign_task') {
      const recordId = body.action?.value?.record_id;
      const assigneeId = formValues.assignee?.[0]?.id || formValues.assignee;
      await updateTask(recordId, {
        'Trạng thái': 'Đang chờ'
      });
      const task = await getTask(recordId);
      const fields = task.fields;
      await sendCard(assigneeId, cardMediaTask(
        recordId,
        fields['Task'] || fields['Mô tả ngắn'] || 'N/A',
        fields['Tên sản phẩm / SKU'] || 'N/A',
        fields['Mô tả ngắn'] || ''
      ));
      await sendDM(userId, `✅ Đã gán task thành công.`);

    } else if (action === 'start_task') {
      const recordId = body.action?.value?.record_id;
      await updateTask(recordId, {
        'Trạng thái': 'Đang làm',
        'Đang làm': true
      });
      const task = await getTask(recordId);
      const fields = task.fields;
      const saleId = fields['Người giao']?.[0]?.id;
      if (saleId) await sendDM(saleId, `🔄 Task "${fields['Tên sản phẩm / SKU'] || 'N/A'}" đã được bắt đầu thực hiện.`);
      await sendCard(userId, cardMediaInProgress(recordId, fields['Task'] || fields['Mô tả ngắn'] || 'N/A'));

    } else if (action === 'pending_check') {
      const recordId = body.action?.value?.record_id;
      await updateTask(recordId, {
        'Trạng thái': 'Chờ check',
        'Chờ check': true
      });
      const task = await getTask(recordId);
      const fields = task.fields;
      const saleId = fields['Người giao']?.[0]?.id;
      if (saleId) await sendCard(saleId, cardSaleApprove(
        recordId,
        fields['Task'] || fields['Mô tả ngắn'] || 'N/A',
        fields['Tên sản phẩm / SKU'] || 'N/A'
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
      const mediaId = fields['Người thực hiện']?.[0]?.id;
      const msg = `✅ Task "${fields['Tên sản phẩm / SKU'] || 'N/A'}" đã hoàn thành!`;
      await sendDM(userId, msg);
      if (mediaId) await sendDM(mediaId, msg);
    }

  } catch (err) {
    console.error('Callback error:', err.message);
  }
});

// ─── Health check ────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', message: 'Feishu Task Bot running' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
