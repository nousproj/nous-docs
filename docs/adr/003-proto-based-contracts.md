# ADR-003: Proto-Based Contracts with Local Stub Generation

**Status**: Accepted

**Date**: 2026-02-14

---

## Context

Nous is a multi-repository system with services that need to communicate via gRPC. Two approaches were considered for managing service contracts:

1. **Shared Go Module**: Create a shared Go library (`nous-common`) that all services import
2. **Proto-Based Contracts**: Centralize `.proto` files in `nous-proto`, services generate stubs locally

The decision impacts code sharing, versioning, circular dependencies, and multi-language support.

---

## Decision

We will use **proto-based contracts with local stub generation** (`nous-proto` as the contract repository).

**Rationale**: Proto files are the single source of truth for service interfaces. Services generate Go stubs locally using `buf generate`. Services do NOT import each other's Go modules.

---

## Rationale

### Why Proto Contracts Win

#### 1. Single Source of Truth
- **All service interfaces defined in one place**: `nous-proto`
- **Versioned via Git tags**: `v0.1.0`, `v0.2.0`, etc.
- **No ambiguity**: Proto is the contract, not generated code

#### 2. No Circular Dependencies
- **Proto repo has zero dependencies** (leaf node in DAG)
- **Services generate stubs locally** (not import from each other)
- **Pattern**: Both `nous-api-server` and `nous-scheduler` depend on `nous-proto`, not each other

#### 3. Backward Compatibility Enforcement
- **Buf linter**: Detects breaking changes (`buf breaking --against '.git#branch=main'`)
- **Protobuf rules**: Cannot remove fields, change types, reuse field numbers
- **CI integration**: Breaking changes block merges

#### 4. Multi-Language Support (Future)
- **Generate stubs for any language**: Go, Python, TypeScript, Rust
- **Example**: CLI written in Python can import proto-generated types
- **Evidence**: `buf.gen.yaml` supports plugins for all major languages

#### 5. Tooling Ecosystem
- **Buf**: Linting, breaking change detection, code generation, registry
- **grpcurl**: Test gRPC APIs without writing code
- **buf.build**: Public registry for proto files (Phase 3)

---

## Consequences

### Positive

- ✅ **No circular dependencies**: Services never import each other's Go modules
- ✅ **Versioning clarity**: Proto repo tagged with versions (e.g., `v0.1.0`)
- ✅ **Backward compatibility enforced**: Buf breaking change detection in CI
- ✅ **Multi-language support**: Generate stubs for Python, TypeScript, etc.
- ✅ **Smaller service repos**: No need to share Go utility code

### Negative

- ❌ **Two-step workflow**: Change proto → regenerate stubs in all services
- ❌ **No shared Go utilities**: Services duplicate small utilities

### Mitigation

- **Two-step workflow**: Automate with `make proto-gen` in each service Makefile
- **Shared utilities**: Acceptable to duplicate (e.g., `ULIDGenerator`, `ConfigLoader`). Extract to shared library only when patterns stabilize (not Phase 1).

---

## Alternatives Considered

### Alternative 1: Shared Go Module (`nous-common`)

**Approach**: Create `github.com/nousproj/nous-common` with shared types, utilities, clients.

**Pros**:
- One import for all shared code
- Easy to share utilities (`ULIDGenerator`, `Logger`, etc.)

**Cons**:
- **Circular dependency risk**: If `nous-api-server` imports `nous-common` and `nous-common` imports `nous-api-server`, build breaks
- **Versioning hell**: All services must upgrade `nous-common` in lockstep
- **No backward compatibility enforcement**: Go doesn't have Buf's breaking change detection
- **Tight coupling**: Changes to shared code affect all services

**Verdict**: Rejected — Circular dependency risk is too high. Proto contracts are a better abstraction.

---

### Alternative 2: OpenAPI / REST

**Approach**: Use OpenAPI (Swagger) for REST APIs instead of gRPC/Proto.

**Pros**:
- Human-readable (JSON/YAML)
- Wide tool support (Swagger UI, Postman)
- HTTP/JSON (easier debugging with curl)

**Cons**:
- **No streaming**: REST cannot do server-side streaming (needed for Watch API)
- **Performance**: JSON serialization slower than Protobuf
- **Type safety**: OpenAPI code generation less mature than Protobuf
- **No Buf equivalent**: No tool as good as Buf for breaking change detection

