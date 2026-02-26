# Visual Architecture

This page provides comprehensive visual diagrams of the Nous architecture — covering the full system topology, data flows, component interactions, and the DynamoDB storage model.

---

## Full System Topology

The complete Nous platform showing all components, layers, and their interactions:

```mermaid
graph TB
    subgraph Users["Users & Tooling"]
        CLI([nousctl CLI])
        SDK([Agent SDK])
        CI([CI/CD Pipeline])
    end

    subgraph ControlPlane["Control Plane (AWS ECS)"]
        direction TB
        API["<b>nous-api-server</b><br/>─────────────────<br/>gRPC :31051<br/>REST/HTTP :8080<br/>Metrics :9090<br/>─────────────────<br/>NousAPI service<br/>Watch broadcaster<br/>Admission control"]
        CM["<b>nous-controller-manager</b><br/>─────────────────<br/>AgentController<br/>TaskController<br/>HealthController<br/>RecoveryController<br/>─────────────────<br/>Leader Election<br/>Work Queue"]
        SCH["<b>nous-scheduler</b><br/>─────────────────<br/>Multi-Objective<br/>Cost/Quality/Latency<br/>─────────────────<br/>Task → Node Matching<br/>Affinity Rules"]
    end

    subgraph StateLayer["State Layer"]
        direction LR
        DDB[("DynamoDB<br/>────────<br/>nous-state table<br/>Single-table design<br/>GSI1 + GSI2<br/>DynamoDB Streams")]
        S3[("S3 Bucket<br/>────────<br/>Cognitive state<br/>Checkpoints<br/>Result artifacts")]
        NATS[("NATS JetStream<br/>────────<br/>Task queue<br/>Watch events<br/>Agent messaging")]
    end

    subgraph DataPlane["Data Plane (ECS / Lambda / VMs)"]
        direction TB
        NS1["<b>nous-node-supervisor</b><br/>Node A"]
        NS2["<b>nous-node-supervisor</b><br/>Node B"]
        subgraph Agents1["Agents on Node A"]
            AR1["Agent Instance<br/>researcher-abc"]
            AR2["Agent Instance<br/>researcher-def"]
        end
        subgraph Agents2["Agents on Node B"]
            AR3["Agent Instance<br/>analyst-xyz"]
        end
    end

    subgraph External["External Services"]
        LLM[("LLM APIs<br/>Anthropic / OpenAI<br/>Google")]
        TOOLS[("Tools & APIs<br/>Web Search<br/>Doc Retrieval")]
        SM[("AWS Secrets Manager<br/>API Keys")]
    end

    subgraph Observability["Observability"]
        PROM["Prometheus<br/>:9090/metrics"]
        GRAF["Grafana<br/>Dashboards"]
        OT["OpenTelemetry<br/>Collector"]
    end

    CLI -->|"HTTP POST /apply<br/>YAML resource"| API
    SDK -->|"gRPC"| API
    CI -->|"gRPC / HTTP"| API

    API <-->|"DynamoDB<br/>conditional writes"| DDB
    API -->|"Publish events"| NATS
    CM -->|"gRPC Watch stream"| API
    CM <-->|"Read/write leases"| DDB
    SCH <-->|"Read state"| DDB
    SCH -->|"Consume task queue"| NATS
    SCH -->|"gRPC assign task"| NS1
    SCH -->|"gRPC assign task"| NS2

    NS1 -->|"Spawn / manage"| AR1
    NS1 -->|"Spawn / manage"| AR2
    NS2 -->|"Spawn / manage"| AR3

    AR1 -->|"gRPC status update"| CM
    AR2 -->|"gRPC status update"| CM
    AR3 -->|"gRPC status update"| CM
    AR1 <-->|"LLM API calls"| LLM
    AR2 <-->|"LLM API calls"| LLM
    AR3 <-->|"LLM API calls"| LLM
    AR1 -->|"Tool calls"| TOOLS
    AR1 -->|"Write checkpoint"| S3
    AR2 -->|"Write checkpoint"| S3
    AR3 -->|"Write checkpoint"| S3
    AR1 <-->|"Read secrets"| SM

    API -->|"Scrape /metrics"| PROM
    CM -->|"Scrape /metrics"| PROM
    SCH -->|"Scrape /metrics"| PROM
    NS1 -->|"Scrape /metrics"| PROM
    PROM -->|"Visualize"| GRAF
    AR1 -->|"Traces"| OT
    AR2 -->|"Traces"| OT

    classDef controlPlane fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#1e3a8a
    classDef dataPlane fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
    classDef storage fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#4c1d95
    classDef external fill:#fce7f3,stroke:#be185d,stroke-width:2px,color:#831843
    classDef observ fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef user fill:#f0f9ff,stroke:#0369a1,stroke-width:2px,color:#0c4a6e

    class API,CM,SCH controlPlane
    class NS1,NS2,AR1,AR2,AR3 dataPlane
    class DDB,S3,NATS storage
    class LLM,TOOLS,SM external
    class PROM,GRAF,OT observ
    class CLI,SDK,CI user
```

