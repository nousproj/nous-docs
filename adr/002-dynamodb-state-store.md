# ADR-002: DynamoDB as Primary State Store

**Status**: Accepted

**Date**: 2026-02-14

---

## Context

The Nous control plane requires a state store for all resources (AgentDefinitions, AgentTasks, AgentInstances). Key requirements:

- **Optimistic concurrency**: Multiple writers must coordinate without locks
- **Watch API**: Controllers need to watch for resource changes
- **Scale**: Handle 1000+ agents, 10,000+ tasks/hour
- **Operational simplicity**: Minimal ops overhead (serverless preferred)

Three primary options were considered: DynamoDB, PostgreSQL, and etcd.

---

## Decision

We will use **DynamoDB** with a **single-table design** as the primary state store.

**Rationale**: DynamoDB provides the right balance of scalability, operational simplicity, and support for optimistic concurrency via conditional writes.

---

## Rationale

### Why DynamoDB

#### 1. Serverless (Zero Ops)
- **No servers to manage**: AWS handles replication, backups, scaling
- **Pay-per-request**: Cost-efficient for variable load
- **Multi-AZ by default**: Built-in high availability

#### 2. Conditional Writes (Optimistic Concurrency)
- **ConditionExpression**: Atomic compare-and-swap on `resource_version`
- **No distributed locks needed**: Clients retry on conflict (same as etcd)
- **Pattern**: `PUT item WHERE resource_version = expected`

#### 3. DynamoDB Streams (Watch API)
- **Change Data Capture**: Streams emit events for all writes (INSERT, UPDATE, DELETE)
- **Integration with Lambda**: Stream events feed Lambda → publish to NATS for Watch API
- **Durable replay**: Streams retain events for 24 hours

#### 4. Single-Table Design
- **One table to manage**: Simpler backups, monitoring, cost tracking
- **Composite keys (PK/SK)**: Flexible access patterns (namespace, type, name)
- **GSIs for queries**: List by type, filter by agent definition

#### 5. Scale Without Ops
- **Auto-scaling**: DynamoDB auto-scales RCU/WCU based on load
- **No query tuning**: No indexes to optimize, no VACUUM
- **Consistent performance**: Single-digit millisecond latency at scale

---

## Consequences

### Positive

- ✅ **Serverless**: No DynamoDB cluster to manage (unlike PostgreSQL RDS or self-hosted etcd)
- ✅ **Optimistic concurrency**: Conditional writes enforce `resource_version` checks
- ✅ **Durable Watch API**: DynamoDB Streams → Lambda → NATS (Phase 2)
- ✅ **Cost-efficient**: Pay-per-request in development, provisioned capacity in production
- ✅ **Built-in backups**: Point-in-time recovery (PITR) enabled

### Negative

- ❌ **NoSQL learning curve**: Single-table design is non-intuitive (requires composite keys, GSIs)
- ❌ **No complex queries**: Cannot do JOINs or complex WHERE clauses
- ❌ **Item size limit**: 400 KB per item (mitigated: large blobs go to S3)

### Mitigation

- **Learning curve**: Document access patterns clearly (see [data-model.md](../architecture/data-model.md))
- **Complex queries**: Not needed — resource queries are simple (get by name, list by namespace)
- **Item size limit**: Store cognitive state in S3, only metadata in DynamoDB

---

## Alternatives Considered

### Alternative 1: PostgreSQL (RDS)

**Approach**: Use PostgreSQL with JSONB columns for flexible schema.

**Pros**:
- Rich query capabilities (JOINs, complex WHERE, full-text search)
- ACID transactions
- Familiar SQL interface

**Cons**:
- **Operational overhead**: Requires managing RDS instances (patching, backups, failover)
- **Scaling complexity**: Vertical scaling only (cannot shard easily)
- **Watch API**: No built-in CDC (change data capture) — need to poll or use triggers + NOTIFY
- **Cost**: Always-on instances (even with low load)

**Verdict**: Rejected — Operational overhead outweighs query flexibility. Nous queries are simple (get/list).

---

