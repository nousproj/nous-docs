# CLAUDE.md — Nous Implementation Prompt

> **Role**: You are acting as Principal Software Engineer, Solution Architect, and Software Architect for the Nous project.
> **Context**: You are working in a multi-repository worktree setup. Each repository is a separate Git worktree under the `nousproj` GitHub organization.
> **Phase**: Phase 1 — Foundation (the first implementable milestone)

---

## Project Identity

**Nous** (Greek: "mind", "intellect") is an open-source AI agent orchestration system — "the control plane for AI agents." It applies proven Kubernetes infrastructure patterns (declarative resources, reconciliation loops, self-healing) to AI agent management while introducing agent-specific primitives like cognitive state management and multi-objective scheduling.

**Critical Design Insight**: Container orchestration patterns don't map 1:1 to cognitive workloads. Agents are probabilistic (not deterministic), have complex cognitive state (not externalized state), require semantic health evaluation (not binary checks), and need multi-objective resource scheduling (not simple bin packing).

**Architecture Decision**: Standalone control plane (NOT a Kubernetes operator). Runtime-agnostic — manages agents across ECS, Lambda, VMs, edge devices. Not locked into Kubernetes.

---

## Repository Layout

All repositories live under the `nousproj` GitHub organization. You are working in a worktree setup where each repo is checked out as a sibling directory:

```
nousproj/
├── nous-proto/                 # Protobuf contracts (the source of truth)
├── nous-api-server/            # API Server — CRD validation, watch streams, admission control
├── nous-controller-manager/    # Controllers — AgentController, TaskController, HealthController, RecoveryController
├── nous-scheduler/             # Multi-objective scheduler (cost/quality/latency)
├── nous-node-supervisor/       # Node-level agent lifecycle management
├── nous-agent-runtime/         # Agent runtime SDK/sidecar
├── nous-infra/                 # Pulumi IaC (TypeScript) — AWS deployment
└── internal-docs/              # Architecture docs, ADRs, design decisions
```

### Dependency Graph (DAG — no cycles allowed)

```
nous-proto (leaf node — no outbound deps)
    ↑
    ├── nous-api-server
    ├── nous-scheduler
    ├── nous-controller-manager
    ├── nous-node-supervisor
    └── nous-agent-runtime

nous-api-server → nous-scheduler (control signal)
nous-scheduler → nous-node-supervisor (scheduling decisions)
nous-node-supervisor → nous-agent-runtime (runtime management)

nous-controller-manager → nous-api-server (watch resources)
nous-controller-manager → nous-node-supervisor (health checks)
nous-agent-runtime → nous-controller-manager (status reports — via gRPC/NATS, NOT module dep)

nous-infra → (all services) (deployment only)
internal-docs → (all) (documentation only)
```

**CRITICAL**: Runtime communication (gRPC, NATS messages) between services is NOT a Go module dependency. All services communicate via proto-defined contracts. Services generate proto stubs locally — they do NOT import each other as Go module dependencies.

---

## Technology Stack

| Component | Technology | Go Module Path |
|-----------|-----------|---------------|
| Language | Go 1.22+ | `github.com/nousproj/<repo>` |
| Proto | Protobuf v3 + Buf | `github.com/nousproj/nous-proto` |
| State Store | DynamoDB (pluggable via interface) | — |
| Blob Store | S3 (pluggable via interface) | — |
| Messaging | NATS JetStream | — |
| Infrastructure | Pulumi (TypeScript) | — |
| Observability | Prometheus + OpenTelemetry | — |
| CI/CD | GitHub Actions | — |

---

## Repository Standards

### Directory Structure (every Go service repo)

```
<repo>/
├── cmd/
│   └── <binary>/
│       └── main.go              # Entrypoint — wires dependencies, starts server
├── internal/                     # Private packages (NOT importable by other repos)
│   ├── server/                   # gRPC/HTTP server setup
│   ├── handler/                  # Request handlers (thin — delegates to service layer)
│   ├── service/                  # Business logic (core domain)
│   ├── repository/               # Data access (StateStore, BlobStore implementations)
│   └── config/                   # Configuration loading (env vars, YAML, flags)
├── proto/                        # Generated proto stubs (local to this repo)
│   └── gen/
│       └── nous/
│           └── v1alpha1/
├── api/                          # Public Go types if any (avoid — prefer proto)
├── scripts/                      # Build/dev scripts
├── Dockerfile
├── Makefile
├── go.mod
├── go.sum
├── buf.gen.yaml                  # Buf code generation config
├── CLAUDE.md                     # Per-repo Claude Code instructions
└── README.md
```

### Layered Architecture (strict — no upward imports)

```
main.go → server → handler → service → repository
                                    ↓
                              (interfaces only — no concrete deps)
```

Each layer only imports from layers below. No circular package dependencies. Use interfaces at boundaries. Dependency injection in `main.go`.

### Code Conventions

- **Go**: Follow standard Go conventions. `gofmt`, `golint`, `go vet` clean.
- **Error handling**: Wrap errors with context using `fmt.Errorf("doing X: %w", err)`. Never swallow errors.
- **Logging**: Structured logging with `slog` (Go 1.21+ stdlib). No `fmt.Println` in production code.
- **Context**: Pass `context.Context` as first parameter everywhere. Respect cancellation.
- **Testing**: Table-driven tests. Interfaces for all external dependencies (mockable). `_test.go` files alongside source.
- **Proto**: All inter-service types defined in `nous-proto`. Services generate stubs locally via `buf generate`.