---

## Reconciliation Loop

The core control loop — how the system self-heals:

```mermaid
sequenceDiagram
    actor User
    participant API as nous-api-server
    participant DDB as DynamoDB
    participant NATS as NATS JetStream
    participant CM as nous-controller-manager
    participant NS as nous-node-supervisor

    User->>API: POST /agentdefinitions<br/>(researcher, desiredInstances: 2)
    API->>DDB: PutItem (attribute_not_exists condition)
    DDB-->>API: OK, resource_version: 01JCXZ...
    API->>NATS: Publish ADDED event
    API-->>User: 201 Created

    Note over CM: Watch stream receives ADDED event
    NATS-->>CM: WatchEvent{ADDED, AgentDefinition}
    CM->>CM: Enqueue "default/researcher"

    Note over CM: Worker dequeues and reconciles
    CM->>API: GetAgentDefinition(default/researcher)
    API->>DDB: GetItem
    DDB-->>API: {spec.scaling.desired: 2}
    API-->>CM: AgentDefinition

    CM->>API: ListAgentInstances(agentDefinition=researcher)
    API->>DDB: Query GSI2
    DDB-->>API: [] (empty)
    API-->>CM: [] instances

    Note over CM: desired=2, actual=0 → scale up 2
    CM->>API: CreateAgentInstance(researcher-abc)
    CM->>API: CreateAgentInstance(researcher-def)

    Note over NS: Node supervisor picks up new instances
    CM-->>NS: AgentInstance created → spawn agent
    NS-->>CM: gRPC status update (phase=Ready)

    CM->>API: UpdateAgentDefinitionStatus<br/>(ready=2, desired=2, available=True)
    API->>DDB: PutItem (resource_version condition)
```

---

## Leader Election & Fencing

How split-brain is prevented across multiple controller-manager replicas:

```mermaid
sequenceDiagram
    participant CM1 as Controller-Manager<br/>Replica 1
    participant CM2 as Controller-Manager<br/>Replica 2
    participant DDB as DynamoDB<br/>(nous-leases table)
    participant API as nous-api-server

    Note over CM1,CM2: Both replicas start simultaneously

    CM1->>DDB: PutItem LEASE#controller-manager<br/>condition: attribute_not_exists OR expired
    DDB-->>CM1: OK (FenceToken: 1234567890000)

    CM2->>DDB: PutItem LEASE#controller-manager<br/>condition: attribute_not_exists OR expired
    DDB-->>CM2: ConditionCheckFailed — CM1 holds lease

    Note over CM1: CM1 is now the leader
    CM1->>CM1: Start reconciliation loop<br/>context derived from lease

    loop Every renewTTL (5s)
        CM1->>DDB: UpdateItem condition: HolderID = "cm1"
        DDB-->>CM1: OK — lease renewed
    end

    Note over CM1: Network partition — CM1 can't renew
    CM1-xDDB: UpdateItem (timeout)
    CM1->>CM1: Cancel leading context<br/>Stop reconciliation immediately

    Note over CM2: Lease expires after TTL (15s)
    CM2->>DDB: PutItem LEASE#controller-manager<br/>condition: expired
    DDB-->>CM2: OK (FenceToken: 1234567892000)

    Note over CM2: CM2 becomes new leader with higher FenceToken
    CM2->>API: CreateAgentInstance with FenceToken: 1234567892000
    API->>DDB: PutItem with condition: FenceToken <= 1234567892000
    DDB-->>API: OK

    Note over CM1: Stale CM1 attempts write (after reconnect)
    CM1->>API: Write with old FenceToken: 1234567890000
    API->>DDB: PutItem with condition: FenceToken <= 1234567890000
    DDB-->>API: ConditionCheckFailed (stored: 1234567892000)
    API-->>CM1: ErrStaleFence — write rejected
```

---

## DynamoDB Single-Table Design

The storage layout — one table, multiple resource types:

