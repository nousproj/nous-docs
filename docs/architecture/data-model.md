# Data Model

## Overview

Nous uses DynamoDB as its primary state store with a **single-table design**. This document describes the table schema, access patterns, and optimistic concurrency model.

**Design Philosophy**: Single-table design trades schema complexity for operational simplicity (one table to monitor, back up, scale).

---

## Primary Key Schema

### Table: `nous-state`

**Composite Key**: `PK` (Partition Key) + `SK` (Sort Key)

```
PK (partition key)     | SK (sort key)                    | Type              | Data
-----------------------|----------------------------------|-------------------|-----
NS#default             | AGENTDEF#researcher               | AgentDefinition   | {metadata, spec, status}
NS#default             | AGENTDEF#analyst                  | AgentDefinition   | {metadata, spec, status}
NS#default             | AGENTTASK#task-001                | AgentTask         | {metadata, spec, status}
NS#default             | AGENTINST#researcher-abc123       | AgentInstance     | {metadata, spec, status}
NS#production          | AGENTDEF#translator               | AgentDefinition   | {metadata, spec, status}
LEASE#controller-manager | SINGLETON                       | Lease             | {HolderID, LeaseExpiry, FenceToken}
```

### Sort Key Prefix Conventions

| Resource Type | SK Prefix | Example |
|---------------|-----------|---------|
| AgentDefinition | `AGENTDEF#` | `AGENTDEF#researcher` |
| AgentTask | `AGENTTASK#` | `AGENTTASK#task-001` |
| AgentInstance | `AGENTINST#` | `AGENTINST#researcher-abc123` |
| Lease | `SINGLETON` | `SINGLETON` (for leader election) |

**Why prefixes**: Enables querying by resource type within a namespace using `begins_with(SK, "AGENTDEF#")`.

---

## Example Records

### AgentDefinition

```json
{
  "PK": "NS#default",
  "SK": "AGENTDEF#researcher",
  "Type": "AgentDefinition",
  "Name": "researcher",
  "Namespace": "default",
  "UID": "01JCXZ...",
  "ResourceVersion": "01JCXZ1234ABCDEF",
  "Generation": 5,
  "CreationTimestamp": "2026-02-15T10:00:00Z",
  "Labels": {"team": "nlp", "tier": "premium"},
  "Annotations": {"cost-center": "ai-research"},
  "Spec": {
    "Model": {"Provider": "anthropic", "Model": "claude-sonnet-4-20250514", "Temperature": 0.7},
    "Resources": {"Limits": {"MaxTokensPerMinute": 100000, "MaxCostPerHour": 10.0}},
    "Scaling": {"MinInstances": 1, "MaxInstances": 10, "DesiredInstances": 3}
  },
  "Status": {
    "ReadyInstances": 3,
    "DesiredInstances": 3,
    "UnavailableInstances": 0,
    "Conditions": [{"Type": "Available", "Status": "True", "LastTransitionTime": "2026-02-15T10:05:00Z"}]
  }
}
```

### AgentTask

```json
{
  "PK": "NS#default",
  "SK": "AGENTTASK#task-001",
  "Type": "AgentTask",
  "Name": "task-001",
  "Namespace": "default",
  "UID": "01JCYA...",
  "ResourceVersion": "01JCYA5678GHIJKL",
  "Spec": {
    "AgentDefinition": "researcher",
    "Input": "Summarize the latest NLP research papers on transformers",
    "Timeout": "3600s",
    "MaxCost": 1.0,
    "Priority": "high"
  },
  "Status": {
    "Phase": "Running",
    "AssignedInstance": "researcher-abc123",
    "StartTime": "2026-02-15T10:10:00Z",
    "Metrics": {"InputTokens": 1500, "OutputTokens": 3000, "Cost": 0.15}
  }
}
```

### AgentInstance

```json
{
  "PK": "NS#default",
  "SK": "AGENTINST#researcher-abc123",
  "Type": "AgentInstance",
  "Name": "researcher-abc123",
  "Namespace": "default",
  "UID": "01JCYB...",
  "ResourceVersion": "01JCYB9012MNOPQR",
  "Spec": {
    "AgentDefinition": "researcher",
    "RuntimeID": "ecs:task/abc123",
    "Node": "node-01"
  },
  "Status": {
    "Phase": "Running",
    "LastHeartbeat": "2026-02-15T10:15:00Z",
    "CognitiveState": {"ContextUtilization": 0.65, "ActiveTasks": 2},
    "Metrics": {"TasksCompleted": 47, "AvgQualityScore": 0.89, "TotalCost": 12.45}
  }
}
```

