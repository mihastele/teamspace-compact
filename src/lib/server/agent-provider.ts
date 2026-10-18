import "server-only";

/** Server-owned capabilities. A provider response cannot add a write tool. */
export const agentToolNames = [
  "search_projects", "search_tickets", "get_project", "get_ticket",
  "summarize_project", "summarize_tickets", "propose_ticket_plan",
] as const;
export type AgentToolName = typeof agentToolNames[number];
export type AgentTool = {
  name: AgentToolName;
  description: string;
  parameters: Record<string, unknown>;
};
export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  arguments: Record<string, unknown>;
};
export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: AgentToolCall[] }
  | { role: "tool"; callId: string; content: string };
export type AgentReply = {
  content: string | null;
  toolCalls: AgentToolCall[];
  usage: { inputTokens: number | null; outputTokens: number | null };
};
export type AgentProviderCode =
  | "agent_disabled" | "agent_configuration" | "agent_request_invalid"
  | "agent_cancelled" | "agent_timeout" | "agent_transport"
  | "agent_provider_auth" | "agent_provider_rate_limit" | "agent_provider_unavailable"
  | "agent_provider_rejected" | "agent_response_invalid" | "agent_response_limit"
  | "agent_response_truncated";

/** Contains no URL, headers, raw error body, prompt, or provider exception cause. */
export class AgentProviderError extends Error {
  constructor(public readonly code: AgentProviderCode, public readonly retryable = false) {
    super(code);
    this.name = "AgentProviderError";
  }
}

export const agentProviderLimits = Object.freeze({
  requestBytes: 512_000,
  responseBytes: 256_000,
  textCharacters: 16_000,
  argumentsBytes: 32_000,
  messages: 100,
  toolCalls: 4,
  timeoutMs: 30_000,
});
type Environment = Readonly<Record<string, string | undefined>>;
type Transport = typeof fetch;
function fail(code: AgentProviderCode, retryable = false): never { throw new AgentProviderError(code, retryable); }
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function boundedText(value: unknown, max: number, empty = false): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0") && (empty || !!value.trim());
}
function flag(env: Environment, name: string): boolean {
  const value = env[name];
  if (value !== undefined && value !== "" && value !== "true" && value !== "false") fail("agent_configuration");
  return value === "true";
}
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function toolId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
function callValid(call: AgentToolCall, names: Set<string>) {
  return record(call) && toolId(call.id) && names.has(call.name) && record(call.arguments)
    && bytes(JSON.stringify(call.arguments)) <= agentProviderLimits.argumentsBytes;
}

/** Rebuild a wire packet from selected fields; never serialize arbitrary input objects. */
function requestPacket(model: string, maxTokens: number, messages: readonly AgentMessage[], tools: readonly AgentTool[]) {
  if (!Array.isArray(tools) || tools.length < 1 || tools.length > agentToolNames.length) fail("agent_request_invalid");
  const names = new Set<string>();
  const functions = tools.map(tool => {
    if (!record(tool) || typeof tool.name !== "string" || !(agentToolNames as readonly string[]).includes(tool.name) || names.has(tool.name)
      || !boundedText(tool.description, 2000) || !record(tool.parameters)
      || tool.parameters.type !== "object" || tool.parameters.additionalProperties !== false) fail("agent_request_invalid");
    names.add(tool.name);
    // Compatible endpoints vary in strict-schema support. The tool service must
    // validate arguments regardless of what a model/provider says it enforced.
    return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: false } };
  });
  if (!Array.isArray(messages) || !messages.length || messages.length > agentProviderLimits.messages) fail("agent_request_invalid");
  const pending = new Set<string>(), seen = new Set<string>();
  const wireMessages = messages.map((message, index) => {
    if (!record(message)) fail("agent_request_invalid");
    if (message.role === "system" || message.role === "user") {
      if (pending.size || !boundedText(message.content, agentProviderLimits.textCharacters) || (message.role === "system" && index !== 0)) fail("agent_request_invalid");
      return { role: message.role, content: message.content };
    }
    if (message.role === "assistant") {
      if (pending.size || !Array.isArray(message.toolCalls) || message.toolCalls.length > agentProviderLimits.toolCalls
        || !(message.content === null || boundedText(message.content, agentProviderLimits.textCharacters, true))
        || (!message.toolCalls.length && (typeof message.content !== "string" || !message.content.trim()))) fail("agent_request_invalid");
      const calls = message.toolCalls.map(call => {
        if (!callValid(call, names) || seen.has(call.id)) fail("agent_request_invalid");
        seen.add(call.id); pending.add(call.id);
        return { id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
      });
      return { role: "assistant", content: message.content, ...(calls.length ? { tool_calls: calls } : {}) };
    }
    if (message.role === "tool") {
      if (!toolId(message.callId) || !pending.delete(message.callId) || !boundedText(message.content, 64_000, true)) fail("agent_request_invalid");
      return { role: "tool", tool_call_id: message.callId, content: message.content };
    }
    return fail("agent_request_invalid");
  });
  if (pending.size || !wireMessages.some(message => message.role === "user") || wireMessages.at(-1)?.role === "assistant") fail("agent_request_invalid");
  const body = JSON.stringify({ model, messages: wireMessages, tools: functions, tool_choice: "auto", parallel_tool_calls: false,
    max_completion_tokens: maxTokens, stream: false, store: false, n: 1 });
  if (bytes(body) > agentProviderLimits.requestBytes) fail("agent_request_invalid");
  return { body, names, seen };
}

