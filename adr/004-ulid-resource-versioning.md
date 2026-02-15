# ADR-004: ULIDs for Resource Versioning

**Status**: Accepted

**Date**: 2026-02-14

---

## Context

The Nous control plane requires a `resource_version` field for optimistic concurrency control. Every resource (AgentDefinition, AgentTask, AgentInstance) has a `resource_version` that changes on every update.

Three formats were considered:

1. **UUIDs**: Universally Unique Identifiers (random, no ordering)
2. **ULIDs**: Universally Unique Lexicographically Sortable Identifiers (time-ordered)
3. **Integer Counters**: Sequential integers (1, 2, 3, ...)

The decision impacts DynamoDB schema, Watch API resumption, and coordination overhead.

---

## Decision

We will use **ULIDs** (Universally Unique Lexicographically Sortable Identifiers) for the `resource_version` field.

**Library**: `github.com/oklog/ulid/v2`

**Rationale**: ULIDs provide both uniqueness (like UUIDs) and time-ordered sortability (like timestamps), which is critical for DynamoDB range key ordering and Watch API resumption.

---

## Rationale

### Why ULIDs

#### 1. Lexicographic Sorting (Time-Ordered)
- **ULID format**: `01JCXZ1234ABCDEF` (first 10 chars = timestamp, last 6 = random)
- **Sorting property**: `ULID_1 < ULID_2` ⟺ `timestamp_1 < timestamp_2`
- **Use case**: DynamoDB range keys, Watch API cursors

**Example**:
```
01JCXZ1234ABCDEF  ← Created at 2026-02-15 10:00:00
01JCXZ5678GHIJKL  ← Created at 2026-02-15 10:05:00
```

Sorting gives chronological order automatically.

#### 2. DynamoDB Range Key Optimization
- **GSI1**: `NS#default#AGENTDEF` + `<creation_timestamp>#<name>`
- **Problem with UUIDs**: Cannot sort by time without separate timestamp field
- **Solution with ULIDs**: ULID *is* the timestamp (sortable)

**DynamoDB Query**:
```python
# List AgentDefinitions created after a specific ULID
query(
    GSI1PK = "NS#default#AGENTDEF",
    GSI1SK > "01JCXZ1234ABCDEF"  # All ULIDs after this timestamp
)
```

#### 3. Watch API Resumption
- **Watch request**: `WatchRequest{ResourceVersion: "01JCXZ1234ABCDEF"}`
- **Filter**: Return all events with `resource_version > 01JCXZ1234ABCDEF`
- **Time-ordered replay**: Events sorted chronologically (because ULIDs are time-ordered)

**Pseudocode**:
```go
func Watch(ctx context.Context, fromVersion string) (<-chan WatchEvent, error) {
    events := getBufferedEvents()
    for _, event := range events {
        if event.ResourceVersion > fromVersion {  // Lexicographic comparison
            send(event)
        }
    }
    // Continue streaming new events
}
```

#### 4. No Coordination Required
- **UUIDs/ULIDs**: Generated independently (no centralized counter)
- **Integer Counters**: Require atomic increment (coordination overhead)

**ULID generation**:
```go
import "github.com/oklog/ulid/v2"

ulid := ulid.Make().String()  // 01JCXZ1234ABCDEF (no coordination needed)
```

#### 5. Human-Readable (Debugging)
- **ULID**: `01JCXZ1234ABCDEF` (first 10 chars decode to timestamp)
- **UUID**: `550e8400-e29b-41d4-a716-446655440000` (opaque)

**Timestamp extraction**:
```go
id, _ := ulid.Parse("01JCXZ1234ABCDEF")
timestamp := ulid.Time(id.Time())  // 2026-02-15 10:00:00 UTC
```

Useful in logs and debugging.

---

## Consequences

### Positive

- ✅ **Time-ordered sorting**: DynamoDB range keys sort chronologically
- ✅ **Watch resumption**: `version > fromVersion` gives all events after a timestamp
- ✅ **No coordination**: Generated independently (no atomic counter)
- ✅ **Human-readable**: Timestamp prefix visible in logs
- ✅ **UUID-compatible**: Same 128-bit uniqueness guarantee

### Negative

- ❌ **Not globally sortable across multiple generators**: If two servers generate ULIDs at the same millisecond, ordering is random within that millisecond
- ❌ **Requires library**: Not a stdlib type (need `github.com/oklog/ulid/v2`)

### Mitigation

