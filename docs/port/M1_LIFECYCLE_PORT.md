# M1 — Lifecycle Port

Status: `IMPLEMENTED_AT_CODE_STRUCTURE / NOT_RUNTIME_VALIDATED`

The original Kumo state machine and task-store responsibilities have now been ported into the BNB implementation surface.

## Preserved

- explicit task state transitions;
- explicit Execution Pod state transitions;
- durable-store responsibility as a coordinator boundary;
- task identity/status/requester indexing semantics;
- retry path after failed execution.

## Changed deliberately

### Preparation is not approval

BNB Kumo introduces:

```text
posted / claimed
→ prepared
→ approved
→ executing
```

This prevents a recommendation/preflight step from implicitly authorizing financial execution.

### Persistence is an interface

The original coordinator invoked a local `sqlite3` binary directly. The BNB port keeps a `TaskStore` interface and ships an in-memory implementation only as a development fixture. A durable production adapter remains required.

### Revalidation is explicit

A `PreparedAction` binds:

- task and agent;
- exact input root;
- market snapshot root;
- evidence snapshot root;
- policy fingerprint;
- expiry.

If the world/evidence state changes before activation, the current minimal gate refuses with `MARKET_DRIFT` or `EVIDENCE_DRIFT`; it does not execute stale preparation.

## Evidence maturity

These files are implementation evidence only. Build/typecheck/runtime proof has not yet been produced in the EBI environment.