async function responseJson(response: Response): Promise<unknown> {
  const size = response.headers.get("content-length");
  if (size && (!/^\d+$/.test(size) || Number(size) > agentProviderLimits.responseBytes)) {
    void response.body?.cancel().catch(() => {});
    fail("agent_response_limit");
  }
  if (!response.body) fail("agent_response_invalid");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > agentProviderLimits.responseBytes) fail("agent_response_limit");
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return fail("agent_response_invalid"); }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseReply(value: unknown, names: Set<string>, seen: Set<string>): AgentReply {
  if (!record(value) || !Array.isArray(value.choices) || value.choices.length !== 1 || !record(value.choices[0])) fail("agent_response_invalid");
  const choice = value.choices[0];
  if (choice.finish_reason === "length") fail("agent_response_truncated");
  if (!["stop", "tool_calls"].includes(String(choice.finish_reason)) || !record(choice.message) || choice.message.role !== "assistant") fail("agent_response_invalid");
  const message = choice.message;
  if (!(message.content === null || boundedText(message.content, agentProviderLimits.textCharacters, true))) fail("agent_response_invalid");
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls) || calls.length > agentProviderLimits.toolCalls) fail("agent_response_invalid");
  if ((choice.finish_reason === "tool_calls") !== (calls.length > 0) || (!calls.length && !(message.content as string | null)?.trim())) fail("agent_response_invalid");
  const toolCalls = calls.map((call): AgentToolCall => {
    if (!record(call) || call.type !== "function" || !toolId(call.id) || seen.has(call.id) || !record(call.function)
      || !names.has(String(call.function.name)) || !boundedText(call.function.arguments, agentProviderLimits.argumentsBytes)
      || bytes(call.function.arguments) > agentProviderLimits.argumentsBytes) fail("agent_response_invalid");
    let args: unknown;
    try { args = JSON.parse(call.function.arguments as string); } catch { fail("agent_response_invalid"); }
    if (!record(args)) fail("agent_response_invalid");
    seen.add(call.id);
    return { id: call.id, name: call.function.name as AgentToolName, arguments: args };
  });
  const usage = record(value.usage) ? value.usage : {};
  // Select visible text, validated calls and numeric usage only. In particular,
  // provider-specific reasoning, signatures, metadata and raw bodies stay out.
  return { content: message.content as string | null, toolCalls,
    usage: { inputTokens: tokenCount(usage.prompt_tokens), outputTokens: tokenCount(usage.completion_tokens) } };
}

/**
 * Construction never contacts a provider. The caller owns authorization, audit
 * persistence, leases and retries; this adapter makes exactly one bounded call.
 * No route or worker invokes it until the durable M4 infrastructure is wired.
 */
export function createAgentProvider(env: Environment = process.env, transport: Transport = fetch) {
  const enabled = flag(env, "AGENT_ENABLED");
  if (!enabled) return {
    description: Object.freeze({ enabled: false as const, model: null }),
    complete: async (): Promise<AgentReply> => fail("agent_disabled"),
  };
  if (env.BACKEND_PROVIDER !== "supabase" || !boundedText(env.AGENT_MODEL, 200)) fail("agent_configuration");
  const model = env.AGENT_MODEL.trim();
  const allowHttp = flag(env, "AGENT_ALLOW_HTTP");
  let url: URL;
  try { url = new URL(env.AGENT_BASE_URL ?? ""); } catch { return fail("agent_configuration"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || (url.protocol === "http:" && !allowHttp)) fail("agent_configuration");
  const key = env.AGENT_API_KEY ?? "";
  if (!boundedText(key, 8192, true) || /[\r\n]/.test(key)) fail("agent_configuration");
  const tokens = env.AGENT_MAX_COMPLETION_TOKENS ?? "2048";
  if (!/^\d+$/.test(tokens) || Number(tokens) < 128 || Number(tokens) > 8192) fail("agent_configuration");
  url.pathname = url.pathname.replace(/\/+$/, "") + "/chat/completions";
  const endpoint = url.toString();
  return {
    description: Object.freeze({ enabled: true as const, model }),
    async complete(messages: readonly AgentMessage[], tools: readonly AgentTool[], options: { signal?: AbortSignal } = {}): Promise<AgentReply> {
      let packet: ReturnType<typeof requestPacket>;
      try { packet = requestPacket(model, Number(tokens), messages, tools); }
      catch (error) { if (error instanceof AgentProviderError) throw error; return fail("agent_request_invalid"); }
      const timeout = AbortSignal.timeout(agentProviderLimits.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      try {
        signal.throwIfAborted();
        const response = await transport(endpoint, { method: "POST", redirect: "error", cache: "no-store", signal,
          headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: packet.body });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 401 || response.status === 403) fail("agent_provider_auth");
          if (response.status === 429) fail("agent_provider_rate_limit", true);
          if (response.status >= 500) fail("agent_provider_unavailable", true);
          fail("agent_provider_rejected");
        }
        const value = await responseJson(response);
        signal.throwIfAborted();
        return parseReply(value, packet.names, packet.seen);
      } catch (error) {
        if (options.signal?.aborted) return fail("agent_cancelled");
        if (timeout.aborted) return fail("agent_timeout", true);
        if (error instanceof AgentProviderError) throw error;
        return fail("agent_transport", true);
      }
    },
  };
}
