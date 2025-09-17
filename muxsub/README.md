# MuxSub

[![License](https://img.shields.io/badge/Licence-Apache%202.0-blue.svg)](https://github.com/synadia-io/orbit.js/blob/main/LICENSE)
[![muxsub](https://github.com/synadia-io/orbit.js/actions/workflows/muxsub.yml/badge.svg)](https://github.com/synadia-io/orbit.js/actions/workflows/muxsub.yml)
[![JSR](https://jsr.io/badges/@synadiaorbit/muxsub)](https://jsr.io/@synadiaorbit/muxsub)
[![JSR Score](https://jsr.io/badges/@synadiaorbit/muxsub/score)](https://jsr.io/@synadiaorbit/muxsub)
[![NPM Version](https://img.shields.io/npm/v/%40synadiaorbit%2Fmuxsub)](https://www.npmjs.com/package/@synadiaorbit/muxsub)
[![NPM Downloads](https://img.shields.io/npm/dt/%40synadiaorbit%2Fmuxsub)](https://www.npmjs.com/package/@synadiaorbit/muxsub)

A NATS multiplexing subscription utility that allows multiple message handlers
to share a single underlying subscription using inbox-based routing.

## Overview

MuxSub creates a single wildcard subscription on a generated inbox prefix (e.g.,
`_INBOX.abc123.>`), then routes incoming messages to specific handlers based on
the message subject tokens. This approach reduces the number of subscriptions
while maintaining clean message handling separation.

## Installation

```bash
# Deno
deno add @synadiaorbit/muxsub

# Import in your code
import { MuxSubscription } from "@synadiaorbit/muxsub";
```

## Usage

### Basic Example

```typescript
import { wsconnect } from "@nats-io/nats-core";
import { MuxSubscription } from "@synadiaorbit/muxsub";

const nc = await wsconnect({ servers: ["nats://localhost:4222"] });
const mux = new MuxSubscription(nc);

// Callback-based handler
mux.newMuxInbox("foo.bar", (_, msg) => {
  console.log("Received:", msg.subject);
});

// Iterator-based handler
const iterator = mux.newMuxInbox("responses");
for await (const msg of iterator) {
  console.log("Response:", msg.subject);
  break; // Exit after first message
}

// Publish to handlers
nc.publish(mux.subjectFor("foo.bar"), "hello");
nc.publish(mux.subjectFor("responses"), "world");

await mux.drain();
await nc.close();
```

## API Reference

### MuxSubscription

#### Constructor

- `new MuxSubscription(nc: NatsConnection)` - Creates a new multiplexing
  subscription

#### Methods

##### Handler Management

- `newMuxInbox(subject: string, callback: MsgCallback)` - Register a callback
  handler
- `newMuxInbox(subject: string)` - Create an async iterator for messages
- `cancelMuxInbox(subject: string)` - Remove a handler

##### Subject Utilities

- `subjectFor(partialSubject: string)` - Get the full NATS subject for
  publishing
- `tokenFor(subject: string)` - Extract the token from a full subject

##### Subscription Control

- `drain()` - Gracefully close after processing pending messages
- `unsubscribe(max?: number)` - Stop the subscription
- `closed` - Promise that resolves when subscription closes
- `isDraining()` - Check if subscription is draining
- `isClosed()` - Check if subscription is closed

## How It Works

1. Creates a single subscription on `{prefix}.>` where `{prefix}` is a generated
   inbox
2. When messages arrive, extracts the token after the prefix
3. Routes messages to registered handlers based on the token
4. Supports both callback and async iterator patterns

## Use Cases

- Request-response patterns where you need to handle multiple concurrent
  requests
- Microservice communication with topic-based routing
- Reducing subscription overhead when handling many related message types
- Building higher-level messaging abstractions

## License

Apache License 2.0
