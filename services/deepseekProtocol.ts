// src/services/mammoth/deepseekProtocol.ts (v2 — matches actual DeepSeek-V4 encoding)
// Based on encoding_README.txt reference implementation.
//
// Format:
//   <｜begin▁of▁sentence｜>{system}
//   <｜User｜>{user_msg}<｜Assistant｜><think>{reasoning}</think>{response}<｜end▁of▁sentence｜>
//
// Tool calls:
//   <｜DSML｜tool_calls>
//   <｜DSML｜invoke name="$NAME">
//   <｜DSML｜parameter name="$P" string="true|false">$VALUE</｜DSML｜parameter>
//   </｜DSML｜invoke>
//   </｜DSML｜tool_calls><｜end▁of▁sentence｜>
//
// Tool results (in next user message):
//   <｜User｜><tool_result>{result_json}</tool_result><｜Assistant｜>

// ── Special Tokens ──

const DSML = {
  BOS: '<｜begin▁of▁sentence｜>',
  EOS: '<｜end▁of▁sentence｜>',
  USER: '<｜User｜>',
  ASSISTANT: '<｜Assistant｜>',
  THINK_OPEN: '<think>',
  THINK_CLOSE: '</think>',
  TOOL_CALLS_OPEN: '<｜DSML｜tool_calls>',
  TOOL_CALLS_CLOSE: '</｜DSML｜tool_calls>',
  INVOKE_OPEN: '<｜DSML｜invoke',
  INVOKE_CLOSE: '</｜DSML｜invoke>',
  PARAMETER_OPEN: '<｜DSML｜parameter',
  PARAMETER_CLOSE: '</｜DSML｜parameter>',
  TOOL_RESULT_OPEN: '<tool_result>',
  TOOL_RESULT_CLOSE: '</tool_result>',
} as const;

// Reasoning effort prefix (goes at the very beginning)
const EFFORT_MAX_PREFIX = `Reasoning Effort: Absolute maximum with no shortcuts permitted.
You MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios.
Explicitly write out your entire deliberation process, documenting every intermediate step, considered alternative, and rejected hypothesis to ensure absolutely no assumption is left unchecked.`;

// ── Types ──

interface DSMLMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning?: string;
  toolCalls?: DSMLToolCall[];
  toolResults?: DSMLToolResult[];
}

interface DSMLToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface DSMLToolResult {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

// ── Full Prompt Encoding (matches encode_messages from encoding_dsv4.py) ──

function encodeMessages(messages: DSMLMessage[], thinkingMode?: 'chat' | 'thinking'): string {
  const mode = thinkingMode || 'thinking';
  const parts: string[] = [];

  // BOS at the very beginning
  parts.push(DSML.BOS);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    switch (msg.role) {
      case 'system':
        parts.push(msg.content);
        break;

      case 'user': {
        // Build user message prefix
        let userContent = DSML.USER;

        // Add tool results if present
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const tr of msg.toolResults) {
            const resultObj: Record<string, unknown> = {
              tool_call_id: tr.id,
              name: tr.name,
              content: tr.content,
            };
            if (tr.isError) resultObj.error = true;
            userContent += DSML.TOOL_RESULT_OPEN + JSON.stringify(resultObj) + DSML.TOOL_RESULT_CLOSE;
          }
        }

        userContent += msg.content;
        parts.push(userContent);
        // Assistant prefix after user message
        parts.push(DSML.ASSISTANT);
        break;
      }

      case 'assistant': {
        // In thinking mode, open think block
        if (mode === 'thinking') {
          if (msg.reasoning) {
            parts.push(DSML.THINK_OPEN + msg.reasoning + DSML.THINK_CLOSE);
          } else {
            parts.push(DSML.THINK_OPEN); // Open for model to fill
          }
        } else {
          // Chat mode: close think immediately
          parts.push(DSML.THINK_CLOSE);
        }

        // Response content
        if (msg.content) {
          parts.push(msg.content);
        }

        // Tool calls
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          parts.push(formatToolCallsDSML(msg.toolCalls));
        }

        // EOS at end of assistant turn
        parts.push(DSML.EOS);
        break;
      }

      case 'tool':
        // Tool messages are folded into the NEXT user message
        break;
    }
  }

  return parts.join('');
}

// ── DSML Tool Call Formatting ──

function formatToolCallsDSML(calls: DSMLToolCall[]): string {
  const parts: string[] = [DSML.TOOL_CALLS_OPEN];

  for (const call of calls) {
    parts.push(`${DSML.INVOKE_OPEN} name="${escapeXml(call.name)}">`);

    for (const [key, value] of Object.entries(call.arguments)) {
      const isString = typeof value === 'string';
      const strValue = isString ? String(value) : JSON.stringify(value);
      parts.push(
        `${DSML.PARAMETER_OPEN} name="${escapeXml(key)}" string="${isString}">${escapeXml(strValue)}${DSML.PARAMETER_CLOSE}`
      );
    }

    parts.push(DSML.INVOKE_CLOSE);
  }

  parts.push(DSML.TOOL_CALLS_CLOSE);
  return parts.join('');
}