---

## Phase 1 Implementation Plan — Foundation

### Goal
Stand up the skeleton of the Nous control plane with real, working components that demonstrate the core reconciliation loop pattern.

### What "Done" Looks Like
1. `nous-proto` has complete v1alpha1 CRD schemas (AgentDefinition, AgentTask, AgentInstance)
2. `nous-api-server` can CRUD AgentDefinitions and AgentTasks via gRPC, stores in DynamoDB
3. `nous-controller-manager` runs a basic AgentController reconciliation loop that watches for AgentDefinition changes and creates/updates AgentInstance records
4. `nous-infra` has Pulumi stacks for DynamoDB tables, S3 bucket, and ECS service definitions
5. All services build, have basic tests, and can be run locally with `docker-compose`

---

### Repository: nous-proto

**Priority**: Implement FIRST — everything else depends on this.

#### Proto Definitions to Create

**File: `nous/v1alpha1/types.proto`**

Define the core resource types. Model these after Kubernetes resource conventions (TypeMeta, ObjectMeta, Spec, Status pattern):

```protobuf
syntax = "proto3";
package nous.v1alpha1;

option go_package = "github.com/nousproj/nous-proto/gen/nous/v1alpha1;v1alpha1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/struct.proto";
import "google/protobuf/duration.proto";

// --- Metadata (K8s-style) ---

message ObjectMeta {
  string name = 1;
  string namespace = 2;
  string uid = 3;
  string resource_version = 4;
  int64 generation = 5;
  google.protobuf.Timestamp creation_timestamp = 6;
  google.protobuf.Timestamp deletion_timestamp = 7;
  map<string, string> labels = 8;
  map<string, string> annotations = 9;
  repeated OwnerReference owner_references = 10;
}

message OwnerReference {
  string api_version = 1;
  string kind = 2;
  string name = 3;
  string uid = 4;
  bool controller = 5;
}

// --- AgentDefinition ---
// Analogous to a Deployment — declares the desired state of an agent type.

message AgentDefinition {
  ObjectMeta metadata = 1;
  AgentDefinitionSpec spec = 2;
  AgentDefinitionStatus status = 3;
}

message AgentDefinitionSpec {
  // Model configuration
  ModelConfig model = 1;

  // Tools this agent can use
  repeated ToolReference tools = 2;

  // Resource constraints
  ResourceRequirements resources = 3;

  // Scaling configuration
  ScalingPolicy scaling = 4;

  // Health check configuration
  HealthCheckPolicy health_check = 5;

  // Checkpointing strategy
  CheckpointPolicy checkpoint = 6;

  // System prompt / behavioral instructions
  string system_prompt = 7;

  // Memory configuration (episodic, semantic, etc.)
  MemoryConfig memory = 8;
}

message ModelConfig {
  string provider = 1;       // "anthropic", "openai", "google"
  string model = 2;          // "claude-sonnet-4-20250514", "gpt-4o"
  double temperature = 3;
  int32 max_tokens = 4;
  map<string, string> parameters = 5;  // Provider-specific params
}

message ToolReference {
  string name = 1;
  string version = 2;
  google.protobuf.Struct config = 3;
}

message ResourceRequirements {
  ResourceLimits limits = 1;
  ResourceLimits requests = 2;
}

message ResourceLimits {
  int64 max_tokens_per_minute = 1;
  double max_cost_per_hour = 2;      // USD
  int64 max_concurrent_tasks = 3;
  google.protobuf.Duration max_task_duration = 4;
}

message ScalingPolicy {
  int32 min_instances = 1;
  int32 max_instances = 2;
  int32 desired_instances = 3;
  string scaling_strategy = 4;  // "manual", "queue-depth", "quality-threshold"
}

message HealthCheckPolicy {
  google.protobuf.Duration period = 1;
  int32 failure_threshold = 2;
  int32 success_threshold = 3;
  double quality_floor = 4;           // Minimum quality score (0.0-1.0)
  double cost_ceiling_per_task = 5;   // Max USD per task before flagging
}

message CheckpointPolicy {
  string strategy = 1;        // "periodic", "decision-point", "quality-threshold"
  google.protobuf.Duration interval = 2;  // For periodic strategy
  int32 max_checkpoints = 3;  // Retention count
}

message MemoryConfig {
  bool episodic = 1;
  bool semantic = 2;
  int64 max_history_tokens = 3;
  string summarization_strategy = 4;  // "none", "rolling", "hierarchical"
}

message AgentDefinitionStatus {
  int32 ready_instances = 1;
  int32 desired_instances = 2;
  int32 unavailable_instances = 3;
  repeated AgentCondition conditions = 4;
  google.protobuf.Timestamp last_reconciled = 5;
  int64 observed_generation = 6;
}

message AgentCondition {
  string type = 1;      // "Available", "Progressing", "Degraded"
  string status = 2;    // "True", "False", "Unknown"
  string reason = 3;
  string message = 4;
  google.protobuf.Timestamp last_transition_time = 5;
}

// --- AgentTask ---
// Analogous to a Job — a unit of work assigned to an agent.

message AgentTask {
  ObjectMeta metadata = 1;
  AgentTaskSpec spec = 2;
  AgentTaskStatus status = 3;
}

message AgentTaskSpec {
  string agent_definition = 1;  // Reference to AgentDefinition name
  string input = 2;              // Task input (prompt/instruction)
  google.protobuf.Struct input_data = 3;  // Structured input data
  google.protobuf.Duration timeout = 4;
  double max_cost = 5;           // Budget in USD
  int32 max_retries = 6;
  string priority = 7;           // "low", "medium", "high", "critical"
  map<string, string> parameters = 8;
}

message AgentTaskStatus {
  string phase = 1;  // "Pending", "Scheduled", "Running", "Succeeded", "Failed"
  string assigned_instance = 2;
  google.protobuf.Timestamp start_time = 3;
  google.protobuf.Timestamp completion_time = 4;
  string output = 5;
  google.protobuf.Struct output_data = 6;
  TaskMetrics metrics = 7;
  repeated AgentCondition conditions = 8;
  int32 retries = 9;
  string failure_reason = 10;
}

message TaskMetrics {
  int64 input_tokens = 1;
  int64 output_tokens = 2;
  int64 total_tokens = 3;
  double cost = 4;                // USD
  double quality_score = 5;       // 0.0-1.0
  google.protobuf.Duration latency = 6;
  int32 tool_calls = 7;
  int32 llm_calls = 8;
}

// --- AgentInstance ---
// Analogous to a Pod — a running instance of an agent.

message AgentInstance {
  ObjectMeta metadata = 1;
  AgentInstanceSpec spec = 2;
  AgentInstanceStatus status = 3;
}

message AgentInstanceSpec {
  string agent_definition = 1;  // Owner reference
  string runtime_id = 2;        // ECS task ID, Lambda invocation, etc.
  string node = 3;              // Node supervisor managing this instance
}

message AgentInstanceStatus {
  string phase = 1;  // "Pending", "Starting", "Ready", "Running", "Terminating", "Failed"
  google.protobuf.Timestamp last_heartbeat = 2;
  CognitiveState cognitive_state = 3;
  InstanceMetrics metrics = 4;
  repeated AgentCondition conditions = 5;
}

message CognitiveState {
  string last_checkpoint_id = 1;
  google.protobuf.Timestamp last_checkpoint_time = 2;
  int64 reasoning_depth = 3;
  double context_utilization = 4;  // 0.0-1.0 (how full is the context window)
  int32 active_tasks = 5;
}

message InstanceMetrics {
  int64 tasks_completed = 1;
  int64 tasks_failed = 2;
  double avg_quality_score = 3;
  double total_cost = 4;
  int64 total_tokens = 5;
  google.protobuf.Duration uptime = 6;
}
```

