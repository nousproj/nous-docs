# nous-proto

The contract layer — the single source of truth for all types and gRPC service definitions across the Nous platform.

## Design Principle

`nous-proto` is a **leaf node** in the dependency graph — it has zero outbound dependencies. All other services depend on it; it depends on nothing.

```
nous-proto (leaf — zero deps)
    ↑
    ├── nous-api-server    (implements NousAPI server)
    ├── nous-controller-manager  (uses NousAPI client)
    ├── nous-scheduler     (uses NousAPI client)
    ├── nous-node-supervisor
    └── nous-agent-runtime
```

Services generate Go stubs **locally** via `buf generate`. They do not share a compiled proto binary — they each regenerate from the source `.proto` files.

## Proto Files

### `nous/v1alpha1/types.proto`

Core resource types:

| Message | Kubernetes Analog | Purpose |
|---------|-------------------|---------|
| `AgentDefinition` | Deployment | Desired state of an agent type |
| `AgentTask` | Job | Unit of work for an agent |
| `AgentInstance` | Pod | Running instance of an agent |
| `ObjectMeta` | ObjectMeta | Name, namespace, labels, resource_version |
| `ScalingPolicy` | — | min/max/desired instance counts |
| `ModelConfig` | — | LLM provider, model name, parameters |
| `CognitiveState` | — | Context utilization, checkpoint info |
| `InstanceMetrics` | — | Tasks completed, cost, quality |

### `nous/v1alpha1/api.proto`

gRPC service definition:

```protobuf
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

  // Watch streams (server-side streaming)
  rpc WatchAgentDefinitions(WatchRequest) returns (stream WatchEvent);
  rpc WatchAgentTasks(WatchRequest) returns (stream WatchEvent);
  rpc WatchAgentInstances(WatchRequest) returns (stream WatchEvent);

  // AgentInstance (controller-managed)
  rpc GetAgentInstance(GetAgentInstanceRequest) returns (AgentInstance);
  rpc ListAgentInstances(ListAgentInstancesRequest) returns (ListAgentInstancesResponse);
  rpc UpdateAgentInstanceStatus(UpdateAgentInstanceStatusRequest) returns (AgentInstance);
}
```

## Consuming proto in a service

Each service has a `buf.gen.yaml` that regenerates stubs from `nous-proto`:

```yaml
# buf.gen.yaml (in each service repo)
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen
    opt: paths=source_relative
  - remote: buf.build/grpc/go
    out: gen
    opt: paths=source_relative
```

Regenerate after proto changes:
```bash
cd nous-api-server
make proto-gen   # runs: buf generate https://github.com/nousproj/nous-proto.git
```

## Versioning Strategy

| Version | Status | Meaning |
|---------|--------|---------|
| `nous.v1alpha1` | Current | Pre-stability — breaking changes allowed |
| `nous.v1beta1` | Future | Feature-complete, API stabilizing |
| `nous.v1` | Future | GA — backward compatibility guaranteed |

Breaking changes at `v1alpha1` don't require a version bump. At `v1beta1` and beyond, `buf breaking` enforces no-breaking-change rules.

## Phase 1 Known Gap

`CreateAgentInstance` and `DeleteAgentInstance` RPCs are missing from `api.proto`. The controller-manager reconciler cannot create or delete instances until these are added.

```protobuf
// TODO: Add to api.proto
rpc CreateAgentInstance(CreateAgentInstanceRequest) returns (AgentInstance);
rpc DeleteAgentInstance(DeleteAgentInstanceRequest) returns (DeleteAgentInstanceResponse);
```
