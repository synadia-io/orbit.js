# counters

jetstream counter streams

## Installation

### Deno/Web Browser

```typescript
import { Counters } from "jsr:@synadiaorbit/counters";
```

### Node.js

```bash
npm install @synadiaorbit/counters
```

```typescript
import { Counters } from "@synadiaorbit/counters";
```

## Usage

### Stream Setup

First, create a JetStream stream with the required configuration:

```typescript
import { jetstreamManager } from "@nats-io/jetstream";

const jsm = await jetstreamManager(nc);

await jsm.streams.add({
  name: "counters",
  subjects: ["counters.>"],
  allow_msg_counter: true,
  allow_direct: true,
});
```

Note the `allow_msg_counter` and `allow_direct` both these options are required.
Note that counter streams reserve the payload of a message to maintain the
counter values, so only counter operations are allowed on the stream.

### Basic Counter Operations

```typescript
import { connect } from "@nats-io/nats-core";
import { NewCounter } from "@synadiaorbit/counters";

// Get a connection to the NATS server
const nc = await connect({ servers: "nats://localhost:4222" });

// Create a counter instance for the stream
const counters = NewCounter(nc, "counters");

// Increment a counter
const newValue = await counters.increment("counters.user_logins", 1);
console.log(`counter value: ${newValue}`);

await counters.increment("counters.user_logins", 100);

// Get current counter value
const currentValue = await counters.value("counters.user_logins");
console.log(`current value: ${currentValue}`);

// Get counter with metadata
const counter = await counters.getCounter("counters.user_logins");
if (counter) {
  console.log(`Value: ${counter.value}`);
  console.log(`Delta: ${counter.delta}`);
  console.log(`Subject: ${counter.subject}`);
  console.log(`Sequence: ${counter.seq}`);
  console.log(`Timestamp: ${counter.timestamp}`);
  console.log(`Time: ${counter.time}`);
}
```

### Batch Operations

```typescript
// Get multiple counter values using wildcards
const vals = await counters.values("counters.*");
for await (const value of vals) {
  console.log(`Counter value: ${value}`);
}

// Get multiple counters with metadata
const counterObjects = await counters.getCounters([
  "counters.logins",
  "counters.errors",
]);
for await (const counter of counterObjects) {
  console.log(`${counter.subject}: ${counter.value} (seq: ${counter.seq})`);
}
```

### Historical Values

```typescript
// Get a counter value at a specific sequence number
const historicalValue = await counters.value("counters.user_logins", 5);
console.log(`Value at sequence 5: ${historicalValue}`);

// Get counter with metadata at a specific sequence
const historicalCounter = await counters.getCounter("counters.user_logins", 5);
if (historicalCounter) {
  console.log(`Historical delta: ${historicalCounter.delta}`);
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
