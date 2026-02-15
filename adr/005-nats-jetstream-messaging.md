# ADR-005: NATS JetStream for Inter-Agent Messaging

**Status**: Accepted

**Date**: 2026-02-14

---

## Context

The Nous control plane requires a messaging system for two primary use cases:

1. **Watch API (Phase 2)**: Multi-instance API servers need to receive resource change events from DynamoDB Streams
2. **Inter-Agent Communication (Phase 3)**: Agents need to exchange messages for collaboration (task delegation, context sharing)

Four messaging systems were considered: NATS JetStream, Apache Kafka, AWS SQS/EventBridge, and Redis Streams.

The decision impacts operational complexity, durability guarantees, and integration patterns.

---

## Decision

We will use **NATS JetStream** as the messaging backbone for Watch API and inter-agent communication.

**Rationale**: NATS JetStream provides lightweight, Go-native pub/sub with durable replay, at-least-once delivery, and subject-based routing—without the operational overhead of Kafka or vendor lock-in of AWS-native services.

---

## Rationale

### Why NATS JetStream

#### 1. Lightweight and Go-Native
- **Single binary**: NATS server deploys as a single ~20MB binary (no JVM, no Zookeeper)
- **Go client**: `github.com/nats-io/nats.go` is idiomatic, well-maintained, and has minimal dependencies
- **Low resource footprint**: Runs efficiently on small instances (512MB RAM sufficient for dev/staging)

#### 2. At-Least-Once Delivery with Durable Replay
- **JetStream streams**: Persist messages to disk (configurable retention: time, size, or count-based)
- **Consumer offsets**: Track per-consumer position for replay from any point
- **Use case**: Watch API clients can resume from last consumed message after reconnect

**Example**:
```go
// Subscribe to Watch events with durable consumer
sub, _ := js.Subscribe("nous.watch.AgentDefinition", nats.Durable("api-server-1"))
```

#### 3. Subject-Based Routing (No Topic Management Overhead)
- **Wildcard subjects**: `nous.watch.*`, `nous.agent.*.messages`
- **Dynamic routing**: No need to pre-create topics (unlike Kafka)
- **Use case**: Subscribe to all Watch events or filter by resource type

**Example**:
```
nous.watch.AgentDefinition     → Watch events for AgentDefinitions
nous.watch.AgentTask           → Watch events for AgentTasks
nous.agent.researcher.messages → Messages for agent "researcher"
```

#### 4. Built-In Horizontal Scaling (Queue Groups)
- **Queue groups**: Multiple API servers subscribe to same subject, NATS load-balances messages
- **No partition rebalancing**: Unlike Kafka, no need to manage partition assignments
- **Use case**: 3 API server instances share Watch event load

**Example**:
```go
// All API servers in "api-servers" queue group share the load
js.QueueSubscribe("nous.watch.*", "api-servers", handler)
```

#### 5. Cloud-Native Deployment (NATS on Kubernetes or ECS)
- **NATS Operator**: Kubernetes operator for HA deployment (3-node cluster)
- **ECS support**: Can run NATS server on ECS Fargate (no K8s required)
- **Helm charts**: Official charts for quick deployment

---

## Consequences

### Positive

- ✅ **Lightweight**: No JVM, no Zookeeper, minimal ops overhead
- ✅ **Go-native**: Clean integration with Go services (no FFI, no wrapper libraries)
- ✅ **Durable replay**: JetStream persists messages for Watch API resume
- ✅ **Subject-based routing**: No topic management overhead (unlike Kafka)
- ✅ **Queue groups**: Built-in load balancing for multiple consumers
- ✅ **Multi-cloud**: Not locked into AWS (can deploy anywhere)

### Negative

- ❌ **Less mature than Kafka**: Smaller ecosystem, fewer integrations
- ❌ **No exactly-once semantics**: At-least-once only (acceptable for idempotent Watch events)
- ❌ **Manual cluster management**: No managed service (must run NATS ourselves)

### Mitigation

- **Maturity**: NATS is battle-tested (used by Choria, Synadia, MasterCard). JetStream is production-ready as of NATS 2.2+
- **Exactly-once**: Not needed—Nous controllers are idempotent (reconciliation loops handle duplicate events)
- **Managed service**: Future option to use Synadia Cloud (managed NATS) if operational burden grows

---

## Alternatives Considered

### Alternative 1: Apache Kafka

**Approach**: Use Kafka for durable messaging and event streaming.

