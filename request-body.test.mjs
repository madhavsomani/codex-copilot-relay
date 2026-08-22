import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  RequestBodyTooLargeError,
  readJsonBody,
} from "./request-body.mjs";

function requestFrom(chunks, headers = {}) {
  const request = Readable.from(chunks);
  request.headers = headers;
  return request;
}

test("readJsonBody accepts JSON up to the configured envelope limit", async () => {
  const payload = Buffer.from(JSON.stringify({ input: "x".repeat(900) }));
  const request = requestFrom([payload], { "content-length": String(payload.length) });

  const parsed = await readJsonBody(request, { maxBytes: 1_024 });

  assert.equal(parsed.bytes, payload.length);
  assert.equal(parsed.body.input.length, 900);
});

test("readJsonBody rejects an oversized declared Content-Length with HTTP 413 metadata", async () => {
  const request = requestFrom([Buffer.from("{}")], { "content-length": "2048" });

  await assert.rejects(
    readJsonBody(request, { maxBytes: 1_024 }),
    (error) => {
      assert.ok(error instanceof RequestBodyTooLargeError);
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "request_too_large");
      assert.equal(error.receivedBytes, 2_048);
      assert.equal(error.limitBytes, 1_024);
      assert.match(error.message, /received 2,048 bytes; limit is 1,024 bytes/);
      return true;
    },
  );
});

test("readJsonBody enforces the same limit for chunked requests", async () => {
  const request = requestFrom([
    Buffer.alloc(700, 0x20),
    Buffer.alloc(500, 0x20),
  ]);

  await assert.rejects(
    readJsonBody(request, { maxBytes: 1_024 }),
    (error) => {
      assert.ok(error instanceof RequestBodyTooLargeError);
      assert.equal(error.receivedBytes, 1_200);
      assert.equal(error.limitBytes, 1_024);
      return true;
    },
  );
});

test("readJsonBody reports malformed JSON separately from envelope overflow", async () => {
  const request = requestFrom([Buffer.from("not json")]);

  await assert.rejects(
    readJsonBody(request, { maxBytes: 1_024 }),
    (error) => {
      assert.equal(error.code, "invalid_json");
      assert.equal(error.statusCode, 400);
      assert.equal(error.message, "Request body is not valid JSON.");
      return true;
    },
  );
});
