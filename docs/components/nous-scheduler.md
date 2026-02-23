# nous-scheduler

> **Phase 2** — minimal scaffold only in Phase 1.

The multi-objective scheduler. Receives tasks from the NATS queue, evaluates available nodes, and assigns tasks to the best-fit node based on cost, quality, and latency trade-offs.

## Phase 2 Responsibilities

- Consume task queue from NATS JetStream (`nous.tasks.*`)
- Evaluate nodes based on capacity, affinity rules, cost budget
- Multi-objective optimization: minimize cost × maximize quality × minimize latency
- Assign tasks to nodes (`gRPC Assign` to nous-node-supervisor)
- Update task status `Pending → Scheduled`

## Scheduling Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Task priority** | High | Critical > High > Medium > Low |
| **Node capacity** | High | Available tokens/min, concurrent slots |
| **Agent selector** | Required | Task must match agent definition on node |
| **Cost constraint** | Hard | Must be within `spec.maxCost` budget |
| **Quality target** | Soft | Prefer nodes with history of high quality scores |
| **Affinity rules** | Soft | Node labels matching task annotations |

## Phase 1 Status

- [x] `cmd/nous-scheduler/main.go` — health endpoint scaffold
- [x] `internal/config/` — configuration loading
- [x] `Dockerfile`
- [x] `Makefile`
- [ ] NATS consumer (Phase 2)
- [ ] Node capacity tracking (Phase 2)
- [ ] Multi-objective optimizer (Phase 2)
- [ ] gRPC task assignment to node-supervisor (Phase 2)
