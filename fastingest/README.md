# fastingest

[![License](https://img.shields.io/badge/Licence-Apache%202.0-blue.svg)](https://github.com/synadia-io/orbit.js/blob/main/LICENSE)
[![JSR](https://jsr.io/badges/@synadiaorbit/fastingest)](https://jsr.io/@synadiaorbit/fastingest)
[![JSR Score](https://jsr.io/badges/@synadiaorbit/fastingest/score)](https://jsr.io/@synadiaorbit/fastingest/score)
[![NPM Version](https://img.shields.io/npm/v/%40synadiaorbit%2Ffastingest)](https://www.npmjs.com/package/@synadiaorbit/fastingest)
[![NPM Downloads](https://img.shields.io/npm/dt/%40synadiaorbit%2Ffastingest)](https://www.npmjs.com/package/@synadiaorbit/fastingest)

High-throughput batch publish to NATS JetStream. Re-exports the fast-ingest API
from `@nats-io/jetstream/internal` as a stable orbit surface while the upstream
API is still considered internal.

> Status: incubating. The underlying protocol is stable; the client API shape is
> still being explored. Once it settles upstream, this module becomes a thin
> shim or retires.

## Why

JetStream's regular publish waits for an ack on every message. The async form
overlaps in-flight publishes via `Promise.all([...])`, which doesn't raise the
sustainable rate — each publish still pays its round-trip — but removes the
shared brake: under concurrent producers some publishes fail and the client has
to guess at concurrency limits and retry.

Fast-ingest is the purpose-built alternative (specified in
[ADR-50](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-50.md)).
The client opens a batch and streams messages into it. The server acks the batch
periodically, not per-message, and **decides the pace** based on how busy the
stream is — speeding the client up when there's headroom, slowing it down when
there isn't.

The client sets two ceilings:

- **`ackInterval`** — the most messages the client wants the server to go
  between acks (bigger window = faster).
- **`maxOutstandingAcks`** — the most unacked windows the client allows before
  pausing (1–3, default 2).

Everything else is invisible. The library tracks the server's current cadence
and resizes the publish window for you. The application's only job is to **await
each `fi.add(...)`** — the promise resolves when the window has room and stalls
when it doesn't, so honoring it gives the producer the correct rate
automatically.

> **Don't fan out with `Promise.all([...])`.** Concurrent adds don't beat the
> rate — each call still waits its slot — and they defeat back-pressure, piling
> pending publishes in the caller for no throughput gain. Drive the loop in
> lockstep: await each `add()` before queuing more.

Result: many producers can push the same stream concurrently without overload,
and other JetStream operations on the stream (purge, delete, config change) stay
responsive.

The batch ends when the client calls `last()` (commit + store the final message)
or `end()` (commit, no final message).

### Gaps

Messages are stored as the server receives them — there is no rollback. The
caller chooses what happens if the server detects a gap in the batch sequence:

- `allowGaps: false` — server aborts the batch on the first gap. Messages before
  the gap stay stored. The caller can open a new batch and resume from the gap
  sequence.
- `allowGaps: true` — gaps are reported via `gaps()`; the batch keeps accepting
  new messages.

### When to reach for it

ADR-50 motivates fast-ingest as the replacement for async publish in
high-throughput producers, and calls out two concrete shapes:

- **Object Store writes**, where every chunk must land or the file is corrupt —
  use `allowGaps: false` so the server aborts on any gap and the caller can
  restart from the gap sequence. `@nats-io/obj` has an undocumented
  `allowBatched: true` opt-in on `Objm`'s `create()`/`open()` that routes chunk
  writes through fast-ingest with no other code changes — a quick way to try it
  on a real workload.
- **Fast metric publishers**, where occasional drops are acceptable — use
  `allowGaps: true` so the batch keeps moving and gaps are surfaced via `gaps()`
  for observability.

If a producer doesn't need that throughput tier, regular `js.publish()` remains
the right tool — fast-ingest is the bulk-ingest path, not a general publish
replacement.

## Server requirement

NATS server **2.14.0** or later. Older servers reject the `allow_batched` stream
config field.

## Stream requirement

The target stream must be created with `allow_batched: true`. Existing streams
must be updated to opt-in.

```ts
await jsm.streams.add({
  name: "orders",
  subjects: ["orders.>"],
  allow_batched: true,
});
```

`startFastIngest` rejects against a non-batched stream.

## Installation

```bash
# node, bun (esm and commonjs)
npm install @synadiaorbit/fastingest

# deno
deno add jsr:@synadiaorbit/fastingest
```

The npm package works with `import` and `require`, and requires Node.js 22 or
later. It is built for nats.js 3.5 (`@nats-io/nats-core` and
`@nats-io/jetstream`).

## API

### Creating a batch

```ts
function startFastIngest(
  nc: NatsConnection,
  subj: string, // first message subject
  payload: Payload | undefined, // first message payload
  opts: {
    allowGaps: boolean;
    ackInterval?: number;
    maxOutstandingAcks?: number;
    inboxPrefix?: string;
  } & Partial<JetStreamPublishOptions>,
  defaultTimeout?: number, // ms to wait for acks, default 5000
): Promise<FastIngest>;
```

`startFastIngest` publishes the first message of the batch and waits for the
server's initial flow-control ack. The fourth argument requires `allowGaps` and
accepts the rest of `FastIngestOptions` plus any `JetStreamPublishOptions`
(headers, `msgID`, expectations, etc.):

| option                   | meaning                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`allowGaps`**          | Required. `false` → first gap aborts the batch. `true` → gaps reported via `gaps()`, batch keeps accepting messages.                                                                                                                     |
| **`ackInterval`**        | Maximum messages the client lets the server go between acks. Higher = faster (longer publish window per ack). Server picks anywhere from `1` up to this max based on stream load. Default 10.                                            |
| **`maxOutstandingAcks`** | How many ack windows the client lets sit unacked before pausing. Effective in-flight messages = `ackInterval * maxOutstandingAcks`. Default 2; must be an integer from 1 to 3, other values are rejected with an `InvalidArgumentError`. |
| **`inboxPrefix`**        | Subject prefix for the batch's reply inbox. Default `_INBOX`.                                                                                                                                                                            |

```ts
const fi = await startFastIngest(nc, "orders.created", firstOrder, {
  allowGaps: false,
  ackInterval: 100,
});
```

Use the returned `FastIngest` to publish the rest and terminate.

### The FastIngest batch

```ts
type FastIngest = {
  readonly batch: string;
  add(
    subj: string,
    payload?: Payload,
    opts?: Partial<JetStreamPublishOptions>,
  ): Promise<FastIngestProgress>;
  last(
    subj: string,
    payload?: Payload,
    opts?: Partial<JetStreamPublishOptions>,
  ): Promise<BatchAck>;
  end(opts?: Partial<JetStreamPublishOptions>): Promise<BatchAck>;
  ping(timeout?: number): Promise<FastIngestProgress>;
  done(): Promise<BatchAck>;
  gaps(): AsyncIterable<{ lastSeq: number; seq: number }>;
};
```

- `batch` — the batch's unique id, generated by `startFastIngest`. Matches
  `BatchAck.batch` on the terminal ack.
- `add()` — publish a body message. Returns `FastIngestProgress` =
  `{ batchSeq, ackSeq }`, where `batchSeq` is this message's 1-based position in
  the batch (not its stream sequence) and `ackSeq` is the highest position the
  server has acked so far. The promise resolves only when the in-flight window
  has room — see [Why](#why).
- `last()` / `end()` — terminate the batch. Both resolve to a `BatchAck`
  containing the last stored stream sequence (`seq`) and the count of messages
  stored (`count`). `last()` stores the supplied final message; `end()` commits
  with no extra message.
- `ping()` — keep-alive. Returns a fresh `FastIngestProgress` direct from the
  server (vs `add()` which returns the client's cached view). Use when the
  producer might pause longer than the 10-second idle limit.
- `done()` — resolves with the terminal `BatchAck` regardless of how the batch
  ended; useful when the lifecycle is driven elsewhere.
- `gaps()` — async iterable yielding `{ lastSeq, seq }` for each missing range
  the server detected. Both fields are batch sequences. With `allowGaps: false`
  the server also aborts the batch on the first gap; with `allowGaps: true` it
  continues.

## Usage

The examples connect to the shared `demo.nats.io` server with `wsconnect`, which
works in every runtime; any nats.js transport works too, see
[runtimes](https://github.com/nats-io/nats.js/blob/main/runtimes.md). Each one
creates a stream of its own and deletes it when it is done: messages expire with
the stream's `max_age`, but the stream itself stays until it is deleted.

```ts
import { nanos, nuid, wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import { startFastIngest } from "@synadiaorbit/fastingest";

const nc = await wsconnect({ servers: "wss://demo.nats.io:8443" });
const jsm = await jetstreamManager(nc);

// a stream of its own on the shared demo server; max_age expires the
// messages, and the finally block deletes the stream
const stream = `orders_${nuid.next()}`;
await jsm.streams.add({
  name: stream,
  subjects: [`${stream}.>`],
  allow_batched: true,
  max_age: nanos(2 * 60 * 1000),
});

try {
  // serialized order events to replay
  const orders = Array.from(
    { length: 1000 },
    (_, i) => JSON.stringify({ id: i }),
  );

  const fi = await startFastIngest(nc, `${stream}.created`, orders[0], {
    allowGaps: false,
    ackInterval: 100,
  });

  for (let i = 1; i < orders.length - 1; i++) {
    await fi.add(`${stream}.created`, orders[i]);
  }

  // terminate with a final message — use `fi.end()` to commit without one
  const ack = await fi.last(`${stream}.created`, orders[orders.length - 1]);
  console.log(`stored ${ack.count} messages, last seq ${ack.seq}`);
} finally {
  await jsm.streams.delete(stream);
  await nc.close();
}
```

### Handling gaps

```ts
import { nanos, nuid, wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import { startFastIngest } from "@synadiaorbit/fastingest";

const nc = await wsconnect({ servers: "wss://demo.nats.io:8443" });
const jsm = await jetstreamManager(nc);

// a stream of its own on the shared demo server; max_age expires the
// messages, and the finally block deletes the stream
const stream = `metrics_${nuid.next()}`;
await jsm.streams.add({
  name: stream,
  subjects: [`${stream}.>`],
  allow_batched: true,
  max_age: nanos(2 * 60 * 1000),
});

try {
  // sampled metric lines
  const samples = Array.from({ length: 1000 }, (_, i) => `cpu ${i % 100}`);

  const fi = await startFastIngest(nc, `${stream}.cpu`, samples[0], {
    allowGaps: true,
  });

  (async () => {
    for await (const g of fi.gaps()) {
      console.warn(`lost samples between batchSeq ${g.lastSeq} and ${g.seq}`);
    }
  })();

  for (let i = 1; i < samples.length; i++) {
    await fi.add(`${stream}.cpu`, samples[i]);
  }
  const ack = await fi.end();
  console.log(`stored ${ack.count} samples`);
} finally {
  await jsm.streams.delete(stream);
  await nc.close();
}
```

### Keep-alive on slow producers

The server drops a batch that goes 10 seconds without traffic. If the producer
might pause mid-batch, call `ping()` on a shorter cadence to keep the batch open
and pull a fresh progress snapshot:

```ts
setInterval(() => fi.ping().catch(() => {}), 5_000);
```
