# MessagePipeline

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

## Installing

The library requires an ESM-compatible runtime (like a browser).

The open-source package registry [JSR](https://jsr.io), hosts packages. See
[messagepipeline](https://jsr.io/@synadiaorbit/messagepipeline).

```sh
deno add @synadiaorbit/messagepipeline
```

### Pipeline Functions

There are two variants for a pipeline. One is for `Sync` pipelines and the other
is for `Async`.

The base functionality for a pipeline is a function `PipelineSyncFn` or
`PipelineFn` (async) that takes a `Msg` and returns a `Msg` or a `Promise<Msg>`
in return:

```typescript
export type SyncPipelineFn = (msg: Msg) => Msg;
export type PipelineFn = (msg: Msg) => Promise<Msg>;
```

Here's an example:

```typescript
import { MutableMsg } from "./mod";

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

A Pipelines are simply a collection of `PipelineFn` or `PipelineSyncFn` executed
in order. The `Pipelines` and `SyncPipelines` interfaces defines a pipeline:

```typescript
export interface Pipelines {
  transform(m: Msg): Promise<Msg>;
}

export interface SyncPipelines {
  transform(m: Msg): Result<Msg>;
}
```

The async version is fairly standard - if the pipeline fails (one of its
functions throws), the `Promise` rejects. For the sync version, the type is a
`Result<Msg>`, you can test a result to see if it is an error by checking its
`isError` property. If `false`, the `Result` will have a `value` of type `Msg`:

```typescript
const r = pipeline.transform(m);
if (r.isError) {
  // the error is included
  console.log(r.error);
} else {
  // otherwise the value prpoerty contains a Msg
  console.log(r.value.subject);
}
```

The intention of `Result` is have an efficient pattern for testing if the pipeline
succeed or failed and preventing errors.

As you can see, using a Pipeline is very straight forward. It allows you to compose
repetitive code info a flow that could lead to a simpler handler.

### Full Example

Here's the full example:

```typescript
import { Msg, MutableMsg, SyncPipeline } from "../mod.ts";
import { connect, Empty, headers } from "nats";

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
    h.set("Error", err.message);
    m.respond(Empty, { headers: h });
    // the throws will be caught by the pipeline, which can then
    // choose to ignore the message
    throw err;
  }
}

const nc = await connect({ servers: ["demo.nats.io"] });
const iter = nc.subscribe("hello");
(async () => {
  const pipeline = new SyncPipeline(valid, reverse);
  for await (const m of iter) {
    const r = pipeline.transform(m);
    if (r.isError) {
      // the error was already handled (but that really depends on the
      // implementation of the transformation handlers.
      m.respond("error");
    } else {
      nc.respondMessage(r.value);
    }
  }
})();
await nc.flush();

const nc2 = await connect({ servers: ["demo.nats.io"] });
let i = 0;
setInterval(() => {
  nc2.request("hello", `hello ${++i}`)
    .then((r) => {
      console.log(r.string());
    });
}, 1000);
```
