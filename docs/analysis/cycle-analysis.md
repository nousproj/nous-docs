# Cycle Analysis

## Overview

This document analyzes potential cyclic dependencies at two levels:

1. **Inter-Repository Cycles**: Circular Go module dependencies between repositories
2. **Intra-Repository Cycles**: Package import cycles within repositories

**System State**: Phase 1 implementation complete for `nous-api-server` and `nous-controller-manager`. Scaffolded stubs for `nous-scheduler`, `nous-node-supervisor`, `nous-agent-runtime`.

---

## A) Inter-Repository Cycle Analysis

### Methodology

`go mod graph` filtered to `nousproj` modules, verified against the documented DAG.

### Results

**Status**: ✅ No inter-repo cycles detected

### Go Module Dependency Graph (actual)

```
nous-proto          (leaf — zero outbound deps)
    ↑
    ├── nous-api-server        go.mod: require github.com/nousproj/nous-proto
    └── nous-controller-manager go.mod: require github.com/nousproj/nous-proto
```

Neither `nous-api-server` nor `nous-controller-manager` imports the other as a Go module. All cross-service communication is runtime-only (gRPC over the network), not a compile-time import.

### Why the controller ↔ api-server link is not a cycle

```
nous-controller-manager → gRPC calls → nous-api-server   (runtime, not module dep)
nous-api-server         ← Watch stream ← nous-controller-manager
```

The controller-manager depends on `nous-proto` for generated stubs. It dials the api-server's address at runtime. There is no `require github.com/nousproj/nous-api-server` in the controller-manager's `go.mod`. Confirmed: `go build ./...` succeeds in both repos independently.

---

## B) Intra-Repository Package Cycle Analysis

### Methodology

```bash
go list -f '{{.ImportPath}}: {{join .Imports " "}}' ./internal/...
```

Run against the actual implementations (not empty scaffolds).

---

### nous-api-server — Package Import Graph

**Packages**: 9 internal packages across handler, middleware, server, service, storage, watch, version, config layers.

**Actual import edges (internal only)**:

```
cmd/nous-api-server
  → internal/config
  → internal/handler
  → internal/server
  → internal/service
  → internal/storage
  → internal/storage/dynamodb
  → internal/storage/memory
  → internal/watch

internal/server
  → internal/handler
  → internal/middleware
  → internal/storage          ← passes store to fencing interceptor

internal/handler
  → internal/service
  → internal/storage          ← mapError uses storage.Err* sentinels
  → internal/watch

internal/middleware
  → internal/storage          ← reads/writes store from context

internal/service
  → internal/storage
  → internal/watch

internal/storage/dynamodb
  → internal/storage          ← implements StateStore interface
  → internal/config
  → internal/version

internal/storage/memory
  → internal/storage          ← implements StateStore interface
  → internal/version

internal/version              (leaf — no internal deps)
internal/watch                (leaf — no internal deps)
internal/storage              (leaf — no internal deps)
internal/config               (leaf — no internal deps)
```

**Status**: ✅ No cycles. The import graph is a strict DAG:

```
cmd → server → handler → service → storage (leaf)
              ↘ middleware → storage
                             ↑
                    storage/dynamodb → storage
                    storage/memory  → storage
```

No package imports anything above it in the layering. `storage` is a true leaf (no intra-repo imports at all). `version` and `watch` are also leaves.

---

### nous-controller-manager — Package Import Graph

**Packages**: 7 internal packages.

**Actual import edges (internal only)**:

```
cmd/nous-controller-manager
  → internal/client
  → internal/config
  → internal/controller
  → internal/informer
  → internal/leaderelection
  → internal/metrics
  → internal/workqueue

internal/controller
  → internal/client
  → internal/metrics
  → internal/workqueue

internal/informer
  → internal/client

internal/client               (leaf — no internal deps)
internal/config               (leaf — no internal deps)
internal/leaderelection       (leaf — no internal deps)
internal/metrics              (leaf — no internal deps)
internal/workqueue            (leaf — no internal deps)
```

**Status**: ✅ No cycles. The import graph is a strict DAG:

```
cmd → controller → client    (leaf)
    ↘ informer  → client
      controller → metrics   (leaf)
      controller → workqueue (leaf)
```

`leaderelection` is fully independent of all other internal packages — it only imports AWS SDK and stdlib. This is intentional: the elector is wired in `main.go` only.

---

## C) Proto-Level Cycle Analysis

**Status**: ✅ No cycles

`buf lint` passes with zero warnings. Proto files import only `google/protobuf/*.proto` (well-known types). No cross-package proto imports between `nous-proto` files that could form a cycle.

---

## Future Cycle Risks

### Risk 1: Controller packages importing each other

As more controllers are added (TaskController, HealthController, RecoveryController), they must not import each other. The current pattern keeps all controllers in the same `internal/controller` package with a shared `Controller` interface — they share a namespace, not a dependency edge.

**Mitigation**: Keep the `Controller` interface in `internal/controller/interface.go`. If controllers grow large enough to split into sub-packages, they must communicate via the `client` package only, never by direct import.

### Risk 2: Service layer importing handler layer

The current layering forbids upward imports:

```
handler → service → storage
```

If a service method ever needs to return a gRPC status code directly (skipping `mapError` in the handler), it would need to import `google.golang.org/grpc/codes` — which is fine. But if it imported `internal/handler`, that would be a cycle. Currently no service imports handler. Keep it that way.

### Risk 3: Storage implementations importing service layer

`storage/dynamodb` and `storage/memory` already correctly import only `internal/storage` (the interface package) and `internal/version`. They must never import `internal/service` or `internal/handler`.

---

## Tooling

These commands can be re-run at any time to verify the current state:

```bash
# Check intra-repo cycles (Go detects these at build time anyway)
go list -f '{{.ImportPath}}: {{join .Imports " "}}' ./internal/...

# Visualise with goda
go install github.com/loov/goda@latest
goda graph ./internal/... | dot -Tpng -o pkg-deps.png

# Check inter-repo module deps
go mod graph | grep nousproj

# Proto cycles
buf lint
```

---

## Summary

| Level | Status | Method | Last Checked |
|-------|--------|--------|-------------|
| Inter-repo Go module cycles | ✅ None | `go mod graph` | Phase 1 complete |
| Intra-repo package cycles — api-server | ✅ None | `go list` (9 packages) | Phase 1 complete |
| Intra-repo package cycles — controller-manager | ✅ None | `go list` (7 packages) | Phase 1 complete |
| Proto cycles | ✅ None | `buf lint` | Phase 1 complete |

**Note on runtime cycles**: gRPC call cycles between running services (e.g. api-server calls controller-manager calls api-server) are architectural concerns enforced by convention and code review, not detectable by static analysis. The current design has no such patterns: the controller-manager is a pure consumer of the api-server's API, not a provider.
