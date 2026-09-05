import { describe, test, expect } from "bun:test"
import { isVisiblePart, summarizeSession, shouldShowScrollButton, disposeIfSet, type MessageWithParts } from "./Share"
import type { MessageV2 } from "opencode/session/message-v2"
import type { Session } from "opencode/session/index"

// --- fixtures -----------------------------------------------------------

let partSeq = 0
function nextPartID() {
  partSeq += 1
  return `prt_${partSeq}`
}

function textPart(overrides: Partial<MessageV2.Part> & { text?: string } = {}): MessageV2.Part {
  return {
    id: nextPartID(),
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text: "hello",
    ...overrides,
  } as MessageV2.Part
}

function stepStartPart(overrides: Partial<MessageV2.Part> = {}): MessageV2.Part {
  return {
    id: nextPartID(),
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "step-start",
    ...overrides,
  } as MessageV2.Part
}

function stepFinishPart(overrides: Partial<MessageV2.Part> = {}): MessageV2.Part {
  return {
    id: nextPartID(),
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "step-finish",
    reason: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  } as MessageV2.Part
}

function snapshotPart(overrides: Partial<MessageV2.Part> = {}): MessageV2.Part {
  return {
    id: nextPartID(),
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "snapshot",
    snapshot: "abc123",
    ...overrides,
  } as MessageV2.Part
}

function patchPart(overrides: Partial<MessageV2.Part> = {}): MessageV2.Part {
  return {
    id: nextPartID(),
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "patch",
    hash: "deadbeef",
    files: ["a.ts"],
    ...overrides,
  } as MessageV2.Part
}

function toolPart(status: "pending" | "running" | "completed" | "error", overrides: Partial<any> = {}): MessageV2.Part {
  const state = {
    pending: { status: "pending", input: {}, raw: "" },
    running: { status: "running", input: {}, time: { start: 0 } },
    completed: { status: "completed", input: {}, output: "done", title: "Bash", metadata: {}, time: { start: 0, end: 1 } },
    error: { status: "error", input: {}, error: "boom", time: { start: 0, end: 1 } },
  }[status]

  return {
    id: nextPartID(),
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "bash",
    state,
    ...overrides,
  } as MessageV2.Part
}

function reasoningPart(overrides: Partial<MessageV2.Part> = {}): MessageV2.Part {
  return {
    id: nextPartID(),
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "reasoning",
    text: "thinking...",
    time: { start: 0 },
    ...overrides,
  } as MessageV2.Part
}

let msgSeq = 0
function nextMessageID() {
  msgSeq += 1
  return `msg_${msgSeq}`
}

function assistantMessage(overrides: Record<string, unknown> = {}, parts: MessageV2.Part[] = []): MessageWithParts {
  return {
    id: nextMessageID(),
    sessionID: "ses_1",
    role: "assistant",
    time: { created: 0 },
    parentID: "msg_0",
    modelID: "claude-sonnet-5",
    providerID: "anthropic",
    mode: "build",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
    parts,
  } as unknown as MessageWithParts
}

function userMessage(overrides: Record<string, unknown> = {}, parts: MessageV2.Part[] = []): MessageWithParts {
  return {
    id: nextMessageID(),
    sessionID: "ses_1",
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID: "anthropic", modelID: "claude-sonnet-5" },
    ...overrides,
    parts,
  } as unknown as MessageWithParts
}

function sessionInfo(overrides: Record<string, unknown> = {}): Session.Info {
  return {
    time: { created: 1000 },
    ...overrides,
  } as unknown as Session.Info
}

// --- isVisiblePart --------------------------------------------------------