```mermaid
graph LR
    subgraph Table["DynamoDB: nous-state"]
        subgraph PKDefault["PK: NS#default"]
            AD1["SK: AGENTDEF#researcher<br/>─────────────────<br/>GSI1PK: NS#default#AGENTDEF<br/>GSI1SK: 1706000000000#researcher<br/>─────────────────<br/>ResourceVersion: 01JCXZ...<br/>Data: {spec, status JSON}"]
            AD2["SK: AGENTDEF#analyst<br/>─────────────────<br/>GSI1PK: NS#default#AGENTDEF<br/>GSI1SK: 1706000001000#analyst<br/>─────────────────<br/>Data: {...}"]
            AT1["SK: AGENTTASK#report-001<br/>─────────────────<br/>GSI1PK: NS#default#AGENTTASK<br/>GSI1SK: 1706000002000#report-001<br/>GSI2PK: NS#default#AGENTDEF#researcher<br/>GSI2SK: TASK#Running#1706000002000<br/>─────────────────<br/>Data: {...}"]
            AI1["SK: AGENTINST#researcher-abc<br/>─────────────────<br/>GSI1PK: NS#default#AGENTINST<br/>GSI2PK: NS#default#AGENTDEF#researcher<br/>GSI2SK: INST#Ready#1706000003000<br/>─────────────────<br/>FenceToken: 1234567890000<br/>Data: {...}"]
        end
        subgraph PKProd["PK: NS#production"]
            AD3["SK: AGENTDEF#translator<br/>Data: {...}"]
        end
        subgraph PKLease["PK: LEASE#controller-manager"]
            L1["SK: SINGLETON<br/>─────────────────<br/>HolderID: cm-abc123<br/>LeaseExpiry: 2026-02-21T...<br/>FenceToken: 1234567890000"]
        end
    end

    subgraph GSI1["GSI1: List by type"]
        G1["GSI1PK: NS#default#AGENTDEF<br/>→ Returns all AgentDefinitions<br/>sorted by creation time"]
        G2["GSI1PK: NS#default#AGENTTASK<br/>→ Returns all AgentTasks<br/>sorted by creation time"]
    end

    subgraph GSI2["GSI2: Filter by parent"]
        G3["GSI2PK: NS#default#AGENTDEF#researcher<br/>GSI2SK begins_with INST#Ready<br/>→ Returns Ready instances of researcher"]
        G4["GSI2PK: NS#default#AGENTDEF#researcher<br/>GSI2SK begins_with TASK#Running<br/>→ Returns Running tasks of researcher"]
    end

    AD1 -.->|"listed via"| G1
    AT1 -.->|"listed via"| G2
    AI1 -.->|"listed via"| G3
    AT1 -.->|"listed via"| G4
```

---

## Component Dependency DAG

How the repositories relate to each other — compile-time vs runtime:

```mermaid
graph TB
    subgraph Contracts["Contract Layer (Leaf — zero outbound deps)"]
        PROTO["<b>nous-proto</b><br/>Protobuf v3 definitions<br/>Generated Go stubs"]
    end

    subgraph CP["Control Plane"]
        API["<b>nous-api-server</b><br/>gRPC + REST<br/>DynamoDB storage"]
        CM["<b>nous-controller-manager</b><br/>Reconciliation loops<br/>Leader election"]
        SCH["<b>nous-scheduler</b><br/>Multi-objective<br/>Task assignment"]
    end

    subgraph DP["Data Plane"]
        NS["<b>nous-node-supervisor</b><br/>Per-node daemon<br/>Agent lifecycle"]
        AR["<b>nous-agent-runtime</b><br/>LLM execution<br/>Cognitive state"]
    end

    subgraph Infra["Infrastructure & Docs"]
        INFRA["<b>nous-infra</b><br/>Pulumi TypeScript<br/>AWS deployment"]
        DOCS["<b>nous-docs</b><br/>This site"]
    end

    PROTO -.->|"go.mod dep<br/>(buf generate)"| API
    PROTO -.->|"go.mod dep<br/>(buf generate)"| CM
    PROTO -.->|"go.mod dep<br/>(buf generate)"| SCH
    PROTO -.->|"go.mod dep<br/>(buf generate)"| NS
    PROTO -.->|"go.mod dep<br/>(buf generate)"| AR

    API -->|"gRPC Watch<br/>(runtime only)"| CM
    API -->|"NATS events<br/>(runtime only)"| SCH
    SCH -->|"gRPC assign<br/>(runtime only)"| NS
    NS -->|"process spawn<br/>(runtime only)"| AR
    AR -->|"gRPC status<br/>(runtime only)"| CM

    INFRA -.->|"deploys"| API
    INFRA -.->|"deploys"| CM
    INFRA -.->|"deploys"| SCH
    INFRA -.->|"deploys"| NS
    INFRA -.->|"deploys"| AR

    DOCS -.->|"documents"| API
    DOCS -.->|"documents"| CM

    classDef proto fill:#f3e8ff,stroke:#7c3aed,color:#4c1d95,stroke-width:3px
    classDef cp fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:2px
    classDef dp fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px
    classDef infra fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px

    class PROTO proto
    class API,CM,SCH cp
    class NS,AR dp
    class INFRA,DOCS infra

    linkStyle 0,1,2,3,4 stroke:#7c3aed,stroke-dasharray:5 5
    linkStyle 5,6,7,8,9 stroke:#1d4ed8,stroke-width:2px
    linkStyle 10,11,12,13,14 stroke:#16a34a,stroke-dasharray:5 5
```

