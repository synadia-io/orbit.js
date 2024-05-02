# nhgc

NHGC is a prototype API in TypeScript that interacts with KV and NATS over the
NATS HTTP Gateway. The NATS HTTP Gateway is a Synadia Server that allows clients
to communicate with NATS via the HTTP protocol. The NATS HTTP Gateway is part of
the [Synadia Cloud](https://www.synadia.com/).

While no library is needed to interact with the gateway except for standard
libraries built into most programming languages, a simple API wrapper makes it
very easy for developers.

The NHG client is an ES module that depends on `fetch` and `EventSource` (SSE).

### Installing

The library requires an ESM-compatible runtime (like a browser). If you want to
use outside of a browser, it should be possible so long as your runtime allows
using ESM modules and provides the necessary support for `fetch` and
`EventSource`.

The open-source package registry [JSR](https://jsr.io), hosts packages. See
[nhgc](https://jsr.io/@synadiaorbit/nhgc).

```sh
deno add @synadiaorbit/nhgc
```

#### Node.js

If you want to run in Node.js, you can:

```sh
npx jsr add @synadiaorbit/nhgc
npm install event-source-polyfill
```

And then shim your code:

```javascript
import { EventSourcePolyfill, NativeEventSource } from "event-source-polyfill";

const EventSource = NativeEventSource || EventSourcePolyfill;
// OR: may also need to set as global property
global.EventSource = NativeEventSource || EventSourcePolyfill;
```

## Usage

To use the gateway you will need the HTTPS URL of the NHG server and an API
token.

```typescript
import { newNHG } from "@synadiaorbit/nhgc";

// create an instance of the API using the specified connection details
const nhg = newNHG("https://someurl.com", "someapikey");
```

The NHG client exposes:

- `kvm` property which implements `Kvm` which allows you to work with KV
- `nats` property which implements `Nats` which allows you to work with NATS
  core (publish, subscribe, request)

### KV

```typescript
// generate a unique KV name
const id = crypto.randomUUID();

// add a new KV (you can access an existing one with `nhg.kvm.get(id);`)
const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 1024, history: 10 });

// you can find out what kvs are available to you
const kvs = await nhg.kvm.list();
// ["240c0f80-31bf-406d-92c9-f81d1900f67e"]

console.log(kvs);

// put a value
let rev = await kv.put("hello", "hi");
// value was added at revision 1
console.log(`value was added at revision ${rev}`);

// get the value
let v = await kv.get("hello");
// value could be null if it is not in the KV
if (v) {
  // got value "hi" at revision 1
  console.log(`got value "${v.string()}" at revision ${v.revision}`);
} else {
  console.log(`value for hello was not found`);
}

// put a value but only if is at an expected revision
rev = await kv.put("hello", "hola", rev);
// updated value for 'hello' - new value at revision 2
console.log(`updated value for 'hello' - new value at revision ${rev}`);

// put a value but this time we specify a bad revision
await kv.put("hello", "hej", 1).catch((err) => {
  // 409: Conflict
  console.log(`${err.message}`);
});
// now add it again
await kv.put("hello", "hej", 2);

// get the value
v = await kv.get("hello");
// value is now "hej"
console.log(`value is now "${v?.string()}"`);

// get the value at a different revision (if available)
v = await kv.get("hello", 1);
// value at revision 1 is "hi"
console.log(`value at revision 1 is "${v?.string()}"`);

// put another entry
await kv.put("bye", "good bye");

// you can get a list of keys - note this could return a huge number of keys
// so it is best to filter for the ones you want - note filtering is not
// wildcards in the sense of regular expression - but wildcards in subjects
// for more information consult JetStream KV wildcards in your NATS documentation.
const keys = await kv.keys();
// ["hello", "bye"]
console.log(keys);

// you can delete a value - delete puts a marker
await kv.delete("bye");
// a get will return null on a deleted value
v = await kv.get("bye");
// null
console.log(v);

// we can get info on a kv
const info = await kv.info();
// kv contains 5 taking up 540 bytes and holds a history of 10
console.log(
  `kv contains ${info.values} taking up ${info.size} bytes and holds a history of ${info.history}`,
);

// we can purge deleted keys (eliminating their history,
// and marked as purged, with any data lost)
await kv.purge();

const after = await kv.info();
// reclaimed: 82 bytes 1 entries
console.log(
  `reclaimed: ${info.size - after.size} bytes ${
    info.values - after.values
  } entries`,
);

// similarly to updates you can add an entry only if it doesn't exist
await kv.create("good_morning", "buenos dias");
// if the entry exist, it would fail:
await kv.create("good_morning", "gutten morgen").catch((err) => {
  // good morning already existed: 409: Conflict
  console.log(`good morning already existed: ${err.message}`);
});

// you can also watch for changes to a key or the KV in general
// this requires SSE support
const watch = await kv.watch({
  include: "lastValue",
  callback: (err?: Error, e?: KvChangeEvent) => {
    if (err) {
      console.log(`zonk!: ${err.message}`);
    }
    if (e) {
      // {
      //   key: "hello",
      //   bucket: "a2ea0dc4-a8b4-4fc8-9803-2477817f0161",
      //   created: 2024-04-11T15:55:06.087Z,
      //   revision: 3,
      //   delta: 2,
      //   operation: "PUT"
      // }
      // ...
      console.log(e);
    }
  },
});

// let update values for a bit
const timer = setInterval(() => {
  kv.put("a", `${Date.now()}`).then();
}, 250);

// and then stop the watcher and updates
setTimeout(() => {
  clearInterval(timer);
  watch.stop();
}, 2000);

await watch.stopped;

// and yes, you can destroy a KV and all its values
await nhg.kvm.destroy(id);
```

### NATS

The NATS functionality only includes:

- `publish` which allows you to publish a message to a subject
- `publishWithReply` which allows you to publish a message to a subject while
  specifying a reply subject where responses can be sent.
- `subscribe` which allows to express interest to receive messages on a specific
  subject
- `request` which allows to publish a request that return the first response
  received.
- `flush` which allows you to verify that messages up to that point have been
  forwarded to the server, this is typically useful when writing tests.

If you have used NATS in the past this functionality will be familiar.

```typescript
// create an nhg as shown ealier
const nc = nhg.nats;

// to receive messages you can create a subscription.
// subscriptions are backed by an EventSource (SSE)".
// in this case we are interested in messages published to
// "hello".
let count = 0;
const sub = await nc.subscribe("hello", (err, msg) => {
  if (err) {
    console.error(err.message);
    return;
  }
  if (msg) {
    count++;
    // print a message
    console.log(
      `[${count}]: msg with payload "${msg.string()}" which has ${
        msg.data?.length || 0
      } bytes`,
    );
    // print the headers
    console.log("\t", msg.headers);

    // if you think the data is JSON, you can use:
    // msg.json() to decode it.
  }
});

// you can publish an empty message - this have no data, but can be useful
// to signal some event where the subject is descriptive of what is happening.
await nc.publish("hello");

// you can specify a payload - payload can be a string, an Uint8Array or a ReadableStream<Uint8Array>
await nc.publish("hello", "world");

// you can also specify headers that will be included on the message.
// the only restriction is that the header keys must begin with the prefix `NatsH-`.
// Note that the prefix will be stripped. So for `NatsH-Hello` the NATS message
// will have a `Hello` header. The reason for the prefix is to ensure that
// other HTTP headers are not leaked to subscribers.
await nc.publish("hello", "world", {
  headers: {
    "NatsH-Language": "EN",
  },
});

// Implementing a service is simply a subscription that sends a message to the
// reply subject included in the request message. If a message is not responded
// it will timeout on the client.
const svc = await nc.subscribe("q", async (err, msg) => {
  if (err) {
    console.error(err.message);
    return;
  }
  if (msg?.reply) {
    // echo the request - we are going to echo all the headers back and because
    // we are using the gateway, we need to transform them:
    const headers = new Headers();
    msg.headers.forEach((v, k) => {
      headers.append(`NatsH-${k}`, v);
    });
    await nc.publish(msg.reply, msg.data, { headers });
  } else {
    console.log("message doesn't have a reply - ignoring");
  }
});

// to trigger a request - this one with a payload of `question`, and some headers.
const r = await nc.request("q", "question", {
  headers: {
    "NatsH-My-Header": "Hi",
  },
});
console.log(
  `got a response with payload "${r.string()}" which has ${
    r.data?.length || 0
  } bytes\n\t`,
  r.headers,
);

// finally, there's also publish with reply, that redirects the response
// to a different subscription - this is only used on advanced usages,
// but shows that you can delegate someone else to process your message.
// typically you'll just use request which will return the reply to you.
await nc.publishWithReply("q", "hello", "question2", {
  headers: {
    "NatsH-My-Header": "Hi",
  },
});

await nc.flush();

sub.unsubscribe();
svc.unsubscribe();
```