**Pros**:
- Industry standard for event streaming
- Exactly-once semantics (with transactions)
- Rich ecosystem (Kafka Connect, ksqlDB, Schema Registry)

**Cons**:
- **Operational complexity**: Requires Zookeeper (or KRaft mode), multi-broker clusters
- **Heavy resource usage**: JVM-based, high memory footprint (4GB+ per broker)
- **Topic management**: Must pre-create topics, manage partitions
- **Overkill**: Nous doesn't need Kafka's throughput (millions of msgs/sec)

**Verdict**: Rejected — Operational overhead too high for Nous workload. NATS is sufficient.

---

### Alternative 2: AWS SQS + EventBridge

**Approach**: Use SQS for queuing, EventBridge for event routing.

**Pros**:
- Fully managed (zero ops)
- Native AWS integration
- Auto-scaling

**Cons**:
- **Vendor lock-in**: Cannot run outside AWS
- **No durable replay**: SQS deletes messages after consumption (no offset seeking)
- **EventBridge complexity**: Rule-based routing more complex than NATS subjects
- **Cost**: Pay per message (NATS is flat cost per instance)

**Verdict**: Rejected — Vendor lock-in unacceptable. NATS provides portability.

---

### Alternative 3: Redis Streams

**Approach**: Use Redis Streams for pub/sub with consumer groups.

**Pros**:
- Simple deployment (single Redis instance)
- Consumer groups with offset tracking
- Fast in-memory performance

**Cons**:
- **Durability trade-off**: In-memory by default (persistence via snapshots/AOF adds complexity)
- **Not designed for large-scale streaming**: Redis Streams best for small, fast queues
- **Single-threaded**: Redis performance degrades with high message volume

**Verdict**: Rejected — Redis is better suited for caching/session storage, not event streaming.

---

## Phase Integration

### Phase 1: Not Required
- **Watch API**: In-memory fan-out (single API server instance)
- **Inter-agent messaging**: Not implemented yet

### Phase 2: Watch API with NATS
- **Pattern**: DynamoDB Streams → Lambda → NATS → API servers
- **Deployment**: 3-node NATS cluster on ECS (or NATS Operator on EKS)
- **Subjects**:
  - `nous.watch.AgentDefinition`
  - `nous.watch.AgentTask`
  - `nous.watch.AgentInstance`

**Lambda Function (Pseudo-code)**:
```python
def lambda_handler(event, context):
    for record in event['Records']:
        if record['eventName'] == 'INSERT' or record['eventName'] == 'MODIFY':
            resource = parse_dynamodb_record(record)
            subject = f"nous.watch.{resource['Type']}"
            nats_client.publish(subject, json.dumps(resource))
```

### Phase 3: Inter-Agent Communication
- **Pattern**: Agent A publishes to `nous.agent.<agentB_name>.messages`, Agent B subscribes
- **Use cases**:
  - Task delegation (researcher agent asks summarizer agent to process document)
  - Context sharing (agents share conversation history for collaboration)

**Example**:
```go
// Agent A sends message to Agent B
js.Publish("nous.agent.summarizer.messages", messageBytes)

// Agent B subscribes
js.Subscribe("nous.agent.summarizer.messages", handler)
```

---

## Deployment Architecture

### Development
- Single NATS server (no clustering)
- In-memory JetStream (no persistence)
- Runs as Docker container or local binary

### Staging/Production
- 3-node NATS cluster (HA with Raft consensus)
- JetStream with file-based persistence (EBS volumes)
- TLS encryption for client-server and server-server communication

**Example Pulumi Configuration** (TypeScript):
```typescript
const natsCluster = new aws.ecs.Service("nats-cluster", {
    cluster: ecsCluster.arn,
    taskDefinition: natsTaskDef.arn,
    desiredCount: 3,
    networkConfiguration: {
        subnets: privateSubnets,
        securityGroups: [natsSecurityGroup.id],
    },
});
```

---

## References

- CLAUDE.md: Watch Strategy Phase 2 (lines 582-596)
- CLAUDE.md: Inter-agent communication (Phase 3 roadmap)
- [data-model.md](../architecture/data-model.md) — DynamoDB Streams integration
- [ADR-002](./002-dynamodb-state-store.md) — DynamoDB state store decision
- NATS JetStream Docs: https://docs.nats.io/nats-concepts/jetstream

---

**Decision made by**: Architecture Team
**Last reviewed**: 2026-02-15
