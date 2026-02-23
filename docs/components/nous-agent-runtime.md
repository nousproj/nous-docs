# nous-agent-runtime

> **Phase 2** — minimal scaffold only in Phase 1.

The sandboxed agent execution environment. Runs inside a container or process managed by `nous-node-supervisor`. Handles LLM calls, tool invocations, cognitive state management, and reporting.

## Phase 2 Responsibilities

- Execute agent tasks (LLM API calls, tool invocations)
- Manage conversation context (message history, context window)
- Cognitive state checkpointing to S3 (periodic + on demand)
- Report task metrics (tokens, cost, quality score, latency)
- Publish status updates to `nous-controller-manager`
- Context window management (rolling summarization when near limit)
- Quality self-assessment after task completion

## Cognitive State Model

```
CognitiveState:
  lastCheckpointId: "ckpt-01JCXZ..."
  lastCheckpointTime: "2026-02-21T10:00:00Z"
  reasoningDepth: 12           # number of reasoning steps taken
  contextUtilization: 0.73     # 73% of context window used
  activeTasks: 1
```

## Phase 1 Status

- [x] `cmd/nous-agent-runtime/main.go` — health endpoint scaffold
- [x] `internal/config/` — configuration loading
- [x] `Dockerfile`
- [x] `Makefile`
- [ ] LLM API integration (Anthropic, OpenAI) (Phase 2)
- [ ] Tool invocation framework (Phase 2)
- [ ] Cognitive state checkpointing to S3 (Phase 2)
- [ ] Metrics reporting to controller (Phase 2)
- [ ] Context window management (Phase 2)
