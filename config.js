module.exports = {
  // ─── Tên cột trong bảng Task ────────────────────
  COLS: {
    TASK_NAME:        'Task',
    SKU:              'Tên sản phẩm / SKU',
    MO_TA_NGAN:       'Mô tả ngắn',
    MO_TA_CHI_TIET:   'Mô tả chi tiết',
    TRANG_THAI:       'Trạng thái',
    NGUOI_GIAO:       'Người giao',
    NGUOI_THUC_HIEN:  'Người thực hiện',
    DEADLINE:         'Deadline',
  },

  // ─── Giá trị trạng thái ─────────────────────────
  STATUS: {
    CHO_GAN:      'Chờ gán người thực hiện',
    DANG_CHO:     'Đang chờ',
    DANG_LAM:     'Đang làm',
    CHO_CHECK:    'Chờ check',
    HOAN_THANH:   'Hoàn thành',
  },

  // ─── Tên cột trong bảng DS TEAM ─────────────────
  TEAM_COLS: {
    SALE:     'SALE',
    EDITOR:   'EDITOR',
    DESIGNER: 'DESIGNER',
    ADMIN:    'ADMIN',
  },

  // ─── Thông báo hàng ngày ─────────────────────────
  SCHEDULE: {
    HOUR:     8,
    MINUTE:   0,
    TIMEZONE: 'Asia/Ho_Chi_Minh',
  },

  // ─── Link form sale gửi task ─────────────────────
  FORM_URL: 'https://qcnkn5uzzdra.feishu.cn/share/base/form/shrcn7XkGppWliOBcM9TaNDXFqd',

  // ─── Bitable table IDs ───────────────────────────
  TABLE: {
    TASK:    process.env.BITABLE_TABLE_ID,
    DS_TEAM: process.env.BITABLE_TEAM_TABLE_ID,
  },
};
