export const DEFAULT_BLANK_COMPLETION_RETRIES = 2;
export const DEFAULT_PREMATURE_COMPLETION_RETRIES = 2;
export const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export const BLANK_COMPLETION_RECOVERY_PROMPT = [
  "[Bridge recovery] Your previous assistant turn ended without visible text or a tool request.",
  "Continue the original task from its current state.",
  "If work remains, request the next necessary outer tool; otherwise return a non-empty final answer.",
  "Do not mention this recovery message unless it is necessary to explain a real failure.",
].join(" ");

export const PREMATURE_COMPLETION_RECOVERY_PROMPT = [
  "[Bridge recovery] Your previous response only announced future work, but the outer task still requires execution.",
  "Do not return another progress-only message.",
  "Request the next necessary outer tool now, in this turn.",
  "If the work is already complete or genuinely blocked on user input or approval, return a concrete final result or blocker instead.",
].join(" ");

const PROGRESS_ONLY = /\b(?:i(?:['’]m|\s+am)\s+(?:moving|starting|resuming|continuing|opening|cutting|checking|running|building|creating|generating|rendering|working|going)|i(?:['’]ll|\s+will)\s+(?:start|continue|resume|open|cut|check|run|build|create|generate|render|work|do|try)|next\s+i(?:['’]ll|\s+will))\b/i;
const CONCRETE_TERMINAL = /\b(?:completed|finished|done|saved|rendered|exported|created successfully|here (?:is|are)|blocked|need your (?:input|approval)|cannot|can['’]t|could not|failed)\b/i;

export function resolveAssistantContent(data, streamedContent = "") {
  const finalContent = typeof data?.content === "string" ? data.content : "";
  if (finalContent.trim()) return finalContent;

  const accumulated = typeof streamedContent === "string" ? streamedContent : "";
  return accumulated.trim() ? accumulated : "";
}

export class BlankCompletionGuard {
  constructor({
    maxRetries = DEFAULT_BLANK_COMPLETION_RETRIES,
    recoveryPrompt = BLANK_COMPLETION_RECOVERY_PROMPT,
  } = {}) {
    this.maxRetries = Number.isInteger(maxRetries) && maxRetries >= 0
      ? maxRetries
      : DEFAULT_BLANK_COMPLETION_RETRIES;
    this.recoveryPrompt = recoveryPrompt;
    this.retryCount = 0;
    this.awaitingIdle = false;
  }

  observeAssistantMessage(data, streamedContent = "") {
    const toolRequests = Array.isArray(data?.toolRequests) ? data.toolRequests : [];
    const content = resolveAssistantContent(data, streamedContent);

    if (toolRequests.length > 0) {
      this.awaitingIdle = false;
      return { kind: "tool_calls", toolRequests, content };
    }
    if (content.trim()) {
      this.awaitingIdle = false;
      return { kind: "message", content };
    }

    this.awaitingIdle = true;
    return { kind: "await_idle" };
  }

  expectResponse({ resetRetries = false } = {}) {
    if (resetRetries) this.retryCount = 0;
    this.awaitingIdle = true;
  }

  onSessionIdle() {
    if (!this.awaitingIdle) return { kind: "ignore" };
    this.awaitingIdle = false;

    if (this.retryCount >= this.maxRetries) {
      return { kind: "fail", code: "blank_completion" };
    }

    this.retryCount += 1;
    return {
      kind: "retry",
      attempt: this.retryCount,
      prompt: this.recoveryPrompt,
    };
  }

  clearPending() {
    this.awaitingIdle = false;
  }
}

export class PrematureCompletionGuard {
  constructor({
    maxRetries = DEFAULT_PREMATURE_COMPLETION_RETRIES,
    recoveryPrompt = PREMATURE_COMPLETION_RECOVERY_PROMPT,
  } = {}) {
    this.maxRetries = Number.isInteger(maxRetries) && maxRetries >= 0
      ? maxRetries
      : DEFAULT_PREMATURE_COMPLETION_RETRIES;
    this.recoveryPrompt = recoveryPrompt;
    this.retryCount = 0;
  }

  reset() {
    this.retryCount = 0;
  }

  observe({ content = "", requiresAction = false, toolCount = 0 } = {}) {
    const text = String(content ?? "").trim();
    const looksPremature = Boolean(requiresAction)
      && Number(toolCount) > 0
      && PROGRESS_ONLY.test(text)
      && !CONCRETE_TERMINAL.test(text);
    if (!looksPremature) return { kind: "complete" };
    if (this.retryCount >= this.maxRetries) {
      return { kind: "complete", exhausted: true };
    }
    this.retryCount += 1;
    return {
      kind: "retry",
      attempt: this.retryCount,
      prompt: this.recoveryPrompt,
    };
  }
}

export class SlidingDeadline {
  constructor({
    timeoutMs,
    onTimeout,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timer = null;
  }

  touch(timeoutMs = this.timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    if (this.timer) this.clearTimeoutFn(this.timer);
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      this.onTimeout();
    }, timeoutMs);
    this.timer?.unref?.();
  }

  stop() {
    if (!this.timer) return;
    this.clearTimeoutFn(this.timer);
    this.timer = null;
  }
}

export function startSseHeartbeat(response, {
  intervalMs = DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};

  let stopped = false;
  const timer = setIntervalFn(() => {
    if (stopped || response.writableEnded || response.destroyed) return;
    response.write(": keep-alive\n\n");
  }, intervalMs);
  timer?.unref?.();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearIntervalFn(timer);
  };
  response.once?.("close", stop);
  return stop;
}
