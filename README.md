# Nous Documentation

**Nous** (Greek: "mind", "intellect") is an open-source AI agent orchestration system — the control plane for AI agents. It applies proven Kubernetes infrastructure patterns (declarative resources, reconciliation loops, self-healing) to AI agent management while introducing agent-specific primitives like cognitive state management and multi-objective scheduling.

## Repository Map

| Repository | Purpose | Status |
|------------|---------|--------|
| [nous-proto](https://github.com/nousproj/nous-proto) | Protobuf contracts (source of truth for all service interfaces) | Active |
| [nous-api-server](https://github.com/nousproj/nous-api-server) | API Server — CRD validation, watch streams, admission control | Phase 1 |
| [nous-controller-manager](https://github.com/nousproj/nous-controller-manager) | Controllers — AgentController, TaskController, HealthController, RecoveryController | Phase 1 |
| [nous-scheduler](https://github.com/nousproj/nous-scheduler) | Multi-objective scheduler (cost/quality/latency optimization) | Phase 2 |
| [nous-node-supervisor](https://github.com/nousproj/nous-node-supervisor) | Node-level agent lifecycle management | Phase 2 |
| [nous-agent-runtime](https://github.com/nousproj/nous-agent-runtime) | Agent runtime SDK/sidecar for LLM execution | Phase 2 |
| [nous-infra](https://github.com/nousproj/nous-infra) | Pulumi IaC (TypeScript) — AWS deployment automation | Phase 1 |
| [nous-docs](https://github.com/nousproj/nous-docs) | Architecture documentation, ADRs, implementation guides | Active |

## Documentation Index

| Document | Purpose |
|----------|---------|
| **[CLAUDE.md](./CLAUDE.md)** | **Master implementation prompt** — complete Phase 1 specification for engineers |
| [architecture/system-architecture.md](./architecture/system-architecture.md) | System overview, component diagram, technology stack |
| [architecture/dependency-graph.md](./architecture/dependency-graph.md) | Inter-repository dependency DAG with validation rules |
| [architecture/data-model.md](./architecture/data-model.md) | DynamoDB single-table design, GSI schemas, optimistic locking |
| [adr/001-standalone-control-plane.md](./adr/001-standalone-control-plane.md) | Why standalone system over Kubernetes operator |
| [adr/002-dynamodb-state-store.md](./adr/002-dynamodb-state-store.md) | Why DynamoDB for primary state storage |
| [adr/003-proto-based-contracts.md](./adr/003-proto-based-contracts.md) | Why proto with local stub generation |
| [adr/004-ulid-resource-versioning.md](./adr/004-ulid-resource-versioning.md) | Why ULIDs for resource_version field |
| [adr/005-nats-jetstream-messaging.md](./adr/005-nats-jetstream-messaging.md) | Why NATS JetStream for inter-agent messaging |
| [analysis/cycle-analysis.md](./analysis/cycle-analysis.md) | Cyclic dependency detection (inter-repo and intra-repo) |
| [phase-1/README.md](./phase-1/README.md) | Phase 1 execution order and milestones |
| [diagrams/README.md](./diagrams/README.md) | How to render Mermaid diagrams |

## Implementation Phases

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1** | Foundation: Proto, API Server, Controller Manager, Infra | 🟡 In Progress |
| **Phase 2** | Execution: Scheduler, Node Supervisor, Agent Runtime | 📋 Planned |
| **Phase 3** | Orchestration: Workflows, multi-agent coordination | 📋 Planned |
| **Phase 4** | Production: Auto-scaling, cost optimization, observability | 📋 Planned |

## Contributing

Before implementing any feature, read **[CLAUDE.md](./CLAUDE.md)** completely. It contains:

- Phase 1 implementation plan with acceptance criteria
- Proto schemas for all resources (AgentDefinition, AgentTask, AgentInstance)
- DynamoDB table design with GSI configurations
- Leader election and fencing token patterns
- Quality gates and anti-patterns to avoid

All implementation decisions should reference ADRs in `adr/` for traceability.

## Quick Start

For Phase 1 implementers:

1. Read [CLAUDE.md](./CLAUDE.md) (master implementation prompt)
2. Review [architecture/system-architecture.md](./architecture/system-architecture.md)
3. Study [architecture/dependency-graph.md](./architecture/dependency-graph.md) to understand inter-repo relationships
4. Check [architecture/data-model.md](./architecture/data-model.md) for DynamoDB schema
5. Follow the implementation order in [phase-1/README.md](./phase-1/README.md)

## License

TBD

## Maintainers

- Architecture Team (@nousproj/architecture)
- Platform Team (@nousproj/platform)
