import { get_encoding as getEncoding } from "tiktoken";

let tokenizer = null;
const MAX_TOKENIZER_CHUNK_CHARS = 1024;

function sharedTokenizer() {
  if (!tokenizer) tokenizer = getEncoding("o200k_base");
  return tokenizer;
}

/**
 * Count serialized prompt tokens with the modern OpenAI o200k vocabulary.
 * GitHub Copilot does not expose its server-side tokenizer, so this is a
 * conservative local budgeting signal rather than a billing measurement.
 */
export function countModelTokens(value) {
  const text = String(value ?? "");
  const encoder = sharedTokenizer();
  if (text.length <= MAX_TOKENIZER_CHUNK_CHARS) return encoder.encode(text).length;

  // Encoding independent chunks can only lose cross-boundary BPE merges, so
  // the sum is conservatively equal to or slightly above a monolithic count.
  // This keeps pathological multi-megabyte inputs bounded in time and memory.
  let count = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + MAX_TOKENIZER_CHUNK_CHARS);
    if (end < text.length
      && /[\uD800-\uDBFF]/.test(text[end - 1])
      && /[\uDC00-\uDFFF]/.test(text[end])) {
      end -= 1;
    }
    count += encoder.encode(text.slice(start, end)).length;
    start = end;
  }
  return count;
}

export const tokenizerCompatibility = Object.freeze({
  encoding: "o200k_base",
  maxChunkChars: MAX_TOKENIZER_CHUNK_CHARS,
  conservativeChunking: true,
  purpose: "local_context_budgeting",
  exactProviderBilling: false,
});
