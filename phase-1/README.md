# Phase 1: Foundation — Execution Order

This document outlines the recommended implementation sequence for Phase 1 of the Nous control plane, based on the dependency chain between components.

---

## Overview

**Goal**: Stand up the skeleton of the Nous control plane with real, working components that demonstrate the core reconciliation loop pattern.

**Success Criteria**: Create AgentDefinition via gRPC → AgentController reconciles → AgentInstances appear in DynamoDB.

---

## Implementation Sequence

### 1. `nous-proto` — Contract Definitions

**Priority**: Implement FIRST — everything else depends on this.

**Tasks**:
- Update proto package from `nous.v1` to `nous.v1alpha1` (alpha versioning signal)
- Define `types.proto` with all core resources (AgentDefinition, AgentTask, AgentInstance)
- Define `api.proto` with NousAPI gRPC service
- Configure Buf for linting and breaking change detection
- Generate Go stubs with `buf generate`
- Initialize Go module: `go mod init github.com/nousproj/nous-proto`

**Acceptance Criteria**:
- [ ] `buf lint` passes with zero warnings
- [ ] `buf generate` produces Go stubs in `gen/nous/v1alpha1/`
- [ ] `buf breaking` baseline established
- [ ] All types have comprehensive proto comments

**Reference**: [CLAUDE.md](../CLAUDE.md#repository-nous-proto)

---

### 2. `nous-api-server` — API Layer & State Store

**Priority**: Implement SECOND — after proto stubs are generated.

**Tasks**:
- Implement gRPC server for NousAPI service
- Define StateStore interface (storage abstraction)
- Implement in-memory StateStore (for testing)
- Implement DynamoDB StateStore with single-table design
- Add resource validation and admission control
- Implement Watch API with in-memory fan-out (Phase 1 pattern)
- Add configuration loading with Viper (env vars, config file, flags)
- Add health endpoints (`/healthz`, `/readyz`) and metrics (`/metrics`)
- Create `docker-compose.yml` with DynamoDB Local

**Acceptance Criteria**:
- [ ] gRPC server starts and serves all NousAPI methods
- [ ] DynamoDB StateStore implements optimistic concurrency with `resource_version`
- [ ] Watch streams work via server-streaming gRPC
- [ ] Unit tests for handler, service, and repository layers
- [ ] Integration test against DynamoDB Local
- [ ] Makefile targets: `build`, `test`, `lint`, `proto-gen`, `docker-build`, `run-local`

**Reference**: [CLAUDE.md](../CLAUDE.md#repository-nous-api-server)

---

### 3. `nous-controller-manager` — Reconciliation Loop

**Priority**: Implement THIRD — after api-server is running.

**Tasks**:
- Implement AgentController (watches AgentDefinitions, reconciles AgentInstances)
- Build reconciliation loop with rate-limited work queue
- Implement leader election via DynamoDB lease with fencing tokens
- Add event recording for state changes
- Connect to api-server via gRPC Watch streams
- Add Prometheus metrics (reconciliation duration, queue depth, errors)

**Acceptance Criteria**:
- [ ] AgentController watches AgentDefinitions via gRPC Watch
- [ ] Reconciliation creates/deletes AgentInstance records to match desired count
- [ ] Status updates reflect ready/desired/unavailable instance counts
- [ ] Leader election ensures single-active controller-manager
- [ ] Unit tests with mock StateStore
- [ ] Integration test: create AgentDefinition → verify AgentInstances created

**Reference**: [CLAUDE.md](../CLAUDE.md#repository-nous-controller-manager)

---

### 4. `docker-compose` — Local Development Environment

**Priority**: Implement FOURTH — validate all services work together locally.

**Tasks**:
- Add DynamoDB Local service
- Add table initialization script (create `nous-state` table with GSIs)
- Add api-server service with environment variables
- Add controller-manager service
- Configure networking and service discovery
- Document local development workflow

**Acceptance Criteria**:
- [ ] `docker-compose up` starts all services successfully
- [ ] Services can connect to DynamoDB Local
- [ ] E2E smoke test: Create AgentDefinition via grpcurl → AgentInstances appear
- [ ] Logs are structured and readable

**Reference**: [CLAUDE.md](../CLAUDE.md#docker-compose-local-development)

---

### 5. Scaffold Remaining Services

**Priority**: Implement FIFTH — minimal scaffolding for Phase 2 readiness.

**Services**:
- `nous-scheduler`
- `nous-node-supervisor`
- `nous-agent-runtime`

**Tasks** (for each service):
- Create `cmd/<binary>/main.go` with health check endpoint
- Add `internal/config/` with configuration loading
- Create `Dockerfile` and `Makefile`
- Write basic `README.md` with build/run instructions
- Create `CLAUDE.md` with Phase 2 implementation notes

**Acceptance Criteria**:
- [ ] Each service compiles and starts with health endpoint
- [ ] Each service has documented configuration options
- [ ] Each service has a clear Phase 2 roadmap in `CLAUDE.md`

**Reference**: [CLAUDE.md](../CLAUDE.md#repository-nous-scheduler--nous-node-supervisor--nous-agent-runtime)

---

### 6. `nous-infra` — Infrastructure as Code

**Priority**: Implement LAST — codify what's been validated locally.

**Tasks**:
- Create Pulumi TypeScript stacks for AWS infrastructure
- Define DynamoDB table with GSIs and streams enabled
- Define S3 bucket for cognitive state (versioning enabled)
- Define ECS cluster and task definitions for control plane services
- Configure IAM roles with least-privilege policies
- Add Pulumi stack outputs for service discovery

**Acceptance Criteria**:
- [ ] `pulumi up` creates all AWS resources
- [ ] DynamoDB table matches local docker-compose schema
- [ ] IAM policies follow least-privilege principle
- [ ] Stack outputs provide service discovery information

**Reference**: [CLAUDE.md](../CLAUDE.md#repository-nous-infra)

---

## Implementation Philosophy

### Bottom-Up Within Each Repo

```
1. Interfaces (storage, events)
2. In-memory implementation (for tests)
3. Core business logic (service layer)
4. Handlers (gRPC/HTTP)
5. Server wiring (main.go)
6. DynamoDB implementation
7. Tests (unit + integration)
8. Dockerfile + Makefile
```

### Why Infra is Last

The Pulumi stacks should reflect the **real** IAM policies, port mappings, environment variables, and DynamoDB schema that the running services actually need. Building infra before the services are working leads to drift and rework.

**Pattern**: Validate in docker-compose first → codify in Pulumi.

---

## Quality Gates

Before considering Phase 1 complete, all of the following must pass:

- [ ] All repos compile: `go build ./...`
- [ ] All repos lint clean: `golangci-lint run`
- [ ] All repos pass tests: `go test ./... -race`
- [ ] Proto is lint-clean: `buf lint && buf breaking`
- [ ] Docker compose up works: services start and communicate
- [ ] E2E smoke test passes: Create AgentDefinition → AgentInstances appear
- [ ] No inter-repo Go module cycles: `go mod graph` verification
- [ ] Each repo has `CLAUDE.md` with repo-specific context
- [ ] Each repo has `README.md` with build/run instructions

---

## Development Workflow

### Using `go.work` for Cross-Repo Development

Create `nousproj/go.work` at the parent directory level:

```
go 1.22

use (
    ./nous-proto
    ./nous-api-server
    ./nous-controller-manager
    ./nous-scheduler
    ./nous-node-supervisor
    ./nous-agent-runtime
)
```

**Important**: Add `go.work` and `go.work.sum` to each repo's `.gitignore`. Remove `replace` directives in `go.mod` before committing.

### Proto Changes

Proto changes require regenerating stubs in ALL consumer repos:

```bash
cd nousproj/nous-proto
buf generate

cd ../nous-api-server
make proto-gen

cd ../nous-controller-manager
make proto-gen

# ... repeat for all services
```

### Local Development with DynamoDB

Always use endpoint override for DynamoDB Local:

```bash
export NOUS_STORAGE_DYNAMODB_ENDPOINT=http://localhost:8000
export AWS_ACCESS_KEY_ID=dummy
export AWS_SECRET_ACCESS_KEY=dummy
```

---

## References

- [CLAUDE.md](../CLAUDE.md) — Complete Phase 1 implementation specification
- [ADR-001](../adr/001-standalone-control-plane.md) — Standalone control plane decision
- [ADR-002](../adr/002-dynamodb-state-store.md) — DynamoDB state store decision
- [ADR-003](../adr/003-proto-based-contracts.md) — Proto-based contracts decision
- [data-model.md](../architecture/data-model.md) — DynamoDB schema reference
- [dependency-graph.md](../architecture/dependency-graph.md) — Repository dependency rules

---

**Last Updated**: 2026-02-15
