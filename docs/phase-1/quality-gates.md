# Phase 1 Quality Gates

Before Phase 1 is considered complete, all of the following must pass.

## Build & Test

- [x] All repos compile: `go build ./...`
- [ ] All repos lint clean: `golangci-lint run`
- [x] All repos pass tests with race detector: `go test ./... -race`
- [x] Proto is lint-clean: `buf lint && buf breaking`
- [x] No inter-repo Go module cycles: `go mod graph` shows only `nous-proto` as shared dep

## Local Environment

- [x] `docker-compose up` starts: dynamodb-local, nous-api-server, nous-controller-manager
- [x] All services reach healthy state within 30s
- [x] DynamoDB Local tables created (`nous-state`, `nous-leases`)
- [x] API server responds: `grpcurl -plaintext localhost:31051 list`
- [x] Metrics endpoints respond: `curl localhost:9090/metrics`

## End-to-End Smoke Test

```bash
# 1. Apply an AgentDefinition
curl -X POST -H "Content-Type: application/yaml" \
  --data-binary @examples/researcher.yaml \
  http://localhost:8080/apis/nousproj.ai/v1alpha1/namespaces/default/agentdefinitions

# 2. Verify it was stored
curl http://localhost:8080/apis/nousproj.ai/v1alpha1/namespaces/default/agentdefinitions/researcher

# 3. Controller should reconcile — check logs
docker logs nous-controller-manager | grep reconcile

# 4. Update and verify optimistic concurrency
# (repeat PUT with stale resource_version → expect 409)

# 5. Delete and verify
curl -X DELETE \
  http://localhost:8080/apis/nousproj.ai/v1alpha1/namespaces/default/agentdefinitions/researcher
```

- [x] Create AgentDefinition returns 201 with resource_version
- [x] Get AgentDefinition returns 200 with full spec
- [x] Controller logs "reconciling" within 1s of create
- [x] Update with stale resource_version returns 409 Conflict
- [x] Delete returns 200, subsequent Get returns 404
- [x] Data persists across API server restart (DynamoDB driver)

## Per-Repository Acceptance Criteria

### nous-proto
- [x] `buf lint` passes zero warnings
- [x] `buf generate` produces Go stubs in `gen/nous/v1alpha1/`
- [x] All types have proto comments

### nous-api-server
- [x] gRPC server implements all `NousAPI` methods
- [x] HTTP/REST endpoints accept YAML `Content-Type: application/yaml`
- [x] DynamoDB StateStore passes integration tests against DynamoDB Local
- [x] `/healthz` returns 200
- [x] `/metrics` returns Prometheus metrics

### nous-controller-manager
- [x] AgentController watches via gRPC stream (test: apply AgentDefinition → see reconcile log)
- [x] Status updates reflected in AgentDefinition (ready/desired/unavailable)
- [x] Leader election prevents two concurrent active controllers
- [x] Work queue deduplicates and applies exponential backoff on errors

### nous-scheduler (scaffolded)
- [x] Binary builds: `go build ./...`
- [x] `internal/config/` with env-based configuration loading
- [x] `/healthz` and `/readyz` on `:8082`, `/metrics` on `:9092`
- [x] `CLAUDE.md` with Phase 2 scheduling algorithm plan
- [x] `Dockerfile` and `Makefile`

### nous-node-supervisor (scaffolded)
- [x] Binary builds: `go build ./...`
- [x] `internal/config/` with env-based configuration loading
- [x] `/healthz` and `/readyz` on `:8083`, `/metrics` on `:9093`
- [x] `CLAUDE.md` with Phase 2 agent lifecycle plan
- [x] `Dockerfile` and `Makefile`

### nous-agent-runtime (scaffolded)
- [x] Binary builds: `go build ./...`
- [x] `internal/config/` with env-based configuration loading
- [x] `/healthz` and `/readyz` on `:8084`, `/metrics` on `:9094`
- [x] `CLAUDE.md` with Phase 2 runtime SDK plan
- [x] `Dockerfile` and `Makefile`

### nous-infra (scaffolded)
- [x] `docker-compose.yml` at root of infra repo starts all services

## Documentation

- [x] Each repo has a `CLAUDE.md` with repo-specific context
- [x] Each repo has a `README.md` with build/run instructions
- [x] This docs site builds: `mkdocs build`
- [ ] Visual architecture HTML diagrams generated and committed