**File: `nous/v1alpha1/api.proto`**

Define the gRPC service API:

```protobuf
syntax = "proto3";
package nous.v1alpha1;

option go_package = "github.com/nousproj/nous-proto/gen/nous/v1alpha1;v1alpha1";

import "nous/v1alpha1/types.proto";

// NousAPI is the primary control plane API.
service NousAPI {
  // AgentDefinition CRUD
  rpc CreateAgentDefinition(CreateAgentDefinitionRequest) returns (AgentDefinition);
  rpc GetAgentDefinition(GetAgentDefinitionRequest) returns (AgentDefinition);
  rpc ListAgentDefinitions(ListAgentDefinitionsRequest) returns (ListAgentDefinitionsResponse);
  rpc UpdateAgentDefinition(UpdateAgentDefinitionRequest) returns (AgentDefinition);
  rpc DeleteAgentDefinition(DeleteAgentDefinitionRequest) returns (DeleteAgentDefinitionResponse);

  // AgentTask CRUD
  rpc CreateAgentTask(CreateAgentTaskRequest) returns (AgentTask);
  rpc GetAgentTask(GetAgentTaskRequest) returns (AgentTask);
  rpc ListAgentTasks(ListAgentTasksRequest) returns (ListAgentTasksResponse);
  rpc CancelAgentTask(CancelAgentTaskRequest) returns (AgentTask);

  // Watch streams (Server-Sent Events for reconciliation)
  rpc WatchAgentDefinitions(WatchRequest) returns (stream WatchEvent);
  rpc WatchAgentTasks(WatchRequest) returns (stream WatchEvent);
  rpc WatchAgentInstances(WatchRequest) returns (stream WatchEvent);

  // AgentInstance (managed by controllers, not directly by users)
  rpc GetAgentInstance(GetAgentInstanceRequest) returns (AgentInstance);
  rpc ListAgentInstances(ListAgentInstancesRequest) returns (ListAgentInstancesResponse);
  rpc UpdateAgentInstanceStatus(UpdateAgentInstanceStatusRequest) returns (AgentInstance);
}

// --- Request/Response messages ---

message CreateAgentDefinitionRequest {
  AgentDefinition agent_definition = 1;
}

message GetAgentDefinitionRequest {
  string namespace = 1;
  string name = 2;
}

message ListAgentDefinitionsRequest {
  string namespace = 1;
  map<string, string> label_selector = 2;
  int32 limit = 3;
  string continue_token = 4;
}

message ListAgentDefinitionsResponse {
  repeated AgentDefinition items = 1;
  string continue_token = 2;
}

message UpdateAgentDefinitionRequest {
  AgentDefinition agent_definition = 1;
}

message DeleteAgentDefinitionRequest {
  string namespace = 1;
  string name = 2;
}

message DeleteAgentDefinitionResponse {}

message CreateAgentTaskRequest {
  AgentTask agent_task = 1;
}

message GetAgentTaskRequest {
  string namespace = 1;
  string name = 2;
}

message ListAgentTasksRequest {
  string namespace = 1;
  string agent_definition = 2;  // Optional: filter by agent def
  string phase = 3;              // Optional: filter by phase
  map<string, string> label_selector = 4;
  int32 limit = 5;
  string continue_token = 6;
}

message ListAgentTasksResponse {
  repeated AgentTask items = 1;
  string continue_token = 2;
}

message CancelAgentTaskRequest {
  string namespace = 1;
  string name = 2;
}

message GetAgentInstanceRequest {
  string namespace = 1;
  string name = 2;
}

message ListAgentInstancesRequest {
  string namespace = 1;
  string agent_definition = 2;
  string phase = 3;
  int32 limit = 4;
  string continue_token = 5;
}

message ListAgentInstancesResponse {
  repeated AgentInstance items = 1;
  string continue_token = 2;
}

message UpdateAgentInstanceStatusRequest {
  string namespace = 1;
  string name = 2;
  AgentInstanceStatus status = 3;
}

// --- Watch ---

message WatchRequest {
  string namespace = 1;
  string resource_version = 2;  // Resume from this version
  map<string, string> label_selector = 3;
}

message WatchEvent {
  string type = 1;  // "ADDED", "MODIFIED", "DELETED"
  oneof object {
    AgentDefinition agent_definition = 2;
    AgentTask agent_task = 3;
    AgentInstance agent_instance = 4;
  }
}
```

