# nhg.js

This is a prototype API in TypeScript for interacting with KV
over the NATS HTTP Gateway. The NATS HTTP Gateway is a Synadia
Server that allows clients to communicate with NATS KV via HTTP protocol.
The NATS HTTP Gateway is part of the [Synadia Cloud](https://www.synadia.com/).

While no library is needed except for standard libraries built into most
programming languages a simple wrapper makes it very convenient.

The NGH client, is an ES module, and depends on `fetch` and `SSE`
(`EventSource`) for `watch` operations.

To use the gateway you will need the HTTP/S url of the NGH server and an API
token.

```typescript
// create an instance of the API using the specified connection details
const nhg = newNHG("https://someurl.com", "someapikey");

// generate an unique KV name
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

// we can purge deleted keys (eliminating their history - they will still remain but
// marked as purged, and their data lost)
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