**Verdict**: Rejected — Watch API requires server-side streaming (gRPC). Proto/gRPC is the right choice.

---

### Alternative 3: Monorepo with Shared Packages

**Approach**: Single monorepo with shared packages (e.g., `pkg/types`, `pkg/client`).

**Pros**:
- Easy code sharing (import from `pkg/`)
- Single repo to version and deploy

**Cons**:
- **Scalability**: Monorepo tooling (Bazel, Pants) adds complexity
- **Team friction**: Multiple teams committing to one repo causes merge conflicts
- **Deployment coupling**: All services deployed together (cannot deploy `nous-scheduler` independently)

**Verdict**: Rejected — Multi-repo aligns better with microservices (independent deployment). Use proto for contract sharing.

---

## Proto Consumption Pattern

### Central Definitions, Local Generation

**Pattern**: `nous-proto` holds `.proto` files. Services generate stubs locally using `buf generate`.

**Workflow**:
```bash
# In nous-proto
git tag v0.1.0
git push --tags

# In nous-api-server
buf generate https://github.com/nousproj/nous-proto.git#tag=v0.1.0
```

**Local Development** (use `go work` to avoid versioning):
```bash
cd nousproj
go work init
go work use ./nous-proto ./nous-api-server ./nous-scheduler ./nous-controller-manager
```

**Evidence**: CLAUDE.md lines 555-564

---

## Buf Configuration

### nous-proto/buf.yaml

```yaml
version: v2
modules:
  - path: .
    name: buf.build/nousproj/nous-proto
lint:
  use:
    - DEFAULT
breaking:
  use:
    - FILE
```

**Breaking change detection**: Enabled at `FILE` level (per `.proto` file).

**Linting**: `DEFAULT` rules (field naming, package structure, etc.).

---

### Service buf.gen.yaml

```yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen
    opt: paths=source_relative
  - remote: buf.build/grpc/go
    out: gen
    opt: paths=source_relative
```

**Plugins**:
- `protocolbuffers/go`: Generate Go types
- `grpc/go`: Generate gRPC client/server stubs

**Output**: `gen/nous/v1alpha1/` (local to each service repo)

---

## Versioning Strategy

### Proto Versions

- **Alpha**: `v1alpha1` (unstable, breaking changes allowed)
- **Beta**: `v1beta1` (semi-stable, breaking changes rare)
- **GA**: `v1` (stable, no breaking changes)

**Kubernetes convention**: Start with `v1alpha1` to signal pre-stability.

**Evidence**: CLAUDE.md line 553 ("Update existing proto from nous.v1 to nous.v1alpha1")

---

### Git Tags

**Pattern**: Semantic versioning (`v0.1.0`, `v1.0.0`, `v2.0.0`)

**Breaking changes**: Increment major version (e.g., `v1.0.0` → `v2.0.0`)

**Backward-compatible additions**: Increment minor version (e.g., `v1.0.0` → `v1.1.0`)

---

## Anti-Patterns to Avoid

### ❌ DO NOT: Import Another Service's Go Module

```go
// WRONG — violates dependency rules
import "github.com/nousproj/nous-scheduler/internal/scheduler"
```

### ❌ DO NOT: Use Replace Directives in Committed go.mod

```go
// WRONG — will break in CI
replace github.com/nousproj/nous-proto => ../nous-proto
```

Use `go work` instead for local development.

### ❌ DO NOT: Generate Stubs Into Proto Repo

**WRONG**:
```
nous-proto/
├── proto/
│   └── v1alpha1/
│       └── nous.proto
└── gen/           ← WRONG: generated code in proto repo
    └── go/
```

**RIGHT**:
```
nous-api-server/
├── proto/         ← CORRECT: generated code in service repo
│   └── gen/
│       └── nous/
└── internal/
```

**Rationale**: Generated code is language-specific. Each service generates its own stubs.

---

## References

- CLAUDE.md: Proto package versioning (lines 553-564)
- CLAUDE.md: Repository standards (lines 92-95 — proto/ in service repos)
- [dependency-graph.md](../architecture/dependency-graph.md) — Proto consumption pattern and ownership rules

---

**Decision made by**: Architecture Team
**Last reviewed**: 2026-02-15
