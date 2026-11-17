# counters

[![License](https://img.shields.io/badge/Licence-Apache%202.0-blue.svg)](https://github.com/synadia-io/orbit.js/blob/main/LICENSE)
[![JSR](https://jsr.io/badges/@synadiaorbit/counters)](https://jsr.io/@synadiaorbit/counters)
[![JSR Score](https://jsr.io/badges/@synadiaorbit/counters/score)](https://jsr.io/@synadiaorbit/counters)
[![NPM Version](https://img.shields.io/npm/v/%40synadiaorbit%2Fcounters)](https://www.npmjs.com/package/@synadiaorbit/counters)
[![NPM Downloads](https://img.shields.io/npm/dt/%40synadiaorbit%2Fcounters)](https://www.npmjs.com/package/@synadiaorbit/counters)

JetStream Counters

NATS server 2.12 introduced a JetStream counter feature that enables efficient
counter CRDT (Conflict-free Replicated Data Type) operations that are order
independent. A stream is set up for counters by enabling its `allow_msg_counter`
and `allow_direct` options. Counter streams can only be used for counter
operations, but can be aggregated and distributed across clusters and
super-clusters.

## Installation

```bash
# node, bun (esm and commonjs)
npm install @synadiaorbit/counters

# deno
deno add jsr:@synadiaorbit/counters
```

The npm package works with `import` and `require`, and requires Node.js 22 or
later.

```typescript
import { NewCounter } from "@synadiaorbit/counters";
```

## Usage

The examples connect to the shared `demo.nats.io` server with `wsconnect`, which
works in every runtime; any nats.js transport works too, see
[runtimes](https://github.com/nats-io/nats.js/blob/main/runtimes.md). Each one
creates a stream of its own and deletes it when it is done.

### Stream Setup

Counters need a stream with `allow_msg_counter` and `allow_direct` enabled; both
options are required:

```typescript
await jsm.streams.add({
  name: "counters",
  subjects: ["counters.>"],
  allow_msg_counter: true,
  allow_direct: true,
});
```

Counter streams reserve the payload of a message to maintain the counter values,
so only counter operations are allowed on the stream. Messages expire with the
stream's `max_age`, but the stream itself stays until it is deleted.

### Basic Counter Operations

```typescript
import { nanos, nuid, wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import { NewCounter } from "@synadiaorbit/counters";

const nc = await wsconnect({ servers: "wss://demo.nats.io:8443" });
const jsm = await jetstreamManager(nc);

// a stream of its own on the shared demo server; max_age expires the
// messages, and the finally block deletes the stream
const stream = `counters_${nuid.next()}`;
await jsm.streams.add({
  name: stream,
  subjects: [`${stream}.>`],
  allow_msg_counter: true,
  allow_direct: true,
  max_age: nanos(2 * 60 * 1000),
});

try {
  const counters = NewCounter(nc, stream);
  const logins = `${stream}.user_logins`;

  // Increment a counter
  const newValue = await counters.increment(logins, 1);
  console.log(`counter value: ${newValue}`);

  await counters.increment(logins, 100);

  // Get current counter value
  const currentValue = await counters.value(logins);
  console.log(`current value: ${currentValue}`);

  // Get counter with metadata
  const counter = await counters.getCounter(logins);
  if (counter) {
    console.log(`Value: ${counter.value}`);
    console.log(`Delta: ${counter.delta}`);
    console.log(`Subject: ${counter.subject}`);
    console.log(`Sequence: ${counter.seq}`);
    console.log(`Timestamp: ${counter.timestamp}`);
    console.log(`Time: ${counter.time}`);
  }
} finally {
  await jsm.streams.delete(stream);
  await nc.close();
}
```

### Batch Operations

```typescript
import { nanos, nuid, wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import { NewCounter } from "@synadiaorbit/counters";

const nc = await wsconnect({ servers: "wss://demo.nats.io:8443" });
const jsm = await jetstreamManager(nc);

// a stream of its own on the shared demo server; max_age expires the
// messages, and the finally block deletes the stream
const stream = `counters_${nuid.next()}`;
await jsm.streams.add({
  name: stream,
  subjects: [`${stream}.>`],
  allow_msg_counter: true,
  allow_direct: true,
  max_age: nanos(2 * 60 * 1000),
});

try {
  const counters = NewCounter(nc, stream);
  await counters.increment(`${stream}.logins`, 10);
  await counters.increment(`${stream}.errors`, 2);

  // Get multiple counter values using wildcards
  const vals = await counters.values(`${stream}.*`);
  for await (const value of vals) {
    console.log(`Counter value: ${value}`);
  }

  // Get multiple counters with metadata
  const counterObjects = await counters.getCounters([
    `${stream}.logins`,
    `${stream}.errors`,
    `${stream}.missing`,
  ]);
  for await (const counter of counterObjects) {
    console.log(`${counter.subject}: ${counter.value} (seq: ${counter.seq})`);
  }
} finally {
  await jsm.streams.delete(stream);
  await nc.close();
}
```

Counters that don't exist are skipped. If none of the names match a counter,
iterating rejects with a `no results` error.

### Historical Values

```typescript
import { nanos, nuid, wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import { NewCounter } from "@synadiaorbit/counters";

const nc = await wsconnect({ servers: "wss://demo.nats.io:8443" });
const jsm = await jetstreamManager(nc);

// a stream of its own on the shared demo server; max_age expires the
// messages, and the finally block deletes the stream
const stream = `counters_${nuid.next()}`;
await jsm.streams.add({
  name: stream,
  subjects: [`${stream}.>`],
  allow_msg_counter: true,
  allow_direct: true,
  max_age: nanos(2 * 60 * 1000),
});

try {
  const counters = NewCounter(nc, stream);
  const logins = `${stream}.user_logins`;
  await counters.increment(logins, 1); // stored at sequence 1
  await counters.increment(logins, 100);

  // Get a counter value at a specific sequence number
  const historicalValue = await counters.value(logins, 1);
  console.log(`Value at sequence 1: ${historicalValue}`);

  // Get counter with metadata at a specific sequence
  const historicalCounter = await counters.getCounter(logins, 1);
  if (historicalCounter) {
    console.log(`Historical delta: ${historicalCounter.delta}`);
  }
} finally {
  await jsm.streams.delete(stream);
  await nc.close();
}
```

## API Reference

### `NewCounter(nc: NatsConnection, stream: string, opts?: JetStreamOptions): Counters`

Creates a new counter client instance.

### `Counters` Interface

- `increment(name: string, delta: bigint | number): Promise<bigint>` - Increment
  a counter with the specified delta, returns the new value
- `value(name: string, seq?: number): Promise<bigint | null>` - Get counter
  value (optionally at a specific sequence)
- `getCounter(name: string, seq?: number): Promise<Counter | null>` - Get
  counter with metadata
- `values(names: string[] | string): Promise<QueuedIterator<bigint>>` - Get
  multiple values (supports wildcards)
- `getCounters(names: string | string[]): Promise<QueuedIterator<Counter>>` -
  Get multiple counters with metadata

### `Counter` Class

Properties available on counter objects:

- `value: bigint` - The current counter value
- `delta: bigint` - The increment/decrement amount for this revision
- `sources: CounterSources` - For a counter that aggregates other counters
  through stream sources, the last value seen from each source, keyed by source
  stream and then by the subject in that source. Empty for a counter that isn't
  sourced
- `stream: string` - The JetStream stream name
- `subject: string` - The counter name/subject
- `seq: number` - The sequence number in the stream
- `timestamp: string` - The timestamp as a string
- `time: Date` - The timestamp as a Date object

## Features

- **Atomic Operations**: All counter operations are atomic through JetStream
- **Historical Access**: Retrieve counter values at any previous sequence
- **Batch Operations**: Efficiently retrieve multiple counters at once
- **Wildcard Support**: Use NATS subject wildcards in batch operations
- **Metadata Access**: Get detailed information about each counter update

## License

Apache License 2.0
