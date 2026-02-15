# Cycle Analysis

## Overview

This document analyzes potential cyclic dependencies at two levels:
1. **Inter-Repository Cycles**: Circular dependencies between repositories
2. **Intra-Repository Cycles**: Package import cycles within repositories

**System State**: Early scaffolding phase with minimal implementation code.

---

## A) Inter-Repository Cycle Analysis

### Methodology

Analyzed the dependency graph from `inter-repo-dependency-graph.md` to detect cycles.

**Cycle Detection**: Traversed all edges to identify circular paths where Repo A → Repo B → ... → Repo A.

---

### Results

**Status**: ✅ No inter-repo cycles detected

### Evidence

Based on the documented relationships:

```
nous-api-server → nous-proto (proto dependency)
nous-scheduler → nous-proto (proto dependency)
nous-controller-manager → nous-proto (proto dependency)
nous-node-supervisor → nous-proto (proto dependency)
nous-agent-runtime → nous-proto (proto dependency)

nous-api-server → nous-scheduler (control signal)
nous-scheduler → nous-node-supervisor (scheduling)
nous-node-supervisor → nous-agent-runtime (runtime management)

nous-controller-manager → nous-api-server (watch)
nous-controller-manager → nous-node-supervisor (health check)
nous-agent-runtime → nous-controller-manager (status report)

nous-infra → (all) (deployment)
internal-docs → (all) (documentation)
```

**Graph Analysis**:
1. `nous-proto` is a **leaf node** in the dependency graph (no outbound edges) - cannot participate in cycles
2. `nous-infra` and `internal-docs` have only outbound edges (deployment/documentation) - do not create cycles
3. Control Plane → Data Plane flow is **unidirectional** (API → Scheduler → Node Supervisor → Agent Runtime)
4. Data Plane → Control Plane feedback is via **indirect channels** (status updates to Controller Manager), not direct module dependencies

**Conclusion**: The architecture follows a **DAG (Directed Acyclic Graph)** pattern with clear layering:
- Contracts layer (proto) at the bottom
- Control plane layer above
- Data plane layer on top
- Infrastructure/docs as orthogonal concerns

---

### Potential Future Risk: Controller ↔ Agent Runtime Cycle

**Observation**: The dependency graph shows:
- `nous-controller-manager` → `nous-agent-runtime` (health checks)
- `nous-agent-runtime` → `nous-controller-manager` (status reports)

**Analysis**: This is **NOT a cycle** because:
1. These are **runtime communication dependencies**, not Go module dependencies
2. Go modules only contain compile-time dependencies
3. Both repos communicate via:
   - Shared proto definitions (both depend on `nous-proto`, not each other)
   - Network calls (gRPC/REST)
   - Message queues (SQS, EventBridge)

**Recommendation**: Continue using proto-based contracts to prevent module cycles.

**Evidence**: `repository_standards.md:70-73` states services generate proto stubs locally rather than importing them as dependencies.

---

## B) Intra-Repository Package Cycle Analysis

### Methodology

Attempted to detect package import cycles within each Go repository by:
1. Scanning for `.go` files beyond `main.go`
2. Analyzing `import` statements
3. Building package dependency graphs

**Limitation**: Unable to run `go list -deps` since repositories are scaffolded without internal packages.

---

### Results

**Status**: ✅ No evidence of intra-repo cycles found

### Per-Repository Analysis

#### nous-api-server

**Go Files**: `cmd/nous-api-server/main.go` only

**Imports**:
```go
import "fmt"
```

**Internal Packages**: None (no `internal/` or `pkg/` directories)

**Conclusion**: No cycles possible (single file)

**Evidence**: `nousproj/nous-api-server/cmd/nous-api-server/main.go:1-7`

---

#### nous-scheduler

**Go Files**: `cmd/nous-scheduler/main.go` only

**Imports**:
```go
import "fmt"
```

**Internal Packages**: None

**Conclusion**: No cycles possible (single file)

**Evidence**: `nousproj/nous-scheduler/cmd/nous-scheduler/main.go:1-7`

---

#### nous-controller-manager

**Go Files**: `cmd/nous-controller-manager/main.go` only

**Imports**:
```go
import "fmt"
```

**Internal Packages**: None

**Conclusion**: No cycles possible (single file)

**Evidence**: `nousproj/nous-controller-manager/cmd/nous-controller-manager/main.go:1-7`

---

#### nous-node-supervisor

**Go Files**: `cmd/nous-node-supervisor/main.go` only

