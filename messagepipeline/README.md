# MessagePipeline

The MessagePipeline utility allows you to associate a number of transformations
on received messages. In HTTP requests are typically processed by a router
which dispatches a path within the URL to a handler function. Routers typically
use Middleware which allows pre-processing of the requests in order to perform
an initial validation or transformation of the request.

NATS subscriptions are effectively handlers for specific routes designated by
Subjects. These are similar in scope but because dispatching is typically
performed by the server (a message received by the client indicates the
subscription ID that is to receive the message) no general mechanism of
intercepting inbound messages is available.

A Message Pipeline provides an abstraction that allows the handler for a message
to offer similar handling convenience to a NATS application.

Note that in NATS unlike HTTP where a handler must be resolved while processing
the request in NATS it is possible to create transforms on a particular subject
and publish a transformed message that a different service picks up. The
response can be processed by a subsequent service (which may be N levels down).
This allows to integrate and intercept messages differently. This ability is
standard core NATS interaction patterns.

In this utility, the intention is to create a middleware chain that enables a
client handler to transform a message, and allow such transformations to be
easily reused. Transformations are bound to the original message arriving in a
subscription, and processed in-line.

## Installing

The library requires an ESM-compatible runtime (like a browser).

The open-source package registry [JSR](https://jsr.io), hosts packages. See
[messagepipeline](https://jsr.io/@synadiaorbit/messagepipeline).

```sh
deno add @synadiaorbit/messagepipeline
```

### Pipeline Functions

There are two variants for a pipeline

The base functionality for a pipeline is a function `PipelineSyncFn` or
`PipelineFn` that takes a `Msg` and returns a `Msg` or a `Promise<Msg>` in
return:

```typescript
export type SyncPipelineFn = (msg: Msg) => Msg;
export type PipelineFn = (msg: Msg) => Promise<Msg>;
```

Here's an example:

```typescript
import { MutableMsg } from "./mod";

function reverse(m: Msg): Msg {
  try {
    const mm = MutableMsg.fromMsg(m);
    mm.data = new TextEncoder().encode(m.string().split("").reverse().join(""));
    return mm;
  } catch (err) {
    // typically the Pipeline function will not catch errors,
    // as the pipeline itself will. In some cases if you follow
    // a specific convention, you can introduce handling in it
    // as follows, however your code may be more clear if
    // the errors are handled by the message handler instead.
    const h = headers();
    h.set("Error", err.message);
    m.respond(Empty, { headers: h });
    // the throws will be caught by the pipeline, which can then
    // choose to ignore the message
    throw err;
  }
}
```

The above is a simple example that expects a source message to have a textual
payload, and returns a message with all it's text reversed. From the example,
the _convention_ used by this pipeline is that if there's an error, the handler
will respond an error message (which is simply a blank message with an "Error"
header set). Note that is by convention only.

### MutableMsg

Messages in the Javascript clients are immutable. For a pipeline, you'll need a
way of crafting a message, that is where `MutableMsg` comes in. Looks like a
standard message, but you are able to _set_ values.

Note that if you use `MutableMsg.fromMsg()` with a message that originated from
a subscription, you'll effectively clone the message. If you use the
constructor, you are responsible to initialize all the fields, including a
special one called `publisher` - this is effectively a `NatsConnection`.

### Pipelines

A MessagePipeline is a simply a collection of `PipelineFn` or `PipelineSyncFn`
executed in order. The `Pipelines` and `SyncPipelines` interfaces defines a
pipeline:

```typescript
export interface Pipelines {
  transform(m: Msg): Promise<Msg>;
}

export interface SyncPipelines {
  transform(m: Msg): Result<Msg>;
}
```

The async version is fairly standard - if the pipeline fails, the `Promise`
rejects. For the sync version, the type is a `Result<Msg>`, you can test a
result to see if it is an error by checking its `isError` property. If `false`,
the `Result` will have a `value` of type `Msg`:

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

The intention of result is have an efficient pattern for testing if the pipeline
succeed or failed without having unchecked errors.

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
