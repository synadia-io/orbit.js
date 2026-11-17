# MessagePipeline

[![License](https://img.shields.io/badge/Licence-Apache%202.0-blue.svg)](https://github.com/synadia-io/orbit.js/blob/main/LICENSE)
[![JSR](https://jsr.io/badges/@synadiaorbit/messagepipeline)](https://jsr.io/@synadiaorbit/messagepipeline)
[![JSR Score](https://jsr.io/badges/@synadiaorbit/messagepipeline/score)](https://jsr.io/@synadiaorbit/messagepipeline)
[![NPM Version](https://img.shields.io/npm/v/%40synadiaorbit%2Fmessagepipeline)](https://www.npmjs.com/package/@synadiaorbit/messagepipeline)
[![NPM Downloads](https://img.shields.io/npm/dt/%40synadiaorbit%2Fmessagepipeline)](https://www.npmjs.com/package/@synadiaorbit/messagepipeline)

The MessagePipeline utility allows you to compose a set of one or more
transformations that you can easily reuse across message handlers. If you are
thinking middleware for NATS, you are on the right track.

While NATS already provides a message-based vocabulary to implement
transformations, code that you may be on-boarding to NATS may rely on a series
of middleware transformations that you apply to input messages. If that is the
case, this utility will probably be very useful to you.

You can use a MessagePipeline to validate, reformat, and transform messages. For
example could check the schema of an input, and generate a different but
equivalent input, or annotate the message with additional information.

## Installation

```bash
# node, bun (esm and commonjs)
npm install @synadiaorbit/messagepipeline

# deno
deno add jsr:@synadiaorbit/messagepipeline
```

The npm package works with `import` and `require`, and requires Node.js 22 or
later.

### Pipeline Functions

The base functionality for a pipeline is a function `PipelineFn` that takes a
`Msg` and returns a `Msg` or a `Promise<Msg>` in return:

```typescript
export type PipelineFn = (msg: Msg) => Promise<Msg> | Msg;
```

Here's an example:

```typescript
import type { Msg } from "@nats-io/nats-core";
import { MutableMsg } from "@synadiaorbit/messagepipeline";

function reverse(m: Msg): Msg {
  const mm = MutableMsg.fromMsg(m);
  mm.data = new TextEncoder().encode(m.string().split("").reverse().join(""));
  return mm;
}
```

The above example is simply a function that takes an input message, and then
creates a message that can be mutated from it. By using the source message,
message properties like subjects, reply subjects, headers and data are all
initialized to match the source message. Then additional transformations can be
applied, in the case above, the message text is just reversed.

### MutableMsg

Messages in the Javascript clients are immutable. For a pipeline, you'll need a
way of crafting a message, that is where `MutableMsg` comes in. Looks like a
standard message, but you are able to _set_ values on the available properties.

Note that if you use `MutableMsg.fromMsg()` with a message that originated from
a subscription, you'll effectively clone the message. If you use the
constructor, you are responsible to initialize all the fields, including a
special one called `publisher` that enables `respond()` functionality - this is
effectively a reference to the `NatsConnection`.

### Pipelines

A Pipelines are simply a collection of `PipelineFn` executed in order. The
`Pipelines` interface defines a pipeline:

```typescript
export interface Pipelines {
  transform(m: Msg): Promise<Msg>;
}
```

If the pipeline fails (one of its functions throws), the `Promise` rejects.

```typescript
try {
  const r = await pipeline.transform(m);
  // do something with the transform
} catch (err) {
  // do something with the error
}
```

As you can see, using a Pipeline is very straight forward. It allows you to
compose repetitive code info a flow that could lead to a simpler handler.

### Full Example

Here's the full example. It connects to the shared `demo.nats.io` server with
`wsconnect`, which works in every runtime; any nats.js transport works too, see
[runtimes](https://github.com/nats-io/nats.js/blob/main/runtimes.md).

```typescript
import { MutableMsg, Pipeline } from "@synadiaorbit/messagepipeline";
import { Empty, headers, wsconnect } from "@nats-io/nats-core";
import type { Msg } from "@nats-io/nats-core";

function valid(m: Msg): Msg {
  if (m.data.length > 0) {
    return MutableMsg.fromMsg(m);
  } else {
    // so you could respond here, the code base needs to be certain
    // that of that behaviour as there's nothing preventing another
    // respond elsewhere.
    const h = headers();
    h.set("Error", "message is empty");
    m.respond(Empty, { headers: h });
    // the throws will be caught by the pipeline, which can then
    // choose to ignore the message
    throw new Error("message is empty");
  }
}

function reverse(m: Msg): Msg {
  try {
    const mm = MutableMsg.fromMsg(m);
    mm.data = new TextEncoder().encode(m.string().split("").reverse().join(""));
    return mm;
  } catch (err) {
    const h = headers();
    h.set("Error", (err as Error).message);
    m.respond(Empty, { headers: h });
    // the throws will be caught by the pipeline, which can then
    // choose to ignore the message
    throw err;
  }
}

const nc = await wsconnect({ servers: ["wss://demo.nats.io:8443"] });
const iter = nc.subscribe("hello");
(async () => {
  const pipeline = new Pipeline(valid, reverse);
  for await (const m of iter) {
    try {
      const r = await pipeline.transform(m);
      nc.respondMessage(r);
    } catch (_) {
      m.respond("error");
    }
  }
})();
await nc.flush();

const nc2 = await wsconnect({ servers: ["wss://demo.nats.io:8443"] });
let i = 0;
setInterval(() => {
  nc2.request("hello", `hello ${++i}`)
    .then((r) => {
      console.log(r.string());
    });
}, 1000);
```
