# Reconciliation Loop

The reconciliation loop is the heart of Nous. It is the implementation of the **observe → diff → act** pattern that Kubernetes pioneered — applied to AI agent management.

## The Core Pattern

```mermaid
flowchart TD
    A([Watch Event / Timer]) --> B[Enqueue key<br/>'namespace/name']
    B --> C{Dedup check}
    C -->|already queued| D[No-op]
    C -->|new| E[Add to WorkQueue]
    E --> F[Worker goroutine dequeues]
    F --> G[Reconcile 'namespace/name']

    G --> H[GetAgentDefinition<br/>desired state]
    G --> I[ListAgentInstances<br/>actual state]
    H & I --> J{Diff}

    J -->|desired > actual| K[Scale Up<br/>CreateAgentInstance × N]
    J -->|desired < actual| L[Scale Down<br/>DeleteAgentInstance × N]
    J -->|balanced| M[No-op]

    K & L & M --> N[UpdateAgentDefinitionStatus<br/>ready / desired / unavailable]
    N --> O{Error?}
    O -->|yes| P[AddRateLimited<br/>exponential backoff]
    O -->|no| Q[Forget key<br/>reset backoff]
    Q --> R[RequeueAfter<br/>reconcileInterval]

    style A fill:#dbeafe,stroke:#1d4ed8
    style D fill:#f1f5f9,stroke:#94a3b8
    style K fill:#dcfce7,stroke:#16a34a
    style L fill:#fee2e2,stroke:#dc2626
    style P fill:#fef3c7,stroke:#d97706
```

---

## Work Queue Design

The work queue is modeled after `client-go/util/workqueue`. Key properties:

### Deduplication

```go
// Add("default/researcher") three times → only one entry in queue
q.Add("default/researcher")
q.Add("default/researcher")  // no-op — already queued
q.Add("default/researcher")  // no-op — already queued
```

### Processing Set

When a key is being processed, it moves from the queue to the processing set. New Add() calls mark the key as "dirty":

```
State transitions:
  add("k") → queue: [k], dirty: {}, processing: {}
  get("k")  → queue: [],  dirty: {}, processing: {k}
  add("k")  → queue: [],  dirty: {k}, processing: {k}  ← marked dirty
  done("k") → queue: [k], dirty: {},  processing: {}   ← re-enqueued
```

### Exponential Backoff

Failed reconciliations get exponential backoff so transient errors don't hammer the API server:

| Attempt | Delay |
|---------|-------|
| 1st failure | 5ms |
| 2nd failure | 10ms |
| 3rd failure | 20ms |
| ... | doubles each time |
| max | 1000s |

After a successful reconciliation, the key is `Forget()`ed and backoff resets to base.

---

## Leader Election

Only one controller-manager replica is active at a time. Leader election uses DynamoDB conditional writes.

```mermaid
stateDiagram-v2
    [*] --> Follower: Start

    Follower --> Acquiring: Try PutItem lease<br/>(attribute_not_exists OR expired)
    Acquiring --> Leader: PutItem succeeds<br/>FenceToken = now_ms
    Acquiring --> Follower: ConditionCheckFailed<br/>Another holder won

    Leader --> Renewing: Every renewTTL (5s)
    Renewing --> Leader: UpdateItem succeeds<br/>(HolderID = me)
    Renewing --> Released: UpdateItem fails<br/>(took too long)

    Leader --> Released: Context cancelled<br/>(shutdown)
    Released --> [*]: DeleteItem lease

    note right of Leader
        OnStartedLeading(ctx) called.
        Informer + Manager start.
        All writes fenced with
        FenceToken value.
    end note

    note right of Released
        OnStoppedLeading() called.
        Leading context cancelled.
        All in-flight reconciliations
        abort immediately.
    end note
```

### Fencing Token

The FenceToken is a `UnixMilli` timestamp set at lease acquisition. Every write to DynamoDB includes a condition `FenceToken <= :acquired_token`. If a stale leader (replica with an old token) attempts a write after a new leader has taken over with a higher token, the write is rejected with `ErrStaleFence`.

**Implementation**: The controller-manager's gRPC client attaches the current fence token as the `x-nous-fence-token` metadata header on every outgoing call. The api-server's `UnaryFenceTokenInterceptor` reads this header and wraps the `StateStore` with `WithFenceToken(token)` for the duration of that request. Service methods transparently pick up the fenced store via `storeFor(ctx)`.

---

## Informer: List + Watch

The informer seeds the work queue on startup and keeps it updated via the gRPC Watch stream:

```mermaid
sequenceDiagram
    participant I as Informer
    participant API as nous-api-server
    participant Q as WorkQueue

    Note over I: startup

    I->>API: ListAgentDefinitions (all)
    API-->>I: [def1, def2, def3]
    I->>Q: Add "default/def1"
    I->>Q: Add "default/def2"
    I->>Q: Add "default/def3"

    I->>API: WatchAgentDefinitions (resourceVersion=latest)
    Note over I,API: streaming gRPC

    loop Watch stream alive
        API-->>I: WatchEvent{ADDED, def4}
        I->>Q: Add "default/def4"
        API-->>I: WatchEvent{MODIFIED, def1}
        I->>Q: Add "default/def1"
        API-->>I: WatchEvent{DELETED, def2}
        I->>Q: Add "default/def2"
    end

    Note over I: Stream broken (network/restart)
    I->>I: Wait 1 second
    I->>API: ListAgentDefinitions (relist)
    Note over I: full resync — all keys re-enqueued
```

---

## AgentController.Reconcile in Detail

```go
func (c *AgentController) Reconcile(ctx context.Context, key string) (Result, error) {
    // 1. Parse key
    namespace, name := splitKey(key)

    // 2. Fetch desired state
    def, err := c.client.GetAgentDefinition(ctx, namespace, name)
    if isNotFound(err) {
        return Result{}, nil  // deleted — nothing to do
    }

    // 3. Fetch actual state
    instances, err := c.client.ListAgentInstances(ctx, namespace, name)

    // 4. Compute diff
    desired := int(def.Spec.Scaling.DesiredInstances)
    if desired == 0 { desired = 1 }  // default
    actual := len(instances)

    // 5. Act
    switch {
    case actual < desired:
        // Scale up: create (desired - actual) new instances
        for i := 0; i < desired-actual; i++ {
            inst := buildAgentInstance(def, generateShortID())
            c.client.CreateAgentInstance(ctx, inst)
        }
    case actual > desired:
        // Scale down: delete (actual - desired) oldest instances
        for i := 0; i < actual-desired; i++ {
            c.client.DeleteAgentInstance(ctx, instances[i])
        }
    }

    // 6. Update status
    status := computeStatus(def, instances)
    c.client.UpdateAgentDefinition(ctx, withStatus(def, status))

    // 7. Requeue for periodic health check
    return Result{RequeueAfter: c.reconcileInterval}, nil
}
```

!!! note "Phase 1 Gap"
    `CreateAgentInstance` and `DeleteAgentInstance` RPCs are not yet defined in `nous-proto`. The current implementation logs intent but cannot execute scale-up/down. These RPCs will be added in Phase 2.
