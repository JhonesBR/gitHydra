// Dates are always shown day-first (dd/mm/yyyy), whatever locale the webview
// reports — its default (often en-US) would print month-first.
const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type DateInput = Date | number;
/** Numbers are unix seconds (what the backend sends). */
const toDate = (d: DateInput) => (typeof d === "number" ? new Date(d * 1000) : d);

/** "20/02/2023" */
export const formatDate = (d: DateInput) => dateFormat.format(toDate(d));

/** "20/02/2023 14:05" */
export const formatDateTime = (d: DateInput) => dateTimeFormat.format(toDate(d)).replace(",", "");
