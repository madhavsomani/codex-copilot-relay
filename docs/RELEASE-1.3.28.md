# 1.3.28 - Streaming image-history ingress

## Failure and fix

The previous 128 MiB HTTP reader rejected a long task before local image packing
could run. Repeated retries sent the same oversized history. Increasing model
context or fixing OCR cannot resolve that HTTP-layer failure.

The ordinary Responses route now uses `responses-body.mjs` and the existing
stream-json dependency to parse bounded chunks. It separates incoming wire bytes
(512 MiB default maximum) from retained JSON (128 MiB default maximum), keeping
a rolling collection of at most 12 recognized images / 32 MiB image URL text.
The reader works with Content-Length and chunked uploads.

## Preservation rules

- Only recognized embedded PNG/JPEG/WebP/GIF `input_image` nodes in older input
  message content or tool outputs can be replaced. Unknown fields/shapes are
  not disposable history. System/developer images are protected.
- Each replacement is an explicit `input_text` omission marker at the same
  location. Non-image text, call IDs, tool arguments/results and ordering survive.
- The newest image-bearing input item stays protected, even when text follows.
  A current batch that cannot fit fails explicitly with `vision_budget_exceeded`.
- Original task/session files and source image bytes are never edited. Old
  omitted images must be requested again for exact comparisons.
- Explicit OpenAI routing and known upstream continuations never receive a
  pruned body. When routing fields appear after images have already been pruned,
  the request fails closed. Separate public endpoints retain their strict reader.
- No automatic provider fallback, paid generation or credential/config changes.
  Native image/search settings and the existing dashboard design are unchanged.

## Bounded operation

Four concurrent readers, a two-minute total upload deadline, 512 MiB maximum
wire capacity, a 128-level nesting limit and 250,000-node structural limit bound
admission. Failed/aborted/timed-out uploads release reader slots. Errors finish
with a useful HTTP response and connection close, not a parser-triggered reset.
Wire bytes and retained bytes stay distinct in numeric sanitized history metadata,
including older lightweight records. Payload limits are not process RSS limits.

## Local proof

A reconstructed real task history (not an exact captured request), with harmless
instruction padding to cross the old cap, contained 3,503 response items and 225
embedded images. Old-reader admission rejected its 134,798,470 bytes. The new
reader retained 20,998,302 bytes and 12 images, explicitly omitting 213 historical
images. All non-image text/tool metadata and the newest image matched the source.
The normal downstream image packer also produced one bounded image. This test
ran locally and sent no task history to a model or external service.

Focused tests cover HTTP error delivery, declared/chunked input, cancellation,
timeouts, concurrent admission, Unicode/escaping, duplicate keys, field ordering,
protected images, current-batch preservation, upstream routing and log retention.
All 180 Node tests pass. Six Windows configuration/restoration/Remote/backup
fixtures pass; syntax checks pass for 79 root JavaScript modules and 22 PowerShell
scripts. These fixtures do not stop the live relay or certify a phone round trip.
This does not certify perfect OCR, native multi-image parity or unlimited history.

Deploy with Start/Repair and verify `/health` reports 1.3.28. Promotion must stay
deferred while active exchanges exist; a source bump or push is not deployment.
