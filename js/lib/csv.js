// CSV för Excel: semikolon, UTF-8 med BOM, decimalkomma, CRLF.

const BOM = "﻿";

// Tal får decimalkomma. Text som börjar med = + - @ (eller tab/CR) får ett inledande '
// så att Excel inte tolkar den som formel.
function cell(value) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(value).replace(".", ",") : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[;"\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCSV(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(cell).join(";"));
  return BOM + lines.join("\r\n") + "\r\n";
}

export function downloadFile(filename, content, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
