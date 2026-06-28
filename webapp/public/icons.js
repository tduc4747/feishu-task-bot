// ─── Bộ icon 2D tối giản dạng line (stroke), dùng chung toàn app ───
// Gọi icon('edit') -> trả về chuỗi SVG. Không phụ thuộc thư viện ngoài.
const ICONS = {
  edit:      '<path d="M14.5 3.5l2 2L7 15l-3 1 1-3z"/>',
  trash:     '<path d="M3 5h14M7 5V3.5h6V5M5 5l1 12h8l1-12"/>',
  plus:      '<path d="M10 4v12M4 10h12"/>',
  close:     '<path d="M5 5l10 10M15 5L5 15"/>',
  check:     '<path d="M4 10l4 4 8-9"/>',
  clock:     '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
  send:      '<path d="M3 10l14-7-5 14-2.5-5.5L3 10z"/>',
  user:      '<circle cx="10" cy="6.5" r="3.5"/><path d="M3.5 17a6.5 6.5 0 0113 0"/>',
  users:     '<circle cx="7.5" cy="7" r="3"/><path d="M2 17a5.5 5.5 0 0111 0"/><circle cx="14.5" cy="8" r="2.3"/><path d="M12.6 12.2A4.6 4.6 0 0118 17"/>',
  settings:  '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.4M10 15.1v2.4M3.6 5.8l2.1 1.2M14.3 13l2.1 1.2M3.6 14.2l2.1-1.2M14.3 7l2.1-1.2"/>',
  template:  '<rect x="3" y="4" width="14" height="11" rx="1.5"/><path d="M6 8h8M6 11h5"/>',
  upload:    '<path d="M10 13V4M6.5 7.5L10 4l3.5 3.5"/><path d="M4 14.5v1A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5v-1"/>',
  paperclip: '<path d="M13.5 7.5l-6 6a2.5 2.5 0 003.5 3.5l6-6a4 4 0 00-5.5-5.5l-6 6a3 3 0 004 4"/>',
  chevron:   '<path d="M5 7.5l5 5 5-5"/>',
  menu:      '<path d="M3 6h14M3 10h14M3 14h14"/>',
  file:      '<path d="M6 2.5h6l3 3v12H6V2.5z"/><path d="M12 2.5V6h3"/>',
  calendar:  '<rect x="3" y="4.5" width="14" height="12" rx="1.5"/><path d="M3 8h14M7 2.5v3M13 2.5v3"/>',
  search:    '<circle cx="8.5" cy="8.5" r="5"/><path d="M16 16l-3.5-3.5"/>',
  logout:    '<path d="M7.5 17H4.5A1.5 1.5 0 013 15.5v-11A1.5 1.5 0 014.5 3h3M13 13.5l4-3.5-4-3.5M17 10H7"/>',
  arrowRight:'<path d="M4 10h12M11 5l5 5-5 5"/>',
  filter:    '<path d="M3 5h14M6 10h8M8.5 15h3"/>',
};

function icon(name, size = 18) {
  const body = ICONS[name] || '';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
