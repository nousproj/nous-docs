# nous-node-supervisor

> **Phase 2** — minimal scaffold only in Phase 1.

Per-node daemon. Manages the lifecycle of `nous-agent-runtime` processes on a single node (ECS task, EC2 instance, Lambda, VM, or edge device).

## Phase 2 Responsibilities

- Receive task assignments from nous-scheduler (gRPC)
- Spawn `nous-agent-runtime` processes with proper isolation
- Report node capacity to control plane (available slots, tokens/min)
- Health checks on local running agents
- Enforce resource limits (tokens/min, cost/hour, concurrent tasks)
- Graceful shutdown of agents on scale-down

## Node Capacity Model

```
Node capacity:
  maxConcurrentAgents: 10
  tokensPerMinute: 50000
  currentAgents: 3
  availableSlots: 7
  estimatedTokensAvailable: 35000
```

## Phase 1 Status

- [x] `cmd/nous-node-supervisor/main.go` — health endpoint scaffold
- [x] `internal/config/` — configuration loading
- [x] `Dockerfile`
- [x] `Makefile`
- [ ] gRPC server for task assignment (Phase 2)
- [ ] Agent process spawning (Phase 2)
- [ ] Capacity reporting to control plane (Phase 2)
- [ ] Health checks on local agents (Phase 2)
