// json.js — parse JSON tu file text, chiu duoc BOM cua Notepad Windows.
// (PowerShell Set-Content / Notepad thuong ghi UTF-8 BOM; JSON.parse goc nem
// SyntaxError khi gap BOM -> cac cho doc providers.json/models.json/settings.json
// lang le fallback sai. Strip BOM truoc khi parse.)
export function parseJsonText(text) {
  let clean = String(text);
  if (clean.charCodeAt(0) === 0xfeff) clean = clean.slice(1);
  return JSON.parse(clean);
}
