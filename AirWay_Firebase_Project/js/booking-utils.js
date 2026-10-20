export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

export function makeBookingCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "AW-";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function makeTicketCode(bookingId = "") {
  const seed = String(bookingId).replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AIRWAY-${seed}`;
}

export function dateInputValue(value) {
  if (!value) return "";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizeDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return dateInputValue(d);
}

export function statusLabel(status) {
  return {pending:"Ожидает", confirmed:"Подтверждён", completed:"Завершён", cancelled:"Отменён"}[status] || status || "—";
}

export function plural(n, one, few, many) {
  const x = Math.abs(Number(n)) % 100;
  const y = x % 10;
  return x > 10 && x < 20 ? many : y === 1 ? one : y >= 2 && y <= 4 ? few : many;
}
