# nous-infra

> **Phase 1** — Pulumi stacks planned after all services are validated in docker-compose.

Infrastructure as code for the Nous platform on AWS. Written in Pulumi TypeScript.

## Stack Layout

```
nous-infra/
├── stacks/
│   ├── shared/          # VPC, networking, security groups
│   ├── state-store/     # DynamoDB tables, S3 bucket
│   ├── messaging/       # NATS JetStream (ECS)
│   └── control-plane/   # ECS cluster, task definitions, IAM roles
└── docker-compose.yml   # Local development environment
```

## DynamoDB Tables

### `nous-state` (primary state store)

```typescript
const stateTable = new aws.dynamodb.Table("nous-state", {
    billingMode: "PAY_PER_REQUEST",
    hashKey: "PK",
    rangeKey: "SK",
    globalSecondaryIndexes: [
        { name: "GSI1", hashKey: "GSI1PK", rangeKey: "GSI1SK" },
        { name: "GSI2", hashKey: "GSI2PK", rangeKey: "GSI2SK" },
    ],
    streamEnabled: true,
    streamViewType: "NEW_AND_OLD_IMAGES",  // For Watch API (Phase 2)
    ttl: { attributeName: "TTL", enabled: true },
    pointInTimeRecovery: { enabled: true },
});
```

### `nous-leases` (leader election)

```typescript
const leasesTable = new aws.dynamodb.Table("nous-leases", {
    billingMode: "PAY_PER_REQUEST",
    hashKey: "PK",
    rangeKey: "SK",
    ttl: { attributeName: "TTL", enabled: true },
});
```

## Local Development

```yaml
# docker-compose.yml
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    ports: ["8000:8000"]

  nous-api-server:
    build: ../nous-api-server
    ports: ["31051:31051", "8080:8080", "9090:9090"]
    environment:
      NOUS_STORAGE_DRIVER: dynamodb
      NOUS_STORAGE_DYNAMODB_ENDPOINT: http://dynamodb-local:8000
      AWS_ACCESS_KEY_ID: dummy
      AWS_SECRET_ACCESS_KEY: dummy

  nous-controller-manager:
    build: ../nous-controller-manager
    environment:
      NOUS_APISERVER_ADDRESS: nous-api-server:31051
      NOUS_LEADERELECTION_ENABLED: "true"
      NOUS_LEADERELECTION_DYNAMODB_ENDPOINT: http://dynamodb-local:8000
```

## Cost Estimate

| Environment | DynamoDB | S3 | ECS | Monthly Total |
|-------------|----------|-----|-----|---------------|
| Development | ~$0.30 | ~$0.05 | $0 (local) | ~$0.35 |
| Staging | ~$5 | ~$1 | ~$20 | ~$26 |
| Production | ~$60 | ~$10 | ~$150 | ~$220 |

## Phase 1 Status

- [ ] `stacks/shared/` — VPC, networking
- [ ] `stacks/state-store/` — DynamoDB tables, S3 bucket
- [ ] `stacks/control-plane/` — ECS cluster and task definitions
- [ ] IAM roles with least-privilege policies
- [ ] `docker-compose.yml` for local development
- [ ] Pulumi stack outputs for service discovery

!!! note "Why Infra is Last"
    The Pulumi stacks codify what's been validated in docker-compose. Building infra before the services are working leads to drift and rework. Validate locally first, then codify in Pulumi.