### Alternative 2: etcd

**Approach**: Use etcd (same as Kubernetes) for state storage.

**Pros**:
- Battle-tested (powers Kubernetes)
- Built-in Watch API (gRPC streams)
- Strong consistency (Raft consensus)

**Cons**:
- **Size limits**: 1.5 MB per key (unsuitable for cognitive state)
- **Operational overhead**: Requires 3-5 node cluster for HA
- **Scaling limits**: Not designed for high write throughput (thousands of writes/sec)
- **Cost**: Always-on EC2 instances

**Verdict**: Rejected — Designed for small, frequently-changing config (not large agent state). Operational overhead high.

---

### Alternative 3: FoundationDB

**Approach**: Use FoundationDB (distributed key-value store).

**Pros**:
- Strong consistency
- High write throughput
- ACID transactions

**Cons**:
- **Operational complexity**: Requires deep expertise to run in production
- **No managed service**: Must self-host (no AWS equivalent)
- **Smaller ecosystem**: Less community support than DynamoDB

**Verdict**: Rejected — Too much operational risk for a startup/team without FoundationDB expertise.

---

## Single-Table Design Justification

### Why Single Table vs Multiple Tables?

**Single Table**:
- One table to backup, monitor, scale
- Consistent latency (no cross-table joins)
- Simpler access patterns (all resources queryable via PK/SK)

**Multiple Tables** (e.g., `agent-definitions`, `agent-tasks`, `agent-instances`):
- Easier to understand (each resource in its own table)
- Requires more operational overhead (3+ tables to monitor)
- Cross-resource queries become complex

**Verdict**: Single table for operational simplicity. Complexity is in schema design (composite keys), not operations.

---

## Schema Highlights

### Primary Key Pattern

```
PK: NS#<namespace>
SK: <RESOURCE_TYPE>#<name>
```

Examples:
- `NS#default` + `AGENTDEF#researcher`
- `NS#production` + `AGENTTASK#task-001`

### GSI1: List by Type

```
GSI1PK: NS#<namespace>#<RESOURCE_TYPE>
GSI1SK: <creation_timestamp>#<name>
```

Use case: List all AgentDefinitions in namespace `default`.

### GSI2: Filter Tasks by Agent Definition

```
GSI2PK: NS#<namespace>#AGENTDEF#<agent_def_name>
GSI2SK: TASK#<phase>#<creation_timestamp>
```

Use case: List all Running tasks for agent definition `researcher`.

---

## Watch API Strategy

### Phase 1: In-Memory Fan-Out
- API server maintains in-memory event bus
- Sufficient for single-instance API server in local dev

### Phase 2: DynamoDB Streams → Lambda → NATS
- DynamoDB Streams emits all changes
- Lambda consumes stream, publishes to NATS JetStream
- API server Watch endpoints subscribe to NATS subjects
- Supports multi-instance API servers (no single point of failure)

**Evidence**: CLAUDE.md lines 582-596

---

## Cost Estimate

### Development (On-Demand)
- **Writes**: 1000/day × $1.25/million = $0.00125/day
- **Reads**: 5000/day × $0.25/million = $0.00125/day
- **Storage**: 1 GB × $0.25/GB = $0.25/month
- **Total**: ~$0.30/month

### Production (Provisioned)
- **RCU**: 100 units × $0.00013/hour × 730 hours = $9.49/month
- **WCU**: 50 units × $0.00065/hour × 730 hours = $23.73/month
- **Storage**: 100 GB × $0.25/GB = $25/month
- **Total**: ~$60/month (scales with load)

**Comparison**: PostgreSQL RDS db.t3.small = $40/month (always-on, less scalable).

---

## References

- CLAUDE.md: DynamoDB table design (lines 663-690)
- CLAUDE.md: Resource versioning with ULIDs (lines 692-712)
- [data-model.md](../architecture/data-model.md) — Complete schema documentation
- [ADR-004](./004-ulid-resource-versioning.md) — ULID format for resource_version

---

**Decision made by**: Architecture Team
**Last reviewed**: 2026-02-15