**File: `buf.yaml`**

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

**File: `buf.gen.yaml`**

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

#### Acceptance Criteria
- [ ] `buf lint` passes with zero warnings
- [ ] `buf generate` produces Go stubs in `gen/nous/v1alpha1/`
- [ ] `buf breaking --against '.git#branch=main'` works (baseline established)
- [ ] All types have comprehensive proto comments
- [ ] Go module initialised: `go mod init github.com/nousproj/nous-proto`

**IMPORTANT — Proto Package Versioning**: The existing proto in the repo uses `nous.v1`. This implementation plan specifies `nous.v1alpha1` to signal pre-stability (following K8s API versioning conventions). **Update the existing proto package from `nous.v1` to `nous.v1alpha1`** before proceeding.

**Local Development — go.mod replace directives**: During development, each service repo should use `replace` directives in `go.mod` to point to the local nous-proto worktree:

```
// In nous-api-server/go.mod
require github.com/nousproj/nous-proto v0.0.0

replace github.com/nousproj/nous-proto => ../nous-proto
```

Remove `replace` directives before publishing/releasing. Alternatively, use `go work init` with a `go.work` file at the parent directory level during development (add `go.work` to `.gitignore` in each repo).

---

### Repository: nous-api-server

**Priority**: Implement SECOND — after proto stubs are generated.

#### What to Build

1. **gRPC server** implementing `NousAPI` service from proto
2. **StateStore interface** — the core storage abstraction
3. **DynamoDB implementation** of StateStore
4. **Watch mechanism** — in-memory fan-out for Phase 1 (see Watch Strategy below)
5. **Admission/validation** logic for resource specs
6. **Health endpoints** (`/healthz`, `/readyz`)
7. **Prometheus metrics** endpoint (`/metrics`)

#### Watch Strategy (Phase 1 vs Phase 2)

**Phase 1: In-memory fan-out only.** The API server maintains an in-memory event bus. When the StateStore completes a write, the handler publishes the event to all active Watch subscribers. This is sufficient for a single-instance API server in local dev and early testing.

```go
// internal/watch/broadcaster.go
// Thread-safe fan-out. Subscribers get a channel. On write, all channels receive the event.
// On subscriber disconnect, remove from registry.
// Buffer size per subscriber: 100 events. If full, drop oldest (log warning).
```

**Phase 2: DynamoDB Streams → Lambda → NATS.** For production multi-instance API servers, DynamoDB Streams will feed a Lambda that publishes to NATS JetStream. API server Watch endpoints will subscribe to NATS subjects instead of in-memory channels. This decouples Watch from any single API server instance.

**Resource version resumption**: Clients pass `resource_version` in `WatchRequest`. The in-memory broadcaster replays buffered events newer than that version. For Phase 2, NATS JetStream provides durable replay.

**Limitation**: The in-memory broadcaster is NOT durable. If the API server restarts, all Watch connections are dropped and clients must reconnect. Upon reconnect, clients should:
1. Do a fresh `List` to get current state
2. Start a new `Watch` from the latest `resource_version` returned by the List
3. Reconcile any missed events by comparing List results to local cache

This is the same pattern Kubernetes clients use (`ListWatch` in client-go). Build the controller's informer/cache layer to handle this from day one.

#### Core Interfaces

