# resumability

Five-step research job (plan → gather → synthesize → critique →
finalize) that checkpoints after every step. Crash mid-flight,
resume on next invocation, no work lost.

## Before ARCP

Long jobs survive crashes only if the team built their own
checkpoint store, retry contract, and dedupe layer. Most don't.
Crash means restart; restart means re-spending tokens; "did this
already run?" turns into a SQL detective story.

## With ARCP

```ts
// every step ends with two envelopes
await emitProgress(client, { jobId, step: "synthesize" });
await emitCheckpoint(client, { jobId, step: "synthesize" });

// resume picks up at the step *after* the last checkpoint
const last = await issueResume(client, { jobId, afterMessageId, checkpointId });
const nextIdx = STEPS.indexOf(last) + 1;
```

Per-step `idempotency_key` keeps execution single across retries:
the runtime returns the prior outcome if the same step is re-issued.

## Try it

```bash
# crash after `synthesize`. Prints the resume token.
CRASH_AFTER_STEP=synthesize node --import tsx examples/resumability/main.ts

# resume — runtime replays up to the last checkpoint, we run from
# the next step.
RESUME_JOB_ID=...  RESUME_AFTER_MSG_ID=...  RESUME_CHECKPOINT_ID=... \
  node --import tsx examples/resumability/main.ts
```

## ARCP primitives

- Resumability — RFC §19, `after_message_id` + `checkpoint_id`.
- Job lifecycle + checkpoints — §10.
- `idempotency_key` semantics — §6.4.
- `DATA_LOSS` on retention expiry — §19, §18.2.

## File tour

- `main.ts` — `start_fresh` vs `resume`. `process.exit` on the crash
  step to demonstrate process death.
- `steps.ts` — step body stub.

## Variations

- Plug a checkpointer that doubles to a SQLite store so checkpoints
  survive ARCP retention expiry too.
- Branch on critique severity: low → finalize; high → loop back to
  synthesize with the critique appended.
- Emit `kind: thought` between steps for
  [reasoning_streams](../reasoning_streams) to consume.
