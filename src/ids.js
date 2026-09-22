// ids.js — mint ses_/msg_ ID dung format time-ordered cua opencode client.
// (dao nguoc tu DB + traffic that; server Zen chi chap nhan ID "tuoi" + dung marker)
import crypto from "node:crypto";
import { T_SES, M_MSG } from "./config.js";

const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function randTail(n) {
  return Array.from(crypto.randomBytes(n), (b) => ABC[b % 62]).join("");
}
export function isValidIdFormat(id, prefix) {
  return typeof id === "string" && new RegExp(`^${prefix}[0-9a-f]{12}[0-9A-Za-z]{14}$`).test(id);
}
export function mintSes(nowMs = Date.now()) {
  return "ses_" + ((T_SES - nowMs) * 4096 + 0xffe).toString(16).padStart(12, "0") + randTail(14);
}
export function mintMsg(nowMs = Date.now()) {
  return "msg_" + ((nowMs - M_MSG) * 4096 + 0x001).toString(16).padStart(12, "0") + randTail(14);
}