```go
// internal/storage/interface.go
package storage

import (
	"context"
	"time"

	v1alpha1 "github.com/nousproj/nous-proto/gen/nous/v1alpha1"
)

// StateStore is the primary storage abstraction for Nous resources.
// Implementations: DynamoDB, PostgreSQL, in-memory (testing).
type StateStore interface {
	// AgentDefinition operations
	CreateAgentDefinition(ctx context.Context, def *v1alpha1.AgentDefinition) (*v1alpha1.AgentDefinition, error)
	GetAgentDefinition(ctx context.Context, namespace, name string) (*v1alpha1.AgentDefinition, error)
	ListAgentDefinitions(ctx context.Context, namespace string, opts ListOptions) (*ListResult[*v1alpha1.AgentDefinition], error)
	UpdateAgentDefinition(ctx context.Context, def *v1alpha1.AgentDefinition) (*v1alpha1.AgentDefinition, error)
	DeleteAgentDefinition(ctx context.Context, namespace, name string) error

	// AgentTask operations
	CreateAgentTask(ctx context.Context, task *v1alpha1.AgentTask) (*v1alpha1.AgentTask, error)
	GetAgentTask(ctx context.Context, namespace, name string) (*v1alpha1.AgentTask, error)
	ListAgentTasks(ctx context.Context, namespace string, opts ListOptions) (*ListResult[*v1alpha1.AgentTask], error)
	UpdateAgentTask(ctx context.Context, task *v1alpha1.AgentTask) (*v1alpha1.AgentTask, error)
	DeleteAgentTask(ctx context.Context, namespace, name string) error

	// AgentInstance operations
	CreateAgentInstance(ctx context.Context, inst *v1alpha1.AgentInstance) (*v1alpha1.AgentInstance, error)
	GetAgentInstance(ctx context.Context, namespace, name string) (*v1alpha1.AgentInstance, error)
	ListAgentInstances(ctx context.Context, namespace string, opts ListOptions) (*ListResult[*v1alpha1.AgentInstance], error)
	UpdateAgentInstanceStatus(ctx context.Context, namespace, name string, status *v1alpha1.AgentInstanceStatus) (*v1alpha1.AgentInstance, error)
	DeleteAgentInstance(ctx context.Context, namespace, name string) error

	// Watch support
	Watch(ctx context.Context, resourceType string, namespace string, fromVersion string) (<-chan WatchEvent, error)
}

type ListOptions struct {
	LabelSelector map[string]string
	Limit         int32
	ContinueToken string
	FieldSelector map[string]string  // e.g., {"spec.agentDefinition": "researcher"}
}

type ListResult[T any] struct {
	Items         []T
	ContinueToken string
}

type WatchEvent struct {
	Type   string  // "ADDED", "MODIFIED", "DELETED"
	Object any     // The actual resource
}
```

#### DynamoDB Table Design

Single-table design with composite keys:

```
PK (partition key)     | SK (sort key)                    | Type              | Data
-----------------------|----------------------------------|-------------------|-----
NS#default             | AGENTDEF#researcher               | AgentDefinition   | {spec, status}
NS#default             | AGENTDEF#analyst                  | AgentDefinition   | {spec, status}
NS#default             | AGENTTASK#task-001                | AgentTask         | {spec, status}
NS#default             | AGENTINST#researcher-abc123       | AgentInstance     | {spec, status}
NS#production          | AGENTDEF#translator               | AgentDefinition   | {spec, status}
```

GSI1 (for listing by type within namespace):
```
GSI1PK                 | GSI1SK
-----------------------|----------------------------------
NS#default#AGENTDEF    | <creation_timestamp>#<name>
NS#default#AGENTTASK   | <creation_timestamp>#<name>
```

GSI2 (for tasks by agent definition):
```
GSI2PK                 | GSI2SK
-----------------------|----------------------------------
NS#default#AGENTDEF#researcher | TASK#<phase>#<creation_timestamp>
```

#### Resource Versioning & Optimistic Concurrency

`resource_version` is the backbone of conflict detection. Every write must check it.

**Format**: ULIDs (Universally Unique Lexicographically Sortable Identifiers). ULIDs are preferred over UUIDs because they sort chronologically, which is useful for DynamoDB range key ordering and Watch resume tokens. Use `github.com/oklog/ulid/v2`.

**Where generated**: The StateStore implementation generates a new `resource_version` on every successful Create or Update. The API server never accepts a client-supplied version — it reads the current version, passes it through, and the StateStore enforces the check.

**DynamoDB conditional write pattern**:
```go
// Create: fail if item already exists
expr := expression.Name("PK").AttributeNotExists()

// Update: fail if resource_version doesn't match (optimistic lock)
expr := expression.Name("ResourceVersion").Equal(expression.Value(expectedVersion))

// On ConditionCheckFailure → return storage.ErrConflict
// Caller (handler) returns gRPC codes.Aborted → client retries with fresh read
```

**Watch resume**: `resource_version` doubles as a Watch cursor. Since ULIDs are time-ordered, the Watch API can resume from a given version by filtering events with `version > fromVersion`.

#### Configuration

**Config precedence** (highest wins): CLI flags → environment variables → config file → defaults.