- **Ordering edge case**: Acceptable. Events within the same millisecond can be reordered (they're concurrent). For strict ordering, use Lamport clocks (not needed for Nous).
- **Library dependency**: Minimal (single dependency, well-maintained, 1K+ stars).

---

## Alternatives Considered

### Alternative 1: UUIDs (v4)

**Approach**: Use random UUIDs for `resource_version`.

**Pros**:
- Universally unique (no collisions)
- No coordination required
- Standard library support (`github.com/google/uuid`)

**Cons**:
- **Not sortable**: `uuid_1 < uuid_2` does NOT imply `timestamp_1 < timestamp_2`
- **DynamoDB inefficiency**: Cannot filter by time without separate timestamp field
- **Watch API complexity**: Need separate timestamp field for resumption

**Verdict**: Rejected — Lack of time-ordering breaks DynamoDB range key pattern and Watch resumption.

---

### Alternative 2: Integer Counters

**Approach**: Use sequential integers (1, 2, 3, ...) for `resource_version`.

**Pros**:
- Naturally ordered (1 < 2 < 3)
- Compact (small integers)

**Cons**:
- **Coordination required**: Need atomic increment (DynamoDB UpdateItem with increment)
- **Single point of contention**: All writes must touch the counter record
- **Performance bottleneck**: High-write workloads contend on counter

**Verdict**: Rejected — Coordination overhead limits scalability. ULIDs avoid this.

---

### Alternative 3: Timestamps (ISO 8601)

**Approach**: Use ISO 8601 timestamps as `resource_version` (e.g., `2026-02-15T10:00:00.123Z`).

**Pros**:
- Human-readable
- Sortable

**Cons**:
- **Clock skew**: Multiple servers with different clocks can generate non-monotonic timestamps
- **Collision risk**: Two writes at the same millisecond get same timestamp
- **No uniqueness**: Requires additional tie-breaker (defeats the purpose)

**Verdict**: Rejected — Clock skew breaks ordering. ULIDs combine timestamp + randomness for uniqueness.

---

### Alternative 4: Hybrid Logical Clocks (HLC)

**Approach**: Use Hybrid Logical Clocks (timestamp + counter for ordering).

**Pros**:
- Monotonic ordering even with clock skew
- Used in CockroachDB, FoundationDB

**Cons**:
- **Complexity**: Requires maintaining counter per node
- **Overkill**: Nous doesn't need strict causality (eventual consistency is acceptable)

**Verdict**: Rejected — ULIDs are simpler and sufficient for Nous use case.

---

## Implementation

### ULID Generation

```go
package storage

import (
    "crypto/rand"
    "github.com/oklog/ulid/v2"
)

func NewResourceVersion() string {
    entropy := rand.Reader
    id := ulid.MustNew(ulid.Timestamp(time.Now()), entropy)
    return id.String()
}
```

**Output**: `01JCXZ1234ABCDEF` (26 characters)

---

### DynamoDB Conditional Write

```go
func UpdateAgentDefinition(ctx context.Context, def *AgentDefinition) error {
    // Generate new resource version
    newVersion := NewResourceVersion()

    // Conditional write: fail if current version doesn't match
    expr, _ := expression.NewBuilder().
        WithCondition(expression.Name("ResourceVersion").Equal(expression.Value(def.Metadata.ResourceVersion))).
        Build()

    _, err := client.PutItem(ctx, &dynamodb.PutItemInput{
        TableName:                 aws.String("nous-state"),
        Item:                      marshal(def),
        ConditionExpression:       expr.Condition(),
        ExpressionAttributeNames:  expr.Names(),
        ExpressionAttributeValues: expr.Values(),
    })

    if isConditionFailed(err) {
        return ErrConflict  // Client must retry with fresh read
    }

    return err
}
```

---

### Watch Resume with ULID

```go
func WatchAgentDefinitions(ctx context.Context, fromVersion string) (<-chan WatchEvent, error) {
    ch := make(chan WatchEvent, 100)

    go func() {
        // Replay buffered events newer than fromVersion
        for _, event := range broadcaster.GetBufferedEvents() {
            if event.ResourceVersion > fromVersion {  // Lexicographic comparison
                ch <- event
            }
        }

        // Subscribe to new events
        broadcaster.Subscribe(ch)
    }()

    return ch, nil
}
```

**Key insight**: `event.ResourceVersion > fromVersion` works because ULIDs are time-ordered strings.

---

## References

- CLAUDE.md: Resource versioning (lines 692-712)
- CLAUDE.md: Watch resume (line 712)
- [data-model.md](../architecture/data-model.md) — DynamoDB schema with ULIDs
- [ADR-002](./002-dynamodb-state-store.md) — DynamoDB state store decision
- ULID Spec: https://github.com/ulid/spec

---

**Decision made by**: Architecture Team
**Last reviewed**: 2026-02-15