// ── Response Parsing ──

function parseAssistantResponse(
  text: string,
  thinkingMode?: 'chat' | 'thinking'
): { reasoning: string; content: string; toolCalls: DSMLToolCall[] } {
  const mode = thinkingMode || 'thinking';
  let reasoning = '';
  let content = text;
  const toolCalls: DSMLToolCall[] = [];

  // Extract think block
  if (mode === 'thinking') {
    const thinkStart = content.indexOf(DSML.THINK_OPEN);
    if (thinkStart !== -1) {
      const reasoningStart = thinkStart + DSML.THINK_OPEN.length;
      const thinkEnd = content.indexOf(DSML.THINK_CLOSE, reasoningStart);
      if (thinkEnd !== -1) {
        reasoning = content.slice(reasoningStart, thinkEnd);
        content = content.slice(0, thinkStart) + content.slice(thinkEnd + DSML.THINK_CLOSE.length);
      } else {
        // Unclosed think — everything after is reasoning
        reasoning = content.slice(reasoningStart);
        content = content.slice(0, thinkStart);
      }
    }
  }

  // Extract DSML tool calls
  const callsStart = content.indexOf(DSML.TOOL_CALLS_OPEN);
  if (callsStart !== -1) {
    const callsContentStart = callsStart + DSML.TOOL_CALLS_OPEN.length;
    const callsEnd = content.indexOf(DSML.TOOL_CALLS_CLOSE, callsContentStart);
    if (callsEnd !== -1) {
      const callsBlock = content.slice(callsContentStart, callsEnd);
      content = content.slice(0, callsStart) + content.slice(callsEnd + DSML.TOOL_CALLS_CLOSE.length);

      // Parse invoke elements
      const invokeRegex = /<\|DSML\|invoke name="([^"]*)">([\s\S]*?)<\/\|DSML\|invoke>/g;
      let match: RegExpExecArray | null;
      while ((match = invokeRegex.exec(callsBlock)) !== null) {
        const name = unescapeXml(match[1]);
        const paramsBlock = match[2];
        const args: Record<string, unknown> = {};

        const paramRegex = /<\|DSML\|parameter name="([^"]*)" string="(true|false)">([\s\S]*?)<\/\|DSML\|parameter>/g;
        let pMatch: RegExpExecArray | null;
        while ((pMatch = paramRegex.exec(paramsBlock)) !== null) {
          const pName = unescapeXml(pMatch[1]);
          const isString = pMatch[2] === 'true';
          const rawValue = unescapeXml(pMatch[3]);
          args[pName] = isString ? rawValue : JSON.parse(rawValue);
        }

        toolCalls.push({
          id: 'call_' + toolCalls.length.toString(16).padStart(4, '0'),
          name,
          arguments: args,
        });
      }
    }
  }

  // Strip EOS
  if (content.endsWith(DSML.EOS)) {
    content = content.slice(0, -DSML.EOS.length);
  }

  return { reasoning, content: content.trim(), toolCalls };
}

// ── XML Escaping ──

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeXml(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

// ── Effort Control ──

function getEffortDirective(tier: number): string {
  switch (tier) {
    case 0: case 1: return '';
    case 2: return '';
    case 3: case 4: return EFFORT_MAX_PREFIX;
    default: return '';
  }
}

// ── Model Mapping ──
// Mammoth-specific override. The main offline model catalog lives at
// src/utils/model/catalog.ts — refer there for the canonical per-provider model table.

const MODEL_MAP: Record<string, string> = {
  opus: 'deepseek-v4-pro',
  sonnet: 'deepseek-v4-flash',
  haiku: 'deepseek-v4-flash',
  architect: 'deepseek-v4-pro',
  executor: 'deepseek-v4-flash',
  'code-reviewer': 'deepseek-v4-pro',
  debugger: 'deepseek-v4-pro',
  explore: 'deepseek-v4-flash',
};

function mapModel(canonicalModel: string): string {
  return MODEL_MAP[canonicalModel] || 'deepseek-v4-flash';
}

export {
  DSML,
  encodeMessages,
  formatToolCallsDSML,
  parseAssistantResponse,
  getEffortDirective,
  mapModel,
  MODEL_MAP,
  EFFORT_MAX_PREFIX,
};
export type { DSMLMessage, DSMLToolCall, DSMLToolResult };