### Leader Election Lease

```json
{
  "PK": "LEASE#controller-manager",
  "SK": "SINGLETON",
  "Type": "Lease",
  "HolderID": "controller-abc123",
  "LeaseExpiry": "2026-02-15T10:20:00Z",
  "FenceToken": 42,
  "TTL": 1708001000
}
```

**FenceToken**: Monotonic counter incremented on each lease acquisition. Used to detect stale writes from old leaders.

**TTL**: Unix timestamp for DynamoDB TTL auto-expiry (15 seconds after LeaseExpiry).

---

## Global Secondary Indexes

### GSI1: List by Type Within Namespace

**Purpose**: List all resources of a given type in a namespace, sorted by creation time.

**Use Case**: `ListAgentDefinitions(namespace="default")` → returns all AgentDefinitions in `default` namespace.

**Schema**:
```
GSI1PK (partition key)  | GSI1SK (sort key)
------------------------|----------------------------------
NS#default#AGENTDEF     | <creation_timestamp>#<name>
NS#default#AGENTTASK    | <creation_timestamp>#<name>
NS#default#AGENTINST    | <creation_timestamp>#<name>
NS#production#AGENTDEF  | <creation_timestamp>#<name>
```

**Query Example**:
```python
# List all AgentDefinitions in namespace "default"
response = dynamodb.query(
    IndexName="GSI1",
    KeyConditionExpression="GSI1PK = :pk",
    ExpressionAttributeValues={":pk": "NS#default#AGENTDEF"}
)
```

**Sorting**: Results are sorted by creation timestamp (oldest first). For newest-first, use `ScanIndexForward=False`.

---

### GSI2: Filter Tasks by Agent Definition

**Purpose**: List all tasks assigned to a specific agent definition, optionally filtered by phase.

**Use Case**: `ListAgentTasks(namespace="default", agentDefinition="researcher", phase="Running")`

**Schema**:
```
GSI2PK (partition key)              | GSI2SK (sort key)
------------------------------------|----------------------------------
NS#default#AGENTDEF#researcher      | TASK#Running#<creation_timestamp>
NS#default#AGENTDEF#researcher      | TASK#Completed#<creation_timestamp>
NS#production#AGENTDEF#translator   | TASK#Pending#<creation_timestamp>
```

**Query Example**:
```python
# List all Running tasks for AgentDefinition "researcher" in namespace "default"
response = dynamodb.query(
    IndexName="GSI2",
    KeyConditionExpression="GSI2PK = :pk AND begins_with(GSI2SK, :sk_prefix)",
    ExpressionAttributeValues={
        ":pk": "NS#default#AGENTDEF#researcher",
        ":sk_prefix": "TASK#Running#"
    }
)
```

---

## Optimistic Concurrency & Resource Versioning

### Resource Version Format

**ULIDs** (Universally Unique Lexicographically Sortable Identifiers)

**Why ULIDs over UUIDs**:
- Chronologically sortable (useful for DynamoDB range keys and Watch cursors)
- Time-ordered (can filter `version > fromVersion` for Watch API)
- Human-readable timestamp prefix

**Library**: `github.com/oklog/ulid/v2`

**Example**:
```
01JCXZ1234ABCDEF  ← ULID (first 10 chars = timestamp, last 6 = random)
```

---

### Conditional Write Pattern

#### Create: Fail if Already Exists

```go
import (
    "github.com/aws/aws-sdk-go-v2/feature/dynamodb/expression"
    "github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// Ensure item doesn't exist (first-time create)
expr, _ := expression.NewBuilder().
    WithCondition(expression.Name("PK").AttributeNotExists()).
    Build()

_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
    TableName:                 aws.String("nous-state"),
    Item:                      itemMap,
    ConditionExpression:       expr.Condition(),
    ExpressionAttributeNames:  expr.Names(),
    ExpressionAttributeValues: expr.Values(),
})

if err != nil {
    // Check for ConditionalCheckFailedException
    if isConditionFailed(err) {
        return storage.ErrAlreadyExists
    }
    return err
}
```

---

#### Update: Fail if Resource Version Doesn't Match (Optimistic Lock)

```go
// Ensure resource_version matches (optimistic concurrency)
expr, _ := expression.NewBuilder().
    WithCondition(expression.Name("ResourceVersion").Equal(expression.Value(expectedVersion))).
    Build()

_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
    TableName:                 aws.String("nous-state"),
    Item:                      updatedItem,
    ConditionExpression:       expr.Condition(),
    ExpressionAttributeNames:  expr.Names(),
    ExpressionAttributeValues: expr.Values(),
})

if err != nil {
    if isConditionFailed(err) {
        return storage.ErrConflict  // Client must retry with fresh read
    }
    return err
}
```