describe("isVisiblePart", () => {
  test("keeps a step-start part at index 0", () => {
    expect(isVisiblePart(stepStartPart(), 0)).toBe(true)
  })

  test("hides a step-start part at any later index", () => {
    expect(isVisiblePart(stepStartPart(), 1)).toBe(false)
    expect(isVisiblePart(stepStartPart(), 5)).toBe(false)
  })

  test("always hides snapshot parts", () => {
    expect(isVisiblePart(snapshotPart(), 0)).toBe(false)
  })

  test("always hides patch parts", () => {
    expect(isVisiblePart(patchPart(), 0)).toBe(false)
  })

  test("always hides step-finish parts", () => {
    expect(isVisiblePart(stepFinishPart(), 0)).toBe(false)
  })

  test("hides synthetic text parts", () => {
    expect(isVisiblePart(textPart({ synthetic: true, text: "hidden" }), 2)).toBe(false)
  })

  test("hides empty text parts", () => {
    expect(isVisiblePart(textPart({ text: "" }), 2)).toBe(false)
  })

  test("shows non-empty, non-synthetic text parts", () => {
    expect(isVisiblePart(textPart({ text: "hi", synthetic: false }), 2)).toBe(true)
  })

  test("shows text parts when synthetic is left unset", () => {
    expect(isVisiblePart(textPart({ text: "hi" }), 2)).toBe(true)
  })

  test("hides pending and running tool parts", () => {
    expect(isVisiblePart(toolPart("pending"), 2)).toBe(false)
    expect(isVisiblePart(toolPart("running"), 2)).toBe(false)
  })

  test("shows completed and error tool parts", () => {
    expect(isVisiblePart(toolPart("completed"), 2)).toBe(true)
    expect(isVisiblePart(toolPart("error"), 2)).toBe(true)
  })

  test("shows part types with no explicit rule, e.g. reasoning", () => {
    expect(isVisiblePart(reasoningPart(), 2)).toBe(true)
  })

  test("filters a realistic mixed part list the way Share renders it", () => {
    const parts = [
      stepStartPart(), // index 0 -> visible
      textPart({ text: "Attached media from tool result:", synthetic: true }), // hidden
      toolPart("pending"), // hidden
      toolPart("completed"), // visible
      textPart({ text: "" }), // hidden
      textPart({ text: "final answer" }), // visible
      stepFinishPart(), // hidden
      snapshotPart(), // hidden
      patchPart(), // hidden
      stepStartPart(), // index 8 -> hidden (not first)
    ]

    const visible = parts.filter(isVisiblePart)
    expect(visible).toHaveLength(3)
    expect(visible.map((p) => p.type)).toEqual(["step-start", "tool", "text"])
  })
})

// --- summarizeSession -------------------------------------------------------

