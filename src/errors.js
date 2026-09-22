// errors.js — error contract THONG NHAT cho moi response loi.
// Moi loi tra ve dang Anthropic: { type:"error", error:{ type, message } }
// + ma noi bo `code` de log/debug (khong lo thong tin nhay cam).
export const Codes = {
  BAD_REQUEST: "bad_request",             // 400: body gui len sai schema
  UPSTREAM_UNREACHABLE: "upstream_unreachable", // 502: khong noi duoc backend
  FREETIER_DENIED: "freetier_denied",     // 400: Zen tu choi free tier (gate)
  UPSTREAM_ERROR: "upstream_error",       // 502/4xx/5xx: backend bao loi
  MISCONFIGURED: "misconfigured",         // 500: thieu cau hinh (vd chua chon model ollama)
  NOT_FOUND: "not_found",                 // 404: sai endpoint
  INTERNAL: "internal",                   // 500: loi code
};

export class ApiError extends Error {
  constructor(status, code, type, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.type = type;
  }
  toJSON() {
    return { type: "error", error: { type: this.type, message: this.message } };
  }
  static badRequest(msg) { return new ApiError(400, Codes.BAD_REQUEST, "invalid_request_error", msg); }
  static unreachable(msg) { return new ApiError(502, Codes.UPSTREAM_UNREACHABLE, "api_error", msg); }
  static freetier(msg) { return new ApiError(400, Codes.FREETIER_DENIED, "api_error", msg); }
  static upstream(status, msg) { return new ApiError(status, Codes.UPSTREAM_ERROR, "api_error", msg); }
  static misconfigured(msg) { return new ApiError(500, Codes.MISCONFIGURED, "api_error", msg); }
  static notFound(msg) { return new ApiError(404, Codes.NOT_FOUND, "not_found", msg); }
  static internal(msg) { return new ApiError(500, Codes.INTERNAL, "api_error", msg); }
}

// Validate toi thieu body POST /v1/messages (tra 400 som thay vi crash -> 500).
export function validateMessagesBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw ApiError.badRequest("body phai la JSON object");
  }
  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    throw ApiError.badRequest("messages phai la array");
  }
  for (const m of body.messages || []) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) {
      throw ApiError.badRequest("moi message can role user|assistant");
    }
  }
  if (body.tools !== undefined && !Array.isArray(body.tools)) {
    throw ApiError.badRequest("tools phai la array");
  }
  if (body.max_tokens !== undefined && !(Number.isFinite(body.max_tokens) && body.max_tokens > 0)) {
    throw ApiError.badRequest("max_tokens phai la so duong");
  }
}