!!! warning "Critical Rule"
    Dashed arrows = compile-time Go module dependency
    Solid arrows = runtime-only gRPC/NATS communication
    **No service ever imports another service's Go module.** Proto contracts are the only shared code.

---

## Request Flow: nousctl apply

End-to-end request flow for `nousctl apply -f researcher.yaml`:

```mermaid
flowchart TD
    A([User: nousctl apply -f researcher.yaml]) --> B{HTTP or gRPC?}
    B -->|HTTP POST /apis/...| C[Parse YAML body]
    B -->|gRPC CreateAgentDefinition| D[Validate proto message]
    C --> D

    D --> E{Validation}
    E -->|Invalid| F[Return 400 Bad Request]
    E -->|Valid| G[Generate UID + resource_version ULID]

    G --> H[StateStore.CreateAgentDefinition]
    H --> I{DynamoDB PutItem<br/>attribute_not_exists PK}
    I -->|Conflict — already exists| J[Return ErrExists → 409 Conflict]
    I -->|Success| K[Publish WatchEvent: ADDED]

    K --> L[In-memory broadcaster fans out]
    L --> M[Controller Watch stream receives event]
    K --> N[Return AgentDefinition to client]

    M --> O[WorkQueue.Add 'default/researcher']
    O --> P[Worker dequeues key]
    P --> Q[AgentController.Reconcile]
    Q --> R[GetAgentDefinition]
    Q --> S[ListAgentInstances]
    R & S --> T{Diff desired vs actual}

    T -->|scale up needed| U[CreateAgentInstance x N]
    T -->|scale down needed| V[Delete excess instances]
    T -->|balanced| W[Update status only]

    U & V & W --> X[UpdateAgentDefinitionStatus]
    X --> Y[RequeueAfter reconcileInterval]

    style A fill:#e0f2fe,stroke:#0284c7
    style N fill:#dcfce7,stroke:#16a34a
    style F fill:#fee2e2,stroke:#dc2626
    style J fill:#fee2e2,stroke:#dc2626
```

---

## State Machine: AgentInstance Phases

How an agent instance transitions through its lifecycle:

```mermaid
stateDiagram-v2
    [*] --> Pending: CreateAgentInstance

    Pending --> Starting: node-supervisor picks up instance
    Pending --> Failed: timeout / no node available

    Starting --> Ready: agent process healthy
    Starting --> Failed: startup error / crash loop

    Ready --> Running: task assigned
    Ready --> Terminating: scale-down

    Running --> Ready: task completed
    Running --> Failed: task panic / OOM / cost exceeded
    Running --> Terminating: scale-down while running

    Terminating --> [*]: graceful shutdown complete
    Failed --> Pending: RecoveryController retries
    Failed --> [*]: max retries exceeded

    note right of Ready
        Heartbeat monitored
        Quality score tracked
        Cognitive state checkpointed
    end note

    note right of Running
        Active LLM calls
        Tool invocations
        Cost accumulation
    end note
```

---

## Watch API: Phase 1 vs Phase 2

How the Watch API evolves from single-instance to distributed:

```mermaid
graph TB
    subgraph Phase1["Phase 1 — In-Memory Broadcaster"]
        subgraph API1["nous-api-server (single instance)"]
            H1["gRPC Handler"] -->|write| S1["StateStore<br/>(DynamoDB)"]
            H1 -->|publish| B1["In-Memory Broadcaster<br/>(buffered channels)"]
            B1 -->|fan-out| W1["Watch Client 1<br/>(controller-manager)"]
            B1 -->|fan-out| W2["Watch Client 2<br/>(dashboard)"]
        end
        note1["Limitation: Not durable.<br/>API server restart drops all Watch connections.<br/>Clients must reconnect and relist."]
    end

    subgraph Phase2["Phase 2 — NATS JetStream (Durable)"]
        subgraph API2A["API Server Instance A"]
            H2A["gRPC Handler"] -->|write| DDB["DynamoDB"]
            DDB -->|DynamoDB Streams| L["Lambda<br/>Fanout"]
            L -->|publish| NATS["NATS JetStream<br/>Subject: nous.watch.*"]
        end
        subgraph API2B["API Server Instance B"]
            H2B["gRPC Handler"] -->|write| DDB
        end
        NATS -->|durable subscribe| W3["Controller Manager"]
        NATS -->|durable subscribe| W4["Dashboard"]
        note2["Durable: Replay from any resource_version.<br/>Multi-instance API servers supported.<br/>Survives restarts."]
    end
```