**gRPC Error Mapping**:
```go
if errors.Is(err, storage.ErrConflict) {
    return nil, status.Error(codes.Aborted, "resource version conflict, retry with fresh read")
}
```

Client receives `codes.Aborted` → re-fetches resource → retries update with new `resource_version`.

---

### Watch Resume with Resource Version

**Problem**: Client disconnects from Watch stream. How to resume without missing events?

**Solution**: Use `resource_version` as a cursor.

**Pattern**:
1. Client sends `WatchRequest{ResourceVersion: "01JCXZ1234ABCDEF"}`
2. Watch API replays buffered events with `version > 01JCXZ1234ABCDEF`
3. Stream continues with new events

**Why ULIDs work**: Since ULIDs are time-ordered, filtering `version > fromVersion` gives all events after a specific timestamp.

---

## DynamoDB Streams (Phase 2)

**Purpose**: Durable Watch API for multi-instance API servers.

**Pattern**:
1. DynamoDB Streams enabled on `nous-state` table (`StreamViewType: NEW_AND_OLD_IMAGES`)
2. Lambda consumes stream, transforms records into Watch events
3. Lambda publishes to NATS JetStream (`subject: nous.watch.AgentDefinition`)
4. API server Watch endpoints subscribe to NATS subjects

**Why**: Decouples Watch from any single API server instance. API servers can scale horizontally.

**Evidence**: `CLAUDE.md:593` (Watch Strategy Phase 2)

---

## Pagination

### List with Continue Token

**Pattern**: DynamoDB returns `LastEvaluatedKey` → encoded as `continue_token` → passed in next request.

**Example**:
```go
func ListAgentDefinitions(ctx context.Context, namespace string, limit int32, continueToken string) (*ListResult, error) {
    input := &dynamodb.QueryInput{
        TableName:              aws.String("nous-state"),
        IndexName:              aws.String("GSI1"),
        KeyConditionExpression: aws.String("GSI1PK = :pk"),
        ExpressionAttributeValues: map[string]types.AttributeValue{
            ":pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("NS#%s#AGENTDEF", namespace)},
        },
        Limit: aws.Int32(limit),
    }

    if continueToken != "" {
        // Decode base64-encoded LastEvaluatedKey
        input.ExclusiveStartKey = decodeToken(continueToken)
    }

    result, err := client.Query(ctx, input)
    if err != nil {
        return nil, err
    }

    var nextToken string
    if result.LastEvaluatedKey != nil {
        nextToken = encodeToken(result.LastEvaluatedKey)
    }

    return &ListResult{
        Items:         parseItems(result.Items),
        ContinueToken: nextToken,
    }, nil
}
```

**Token Encoding**: Base64-encode `LastEvaluatedKey` (PK + SK + GSI keys) for opaque cursor.

---

## TTL for Auto-Expiry

**Use Case**: Leader election leases auto-expire if holder crashes.

**Schema**:
- `TTL` attribute (Unix timestamp)
- DynamoDB TTL enabled on `TTL` attribute

**Example**:
```json
{
  "PK": "LEASE#controller-manager",
  "LeaseExpiry": "2026-02-15T10:20:00Z",
  "TTL": 1708001000  ← Unix timestamp = LeaseExpiry + buffer
}
```

**Behavior**: DynamoDB automatically deletes items when `now() > TTL` (within 48 hours).

---

## Capacity Planning

### Development
- **Billing Mode**: `PAY_PER_REQUEST` (on-demand)
- **Rationale**: Unpredictable load, cost optimization

### Production
- **Billing Mode**: `PROVISIONED` with auto-scaling
- **Initial Capacity**:
  - Read: 100 RCU
  - Write: 50 WCU
- **Auto-Scaling**:
  - Target utilization: 70%
  - Min: 50 RCU/WCU
  - Max: 1000 RCU/WCU

**Evidence**: `CLAUDE.md:922-956` (Pulumi DynamoDB table)

---

## Point-in-Time Recovery

**Enabled**: Yes

**Rationale**: Protect against accidental deletes or corruption.

**RTO**: < 5 minutes (restore to any point in last 35 days)

---

## References

- *Architecture defined in repo-level CLAUDE.md — DynamoDB schema specification*
- [ADR-002](../adr/002-dynamodb-state-store.md) — DynamoDB state store decision
- [ADR-004](../adr/004-ulid-resource-versioning.md) — ULID resource versioning decision