Use `github.com/spf13/viper` for unified config loading. Environment variable naming convention: `NOUS_<SECTION>_<KEY>` (e.g., `NOUS_STORAGE_DRIVER=dynamodb`, `NOUS_SERVER_GRPC_PORT=50051`). Viper handles this mapping automatically with `viper.SetEnvPrefix("NOUS")` and `viper.AutomaticEnv()`.

```yaml
# config.yaml
server:
  grpc_port: 50051
  http_port: 8080
  metrics_port: 9090

storage:
  driver: dynamodb  # or "memory" for local dev/testing
  dynamodb:
    table_name: nous-state
    region: us-west-2
    endpoint: ""  # Override for DynamoDB Local

log:
  level: info
  format: json
```

**Config validation — fail fast on startup**:
```go
func validateConfig(cfg *Config) error {
if cfg.Server.GRPCPort == cfg.Server.HTTPPort {
return fmt.Errorf("grpc_port and http_port must be different")
}
if cfg.Storage.Driver == "dynamodb" && cfg.Storage.DynamoDB.TableName == "" {
return fmt.Errorf("dynamodb driver requires table_name")
}
if cfg.Server.GRPCPort == 0 {
return fmt.Errorf("grpc_port is required")
}
return nil
}
```
Call `validateConfig` in `main.go` before any server initialization. Log the loaded config (redacting secrets) at startup for debuggability.

#### Acceptance Criteria
- [ ] gRPC server starts and serves all `NousAPI` methods
- [ ] In-memory StateStore implementation for testing (no AWS dependency)
- [ ] DynamoDB StateStore implementation with single-table design
- [ ] Resource validation (name format, required fields, spec constraints)
- [ ] Optimistic concurrency via `resource_version` (DynamoDB conditional writes)
- [ ] Watch streams work via server-streaming gRPC
- [ ] `/healthz`, `/readyz`, `/metrics` endpoints
- [ ] `docker-compose.yml` with DynamoDB Local for local development
- [ ] Unit tests for handler, service, and repository layers
- [ ] Integration test against DynamoDB Local
- [ ] Makefile targets: `build`, `test`, `lint`, `proto-gen`, `docker-build`, `run-local`

---

### Repository: nous-controller-manager

**Priority**: Implement THIRD — after api-server is running.

#### What to Build

1. **AgentController** — watches AgentDefinitions, reconciles desired vs actual AgentInstances
2. **Reconciliation loop** — the core control loop with exponential backoff, work queue
3. **Leader election** — using DynamoDB lease (only one controller-manager active at a time)
4. **Event recording** — emit events for state changes

#### Core Controller Pattern

```go
// internal/controller/interface.go
package controller

import "context"

// Controller defines the reconciliation contract.
type Controller interface {
	// Name returns the controller name (for logging/metrics).
	Name() string

	// Reconcile is called for each resource that needs attention.
	// Returns a Result indicating when to re-check.
	Reconcile(ctx context.Context, key string) (Result, error)
}

type Result struct {
	Requeue      bool
	RequeueAfter time.Duration
}
```

```go
// internal/controller/agent_controller.go
//
// AgentController watches AgentDefinition resources and ensures
// the correct number of AgentInstances exist and are healthy.
//
// Reconciliation logic:
// 1. Fetch the AgentDefinition (desired state)
// 2. List AgentInstances owned by this definition (actual state)
// 3. Compare desired.spec.scaling.desired_instances vs len(actual)
// 4. Scale up: create new AgentInstance records (node-supervisor will launch them)
// 5. Scale down: mark excess instances for termination (graceful)
// 6. Update status: set ready/desired/unavailable counts and conditions
// 7. Requeue after health check period
```

```go
// internal/workqueue/queue.go
//
// Rate-limited work queue (modeled after client-go/util/workqueue).
// Features:
// - Deduplication: same key won't be processed concurrently
// - Rate limiting: exponential backoff on failures
// - Graceful shutdown: drain in-flight work
```

#### Leader Election via DynamoDB

```go
// internal/leaderelection/dynamodb.go
//
// Distributed leader election using DynamoDB conditional writes.
// Pattern:
// 1. Try to acquire lease: PutItem with ConditionExpression (not exists OR expired)
// 2. Renew lease periodically (UpdateItem with condition: holder == me)
// 3. On shutdown: release lease
// 4. TTL-based expiry: if holder crashes, lease expires after 15s
```

**CRITICAL — Fencing against split-brain**: A network partition can leave two controllers both believing they hold the lease for up to the TTL window (15s). To prevent stale-leader writes:

1. **Check lease before every write operation.** The controller must verify it still holds the lease before issuing any StateStore mutation. If the lease has expired or been taken by another holder, immediately stop processing and yield.
2. **Use a fencing token.** Each lease acquisition increments a monotonic counter stored on the lease record. All write operations include this counter. The StateStore can reject writes with a stale fencing token.
3. **Reconcile loop cancellation.** The leader election goroutine maintains a `context.Context` that is canceled the moment the lease is lost. All reconciliation work is done under this context — cancellation propagates immediately.

```go
// Pseudocode for fenced writes
func (c *AgentController) Reconcile(ctx context.Context, key string) (Result, error) {
// ctx is derived from the leader election context — already canceled if lease lost
if err := ctx.Err(); err != nil {
return Result{}, fmt.Errorf("lease lost, aborting reconciliation: %w", err)
}
// ... reconciliation logic ...
}
```

