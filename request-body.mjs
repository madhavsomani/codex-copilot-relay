export class RequestBodyError extends Error {
  constructor(message, { code, statusCode }) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class RequestBodyTooLargeError extends RequestBodyError {
  constructor(receivedBytes, limitBytes) {
    super(
      `Request body is too large: received ${receivedBytes.toLocaleString("en-US")} bytes; limit is ${limitBytes.toLocaleString("en-US")} bytes.`,
      { code: "request_too_large", statusCode: 413 },
    );
    this.receivedBytes = receivedBytes;
    this.limitBytes = limitBytes;
  }
}

function declaredContentLength(request) {
  const raw = request?.headers?.["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function readJsonBody(request, { maxBytes }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer.");
  }

  const declaredBytes = declaredContentLength(request);
  if (declaredBytes !== null && declaredBytes > maxBytes) {
    throw new RequestBodyTooLargeError(declaredBytes, maxBytes);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new RequestBodyTooLargeError(total, maxBytes);
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks, total).toString("utf8");
  try {
    return { body: JSON.parse(text), bytes: total };
  } catch {
    throw new RequestBodyError("Request body is not valid JSON.", {
      code: "invalid_json",
      statusCode: 400,
    });
  }
}
