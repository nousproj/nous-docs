# ADR-001: Standalone Control Plane Over Kubernetes Operator

**Status**: Accepted

**Date**: 2026-02-14

---

## Context

Nous is an AI agent orchestration system that needs to manage agent lifecycles at scale. Two architectural approaches were considered:

1. **Kubernetes Operator** — Build a custom operator using controller-runtime, deploy on Kubernetes, use etcd for state
2. **Standalone Control Plane** — Build an independent control plane inspired by Kubernetes patterns but not coupled to Kubernetes

The decision impacts runtime flexibility, operational complexity, and the ability to manage agents across diverse environments (ECS, Lambda, edge devices).

---

## Decision

We will build Nous as a **standalone control plane**, NOT a Kubernetes operator.

**Rationale**: While Kubernetes provides excellent infrastructure patterns (declarative resources, reconciliation loops, self-healing), container orchestration patterns don't map 1:1 to cognitive workloads. Agents require runtime independence and cannot be tightly coupled to Kubernetes.

---

## Rationale

### Why Standalone Wins

#### 1. Runtime Independence
- **Requirement**: Manage agents across ECS, AWS Lambda, VMs, edge devices — not just Kubernetes pods
- **K8s Operator**: Locked into Kubernetes runtime (requires etcd, kubelet, container runtime)
- **Standalone**: Runtime-agnostic — works with any execution environment

#### 2. Cognitive State Doesn't Fit etcd
- **Requirement**: Agents have large cognitive state (conversation context, reasoning history) that grows unbounded
- **K8s Operator**: etcd has 1.5 MB object size limit, not designed for large blobs
- **Standalone**: Use S3 for cognitive state, DynamoDB for metadata

#### 3. Custom Scheduling Needs
- **Requirement**: Multi-objective scheduling (cost vs quality vs latency trade-offs)
- **K8s Operator**: kube-scheduler is optimized for bin packing (CPU/memory/GPU), extending it for agent-specific metrics is complex
- **Standalone**: Build custom scheduler with agent-specific logic (quality floor, cost ceiling, context utilization)

#### 4. No controller-runtime Dependency
- **K8s Operator**: Requires `sigs.k8s.io/controller-runtime` (275K LoC dependency)
- **Standalone**: Implement minimal reconciliation loops ourselves (full control, no bloat)

#### 5. Deployment Flexibility
- **K8s Operator**: Requires Kubernetes cluster (EKS, GKE, on-prem) — operational overhead
- **Standalone**: Deploy control plane on ECS, run agents anywhere

---

## Consequences

### Positive

- ✅ **Runtime flexibility**: Manage agents on ECS, Lambda, VMs, edge — not locked into K8s
- ✅ **Simplified operations**: No Kubernetes cluster required for control plane
- ✅ **Custom scheduling**: Full control over scheduling algorithm (cost, quality, latency)
- ✅ **Storage optimized for agents**: DynamoDB for metadata, S3 for cognitive state
- ✅ **Smaller codebase**: No controller-runtime dependency (build only what we need)

### Negative

- ❌ **Reinvent reconciliation**: Must build our own controllers (no free ride from controller-runtime)
- ❌ **No kubectl**: Cannot use `kubectl` CLI (must build our own CLI or use grpcurl)
- ❌ **No Helm ecosystem**: Cannot leverage Helm charts for deployment

### Mitigation

- Reinventing reconciliation is acceptable because the controller pattern is well-understood (watch, reconcile, requeue)
- Build a custom CLI (`nousctl`) for Phase 3
- Use Pulumi for deployment automation (better than Helm for multi-cloud)

---

## Alternatives Considered

### Alternative 1: Kubernetes Operator with CRDs

**Approach**: Build a K8s operator with Custom Resource Definitions (AgentDefinition, AgentTask, AgentInstance).

**Pros**:
- Leverage controller-runtime (battle-tested reconciliation framework)
- Use kubectl for debugging
- etcd provides watch API for free

**Cons**:
- Locked into Kubernetes (cannot manage Lambda-based agents)
- etcd size limits (1.5 MB) unsuitable for cognitive state
- Operational overhead (requires EKS cluster)
- kube-scheduler not designed for agent-specific metrics

**Verdict**: Rejected — Runtime lock-in is unacceptable.

---

### Alternative 2: Kubernetes Operator + Out-of-Cluster Agents

**Approach**: Build a K8s operator but allow it to manage agents running outside Kubernetes (e.g., Lambda).

**Pros**:
- Get controller-runtime benefits
- Support external runtimes

**Cons**:
- Awkward architecture (K8s cluster managing non-K8s workloads)
- Still requires Kubernetes cluster for control plane
- Complexity of bridging K8s API to external systems

**Verdict**: Rejected — Adds complexity without solving the runtime lock-in problem.

---

### Alternative 3: Hybrid (K8s for Control Plane, Standalone Agents)

**Approach**: Run control plane services (API server, scheduler, controllers) on Kubernetes, but agents run anywhere.

**Pros**:
- Kubernetes handles control plane resilience
- Agents can run on any platform

**Cons**:
- Requires Kubernetes cluster for control plane (operational overhead)
- Mismatch: K8s is for container orchestration, not control plane hosting

**Verdict**: Rejected — If we're building a standalone control plane anyway, no need for K8s.

---

## Implementation Notes

### What We Keep from Kubernetes

- **Declarative Resources**: AgentDefinition, AgentTask, AgentInstance (Kubernetes-style spec/status split)
- **Reconciliation Pattern**: Controllers watch desired state, reconcile to actual state
- **Namespaces**: Multi-tenancy isolation
- **Labels/Annotations**: Metadata for filtering and organization
- **Owner References**: Hierarchical resource relationships (AgentDefinition owns AgentInstances)

### What We Discard

- **etcd**: Use DynamoDB instead (better for large objects, serverless)
- **controller-runtime**: Build custom controllers (smaller, tailored)
- **Pods/Deployments**: Use AgentInstances (different semantics for agents)
- **kubelet**: Use node-supervisor (agent-specific process management)

---

## References

- CLAUDE.md: "Architecture Decision: Standalone control plane (NOT a Kubernetes operator)" (line 15)
- [system-architecture.md](../architecture/system-architecture.md) — Nous vs Kubernetes comparison
- Kubernetes Patterns (O'Reilly) — Declarative deployment, reconciliation loops

---

**Decision made by**: Architecture Team
**Last reviewed**: 2026-02-15
