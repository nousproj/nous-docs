# Contributing to Nous

## Repository Layout

Each repository is an independent Git repo under the `nousproj` GitHub organization:

```
nousproj/
├── nous-proto/
├── nous-api-server/
├── nous-controller-manager/
├── nous-scheduler/
├── nous-node-supervisor/
├── nous-agent-runtime/
├── nous-infra/
└── nous-docs/
```

## Local Development Setup

```bash
# Clone all repos
for repo in nous-proto nous-api-server nous-controller-manager nous-docs; do
  git clone https://github.com/nousproj/$repo
done

# Set up Go workspace (allows cross-repo imports without replace directives)
cd nousproj
go work init
go work use ./nous-proto ./nous-api-server ./nous-controller-manager

# Start local infrastructure
cd nous-api-server
make docker-up

# Run tests across all Go repos
for repo in nous-api-server nous-controller-manager; do
  cd $repo && go test ./... -race && cd ..
done
```

## Code Conventions

- **Go version**: 1.22+
- **Formatting**: `gofmt` — no exceptions
- **Linting**: `golangci-lint run` must pass clean
- **Errors**: always wrap with context: `fmt.Errorf("doing X: %w", err)`
- **Logging**: `slog` only — no `fmt.Println` in production code
- **Context**: pass `context.Context` as first parameter everywhere
- **Tests**: table-driven tests, interface mocks for external deps

## Dependency Rules

!!! danger "Critical Rules"
    1. **Never import another service's Go module.** Only `nous-proto` is a shared Go dependency.
    2. **Never commit `go.work` files.** Add to `.gitignore` in each repo.
    3. **Never use `replace` directives in committed `go.mod`.** Use `go.work` locally.

## Proto Changes

When modifying `nous-proto`:

```bash
# 1. Edit .proto files in nous-proto/
# 2. Verify buf lint
cd nous-proto && buf lint

# 3. Regenerate stubs locally (for testing)
buf generate

# 4. In each consumer repo, regenerate
cd nous-api-server && make proto-gen
cd nous-controller-manager && make proto-gen
```

## Pull Request Process

1. Open PR against the relevant repo (e.g., `nous-api-server`)
2. All checks must pass: `go build ./...`, `go test ./... -race`, `golangci-lint run`
3. Proto changes require updating all consumer repo stubs in separate PRs

## Architecture Decisions

Major decisions are documented as Architecture Decision Records (ADRs) in `nous-docs/adr/`. If you're introducing a new technology, changing the storage model, or altering cross-repo communication patterns — open an ADR first.

ADR format:
```markdown
# ADR-NNN: Title

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
Why this decision is needed.

## Decision
What we decided.

## Consequences
Trade-offs — both positive and negative.
```