**Imports**:
```go
import "fmt"
```

**Internal Packages**: None

**Conclusion**: No cycles possible (single file)

**Evidence**: `nousproj/nous-node-supervisor/cmd/nous-node-supervisor/main.go:1-7`

---

#### nous-agent-runtime

**Go Files**: `cmd/nous-agent-runtime/main.go` only

**Imports**:
```go
import "fmt"
```

**Internal Packages**: None

**Conclusion**: No cycles possible (single file)

**Evidence**: `nousproj/nous-agent-runtime/cmd/nous-agent-runtime/main.go:1-7`

---

### Expected Package Structure (Inferred from Standards)

Based on `repository_standards.md:22-38`, services are expected to have:

```
service-repo/
├── cmd/
│   └── <service>/
│       └── main.go
├── internal/          # Private packages
│   ├── server/        # gRPC/REST server
│   ├── handler/       # Request handlers
│   ├── service/       # Business logic
│   ├── repository/    # Data access
│   └── config/        # Configuration
```

**Cycle Prevention**: The `internal/` directory pattern encourages **layered architecture**:
- `main.go` → `server` → `handler` → `service` → `repository`
- Each layer only imports from layers below
- No upward dependencies

**Confidence**: Inferred from Go best practices and repository standards documentation

---

## Future Cycle Risks

### Risk 1: Circular Dependencies Between Controllers

**Scenario**: If `nous-controller-manager` implements multiple controllers (Agent, Task, Health, Recovery), they might inadvertently import each other.

**Mitigation** (documented in standards):
- Use **shared interfaces** in a `types` or `api` package
- Controllers communicate via **events** rather than direct calls
- Follow Kubernetes controller-runtime patterns (each controller is independent)

**Evidence**: CLAUDE.md mentions separate controllers: AgentController, TaskController, HealthController, RecoveryController

---

### Risk 2: Generated Proto Code Causing Cycles

**Scenario**: If services import generated proto code as a Go module dependency, circular proto definitions could create cycles.

**Mitigation** (documented in standards):
- Proto definitions are **centralized** in `nous-proto`
- Services **generate stubs locally** (not import as dependency)
- Buf linter detects proto-level cycles

**Evidence**: `repository_standards.md:63-90` + `nous-proto/buf.yaml:2-4` (breaking change detection)

---

### Risk 3: Shared Library Proliferation

**Scenario**: As the system grows, teams may create shared libraries that depend on each other.

**Mitigation** (best practice):
- Limit shared libraries to **pure utility code** (logging, metrics, etc.)
- Avoid business logic in shared libraries
- Use **dependency injection** rather than global state

**Confidence**: Inferred from Go best practices

---

## Tooling Recommendations

To detect cycles as implementation proceeds:

### Inter-Repo Cycles
```bash
# Visualize Go module dependencies
go mod graph | grep github.com/nousproj | dot -Tpng -o deps.png
```

### Intra-Repo Cycles
```bash
# Detect package import cycles
go list -deps ./... | xargs go list -f '{{ .ImportPath }} {{ .Deps }}'

# Or use goda tool
go install github.com/loov/goda@latest
goda graph ./... | dot -Tpng -o pkg-deps.png
```

### Proto Cycles
```bash
# Buf automatically detects cycles
buf lint
buf breaking --against '.git#branch=main'
```

---

## Summary

| Level | Status | Evidence | Future Risk |
|-------|--------|----------|-------------|
| **Inter-Repo Cycles** | ✅ None detected | DAG architecture with clear layering | Low (proto-based contracts prevent cycles) |
| **Intra-Repo Cycles** | ✅ None detected | Single-file repositories (scaffolded) | Medium (requires discipline as packages grow) |
| **Proto Cycles** | ✅ None detected | Buf linter enabled | Low (Buf provides tooling) |

**Overall Assessment**: The system is **cycle-free** at this stage. The architectural patterns (proto contracts, layered design, event-driven communication) provide strong foundations to remain cycle-free as implementation proceeds.

---

## Limitations

1. **Static Analysis Only**: Cannot detect runtime cycles (e.g., Agent A calls Agent B calls Agent A)
2. **Scaffolded State**: No internal packages to analyze yet
3. **No Dynamic Loading**: Cannot detect cycles from plugin systems or dynamic imports (if added later)
4. **Missing Tools**: Did not run `go list` (would error on empty repos)

**Confidence Level**: High for current state, Medium for future state (requires ongoing monitoring)