describe("summarizeSession", () => {
  test("returns a zeroed result when info is undefined, regardless of messages", () => {
    const result = summarizeSession(undefined, [assistantMessage({ cost: 5 })])
    expect(result).toEqual({
      rootDir: undefined,
      created: undefined,
      completed: undefined,
      messages: [],
      models: {},
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0 },
    })
  })

  test("picks up created time from info even with no messages", () => {
    const result = summarizeSession(sessionInfo({ time: { created: 4242 } }), [])
    expect(result.created).toBe(4242)
    expect(result.messages).toEqual([])
    expect(result.cost).toBe(0)
  })

  test("aggregates cost, tokens, and model for a single assistant message", () => {
    const msg = assistantMessage({
      providerID: "anthropic",
      modelID: "claude-sonnet-5",
      cost: 1.5,
      tokens: { input: 100, output: 200, reasoning: 10, cache: { read: 0, write: 0 } },
      path: { cwd: "/repo", root: "/repo/root" },
      time: { created: 0, completed: 999 },
    })

    const result = summarizeSession(sessionInfo(), [msg])

    expect(result.cost).toBe(1.5)
    expect(result.tokens).toEqual({ input: 100, output: 200, reasoning: 10 })
    expect(result.models).toEqual({ "anthropic claude-sonnet-5": ["anthropic", "claude-sonnet-5"] })
    expect(result.rootDir).toBe("/repo/root")
    expect(result.completed).toBe(999)
    expect(result.messages).toEqual([msg])
  })

  test("sums cost and tokens across multiple assistant messages", () => {
    const first = assistantMessage({
      cost: 1,
      tokens: { input: 10, output: 20, reasoning: 1, cache: { read: 0, write: 0 } },
    })
    const second = assistantMessage({
      cost: 2.5,
      tokens: { input: 5, output: 15, reasoning: 2, cache: { read: 0, write: 0 } },
    })

    const result = summarizeSession(sessionInfo(), [first, second])

    expect(result.cost).toBe(3.5)
    expect(result.tokens).toEqual({ input: 15, output: 35, reasoning: 3 })
  })

  test("includes user messages in the message list without affecting cost/tokens/models", () => {
    const user = userMessage()
    const assistant = assistantMessage({ cost: 2, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } })

    const result = summarizeSession(sessionInfo(), [user, assistant])

    expect(result.messages).toEqual([user, assistant])
    expect(result.cost).toBe(2)
    expect(Object.keys(result.models)).toEqual(["anthropic claude-sonnet-5"])
  })

  test("keeps the last completed time and rootDir when messages disagree", () => {
    const first = assistantMessage({ path: { cwd: "/repo", root: "/repo/a" }, time: { created: 0, completed: 100 } })
    const second = assistantMessage({ path: { cwd: "/repo", root: "/repo/b" }, time: { created: 0, completed: 200 } })

    const result = summarizeSession(sessionInfo(), [first, second])

    expect(result.rootDir).toBe("/repo/b")
    expect(result.completed).toBe(200)
  })

  test("does not clear rootDir/completed when a later message omits them", () => {
    const first = assistantMessage({ path: { cwd: "/repo", root: "/repo/a" }, time: { created: 0, completed: 100 } })
    const second = assistantMessage({ path: { cwd: "/repo", root: "" }, time: { created: 0 } })

    const result = summarizeSession(sessionInfo(), [first, second])

    expect(result.rootDir).toBe("/repo/a")
    expect(result.completed).toBe(100)
  })

  test("merges distinct provider/model pairs into separate model entries", () => {
    const first = assistantMessage({ providerID: "anthropic", modelID: "claude-sonnet-5" })
    const second = assistantMessage({ providerID: "openai", modelID: "gpt-5" })

    const result = summarizeSession(sessionInfo(), [first, second])

    expect(result.models).toEqual({
      "anthropic claude-sonnet-5": ["anthropic", "claude-sonnet-5"],
      "openai gpt-5": ["openai", "gpt-5"],
    })
  })
})

// --- shouldShowScrollButton -------------------------------------------------

describe("shouldShowScrollButton", () => {
  test("shows when scrolling down past the threshold and not near bottom", () => {
    expect(shouldShowScrollButton({ currentScrollY: 300, lastScrollY: 100, isNearBottom: false })).toBe(true)
  })

  test("stays hidden when scrolling up, even past the threshold", () => {
    expect(shouldShowScrollButton({ currentScrollY: 300, lastScrollY: 400, isNearBottom: false })).toBe(false)
  })

  test("stays hidden when scrolling down but under the 200px threshold", () => {
    expect(shouldShowScrollButton({ currentScrollY: 150, lastScrollY: 50, isNearBottom: false })).toBe(false)
  })

  test("stays hidden near the bottom even while scrolling down past the threshold", () => {
    expect(shouldShowScrollButton({ currentScrollY: 300, lastScrollY: 100, isNearBottom: true })).toBe(false)
  })

  test("treats an unchanged scroll position as not scrolling down", () => {
    expect(shouldShowScrollButton({ currentScrollY: 300, lastScrollY: 300, isNearBottom: false })).toBe(false)
  })
})

// --- disposeIfSet ------------------------------------------------------------

describe("disposeIfSet", () => {
  test("calls dispose with the value when it is set", () => {
    const seen: number[] = []
    disposeIfSet(42, (value) => seen.push(value))
    expect(seen).toEqual([42])
  })

  test("does not call dispose when the value is undefined", () => {
    let called = false
    disposeIfSet(undefined, () => (called = true))
    expect(called).toBe(false)
  })

  test("does not call dispose for falsy-but-meaningful values like 0", () => {
    // Matches the source's `if (scrollTimeout)` checks, which also treat a
    // timer id of 0 as "not set" - documenting that rather than changing it.
    let called = false
    disposeIfSet(0, () => (called = true))
    expect(called).toBe(false)
  })
})