**Fencing at the StateStore level**: To make fencing automatic (not manual per-call), the StateStore interface supports wrapping with a fencing token:

```go
// internal/storage/interface.go (addition)
type StateStore interface {
// ... existing methods ...

// WithFenceToken returns a StateStore decorator that includes the fencing
// token in all write operations. If the token is stale, writes return ErrStaleFence.
WithFenceToken(token int64) StateStore
}

// Usage in controller — all writes are automatically fenced:
func (c *AgentController) Reconcile(ctx context.Context, key string) (Result, error) {
fencedStore := c.store.WithFenceToken(c.leaderElection.CurrentFenceToken())
return c.reconcile(ctx, key, fencedStore)
}
```

**DynamoDB lease record schema**:
```
PK: LEASE#controller-manager
SK: SINGLETON
Attributes:
  HolderID:    "controller-abc123"
  LeaseExpiry: 2026-02-15T14:45:00Z
  FenceToken:  42  ← Monotonic counter, incremented on each acquisition
```

#### Acceptance Criteria
- [ ] AgentController watches AgentDefinitions via gRPC Watch stream from api-server
- [ ] Reconciliation creates/deletes AgentInstance records to match desired count
- [ ] Status updates reflect ready/desired/unavailable instance counts
- [ ] Leader election ensures single-active controller-manager
- [ ] Rate-limited work queue with exponential backoff on failures
- [ ] Prometheus metrics: reconciliation duration, queue depth, errors
- [ ] Structured logging with controller name, resource key, reconciliation outcome
- [ ] Unit tests with mock StateStore
- [ ] Integration test: create AgentDefinition → verify AgentInstances created

---

### Repository: nous-infra

**Priority**: Implement FOURTH (last) — after all services are building and running locally. The Pulumi stacks should codify what you've validated in docker-compose, not guess ahead of implementation.

#### What to Build

Pulumi TypeScript stacks for AWS infrastructure:

```typescript
// stacks/
// ├── shared/          # VPC, networking
// ├── state-store/     # DynamoDB tables, S3 bucket
// ├── messaging/       # NATS JetStream (ECS or EC2)
// └── control-plane/   # ECS services for api-server, controller-manager, scheduler
```

#### DynamoDB Table (Pulumi)

```typescript
const stateTable = new aws.dynamodb.Table("nous-state", {
    name: "nous-state",
    billingMode: "PAY_PER_REQUEST",
    hashKey: "PK",
    rangeKey: "SK",
    attributes: [
        { name: "PK", type: "S" },
        { name: "SK", type: "S" },
        { name: "GSI1PK", type: "S" },
        { name: "GSI1SK", type: "S" },
        { name: "GSI2PK", type: "S" },
        { name: "GSI2SK", type: "S" },
    ],
    globalSecondaryIndexes: [
        {
            name: "GSI1",
            hashKey: "GSI1PK",
            rangeKey: "GSI1SK",
            projectionType: "ALL",
        },
        {
            name: "GSI2",
            hashKey: "GSI2PK",
            rangeKey: "GSI2SK",
            projectionType: "ALL",
        },
    ],
    streamEnabled: true,
    streamViewType: "NEW_AND_OLD_IMAGES",  // For watch/change data capture
    ttl: { attributeName: "TTL", enabled: true },
    pointInTimeRecovery: { enabled: true },
    tags: { project: "nous", component: "state-store" },
});
```

#### Acceptance Criteria
- [ ] DynamoDB table with GSIs created via Pulumi
- [ ] S3 bucket for cognitive state blobs (versioning enabled)
- [ ] ECS cluster and task definitions for control plane services
- [ ] IAM roles with least-privilege policies
- [ ] Pulumi stack outputs for service discovery (table name, bucket name, endpoints)
- [ ] Local development with `docker-compose.yml` (DynamoDB Local, LocalStack S3)

---

### Repository: nous-scheduler & nous-node-supervisor & nous-agent-runtime

**Phase 1 Scope**: Minimal scaffolding only. These become the focus in Phase 2.

For Phase 1, each should have:
- [ ] `cmd/<binary>/main.go` with health check endpoint
- [ ] `internal/config/` with configuration loading
- [ ] `Dockerfile`
- [ ] `Makefile`
- [ ] Basic README
- [ ] CLAUDE.md with Phase 2 implementation notes

---

## Cross-Cutting Concerns

### Observability (implement in every service)

```go
// Prometheus metrics to register in every service
var (
    requestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "nous_grpc_request_duration_seconds",
        Help:    "gRPC request duration",
        Buckets: prometheus.DefBuckets,
    }, []string{"service", "method", "status"})

    activeRequests = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "nous_grpc_active_requests",
        Help: "Number of active gRPC requests",
    }, []string{"service", "method"})
)

// Agent-specific metrics (controller-manager)
var (
    reconciliationDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
        Name:    "nous_reconciliation_duration_seconds",
        Help:    "Time spent in reconciliation loop",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
    }, []string{"controller"})

    agentInstances = promauto.NewGaugeVec(prometheus.GaugeOpts{
        Name: "nous_agent_instances_total",
        Help: "Total agent instances by definition and phase",
    }, []string{"definition", "namespace", "phase"})
)
```

### Docker Compose (local development)

```yaml
# docker-compose.yml (root of worktree)
version: "3.8"
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    ports: ["8000:8000"]
    command: "-jar DynamoDBLocal.jar -sharedDb"

  nous-api-server:
    build: ./nous-api-server
    ports: ["50051:50051", "8080:8080", "9090:9090"]
    environment:
      NOUS_STORAGE_DRIVER: dynamodb
      NOUS_STORAGE_DYNAMODB_TABLE: nous-state
      NOUS_STORAGE_DYNAMODB_ENDPOINT: http://dynamodb-local:8000
      NOUS_STORAGE_DYNAMODB_REGION: us-west-2
      AWS_ACCESS_KEY_ID: dummy
      AWS_SECRET_ACCESS_KEY: dummy
    depends_on: [dynamodb-local]

  nous-controller-manager:
    build: ./nous-controller-manager
    environment:
      NOUS_API_SERVER_ADDR: nous-api-server:50051
      NOUS_LEADER_ELECTION_ENABLED: "true"
      NOUS_STORAGE_DYNAMODB_ENDPOINT: http://dynamodb-local:8000
    depends_on: [nous-api-server]

  table-init:
    image: amazon/aws-cli
    depends_on: [dynamodb-local]
    entrypoint: >
      sh -c "
        aws dynamodb create-table
          --endpoint-url http://dynamodb-local:8000
          --table-name nous-state
          --attribute-definitions
            AttributeName=PK,AttributeType=S
            AttributeName=SK,AttributeType=S
            AttributeName=GSI1PK,AttributeType=S
            AttributeName=GSI1SK,AttributeType=S
          --key-schema
            AttributeName=PK,KeyType=HASH
            AttributeName=SK,KeyType=RANGE
          --global-secondary-indexes
            '[{\"IndexName\":\"GSI1\",\"KeySchema\":[{\"AttributeName\":\"GSI1PK\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"GSI1SK\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}]'
          --billing-mode PAY_PER_REQUEST
          --region us-west-2
        || true
      "
    environment:
      AWS_ACCESS_KEY_ID: dummy
      AWS_SECRET_ACCESS_KEY: dummy
      AWS_DEFAULT_REGION: us-west-2
```

---

## Implementation Order

Execute in this sequence:

```
1. nous-proto          → Define + generate proto stubs
2. nous-api-server     → Implement StateStore + gRPC server
3. nous-controller-mgr → Implement AgentController reconciliation loop
4. docker-compose      → Local dev environment (validate everything works)
5. Scaffold remaining  → nous-scheduler, nous-node-supervisor, nous-agent-runtime
6. nous-infra          → Pulumi stacks for DynamoDB, S3, ECS (codify what's proven locally)
```

**Why infra is last**: The Pulumi stacks should reflect the real IAM policies, port mappings, environment variables, and DynamoDB schema that the running services actually need. Building infra before the services are working leads to drift and rework. Validate in docker-compose first, then codify in Pulumi.

Within each repo, implement bottom-up:
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

---

## Quality Gates

Before considering Phase 1 complete:

- [ ] All repos compile: `go build ./...`
- [ ] All repos lint clean: `golangci-lint run`
- [ ] All repos pass tests: `go test ./... -race`
- [ ] Proto is lint-clean: `buf lint && buf breaking`
- [ ] Docker compose up works: `docker-compose up` → api-server and controller-manager start
- [ ] E2E smoke test: Create AgentDefinition via grpcurl → AgentInstances appear
- [ ] No inter-repo Go module cycles (verify with `go mod graph`)
- [ ] Each repo has a CLAUDE.md with repo-specific context
- [ ] Each repo has a README.md with build/run instructions

---

## Anti-Patterns to Avoid

1. **DO NOT import one service's Go module from another** — use proto-generated stubs only
2. **DO NOT use etcd** — this is a standalone control plane, not Kubernetes
3. **DO NOT use controller-runtime** — that's for K8s operators; we're building our own control loops
4. **DO NOT put business logic in handlers** — handlers are thin; delegate to service layer
5. **DO NOT use global state** — dependency injection via constructors
6. **DO NOT skip the interface** — every external dependency gets an interface (mockable)
7. **DO NOT hardcode AWS** — storage and messaging are behind interfaces; DynamoDB is one implementation
8. **DO NOT create shared utility libraries** across repos in Phase 1 — duplicate small utilities if needed; extract later when patterns stabilize

---

## Notes for Claude Code

- When working in a specific repo worktree, check the local `CLAUDE.md` first for repo-specific instructions
- Run `buf generate` in `nous-proto` before working on any service repo
- Use `go work` at the parent directory level for cross-repo development. Create `nousproj/go.work`:
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
  Add `go.work` and `go.work.sum` to each repo's `.gitignore`. Remove `replace` directives in `go.mod` before committing.
- For DynamoDB local development, always use endpoint override (`http://localhost:8000`)
- Proto changes require regenerating stubs in ALL consumer repos — run `make proto-gen` in each
- When in doubt about a design decision, prefer the simpler option and document the trade-off in an ADR in `internal-docs/`
- If the existing `nous-proto` has `nous.v1` package paths, rename to `nous.v1alpha1` as the first task