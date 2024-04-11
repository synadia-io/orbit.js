/*
 * Copyright 2020-2024 The Synadia Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertRejects,
  fail,
} from "https://deno.land/std@0.207.0/assert/mod.ts";
import { newNHG } from "./mod.ts";
import { getConnectionDetails } from "./credentials.ts";
import { deferred } from "https://deno.land/std@0.166.0/async/deferred.ts";
import { KvChangeEvent, KvEntryInfo } from "./types.ts";
import { keys } from "https://underscorejs.org/underscore-esm.js";

Deno.test("kv - get simple value", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 512 });
  const a = await kv.put("a", "hello world");
  assert(typeof a === "number" && a > 0);
  const e = await kv.get("a");
  assertExists(e);
  assertEquals(e.bucket, id);
  assertEquals(e.string(), "hello world");
  assertEquals(e.operation, "PUT");
  assertExists(e.created);
  assertEquals(typeof e.revision, "number");
  await nhg.kvm.destroy(id);
});

Deno.test("kv - binary", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 512 });

  const d = new Uint8Array(10);
  d[0] = 0;
  d[1] = 1;
  d[2] = 2;
  d[3] = 3;
  await kv.put("b", d);
  const e = await kv.get("b");
  assertExists(e);
  assertEquals(e.bucket, id);
  assertEquals(e.value, d);
  assertEquals(e.operation, "PUT");
  assertExists(e.created);
  assertEquals(typeof e.revision, "number");
  await nhg.kvm.destroy(id);
});

Deno.test("kv - get entry from non existing kv", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = nhg.kvm.get(id);
  assertEquals(await kv.get("xxxx"), null);
});

Deno.test("kv - get non existing entry", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 512 });
  assertEquals(await kv.get("xxefjejere"), null);
  await nhg.kvm.destroy(id);
});

Deno.test("kv - delete", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 512 });

  const seq = await kv.put("c", "one");
  assert(seq > 0);
  const ok = await kv.delete("c");
  assert(ok);
  const e = await kv.get("c");
  assertEquals(e, null);
  await nhg.kvm.destroy(id);
});

Deno.test("kv - get revision", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 512 });
  const seq = await kv.put("s", "one");
  assert(seq > 0);
  const e = await kv.get("s", seq);
  assertExists(e);
  assertEquals(e.revision, seq);
  await nhg.kvm.destroy(id);
});

Deno.test("kv - create fails existing key", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 512 });

  const seq = await kv.create(id, "a");
  assert(seq > 0);
  await assertRejects(
    () => {
      return kv.create(id, "hello");
    },
    Error,
    "409: Conflict",
  );
  await nhg.kvm.destroy(id);
});

Deno.test("kv - previous revision", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 1024 * 512 });

  const seq = await kv.create(id, "a");
  assert(seq > 0);

  await assertRejects(() => {
    return kv.put(id, "hello", seq - 1);
  });

  const seq2 = await kv.put(id, "hello", seq);
  assertEquals(seq2, seq + 1);
  await nhg.kvm.destroy(id);
});

Deno.test("kvm - keys", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 512 * 1024 });

  await Promise.all([
    kv.put("A", "hello"),
    kv.put("B", "world"),
  ]);

  const keys = await kv.keys();
  assertEquals(keys.length, 2);
  assertArrayIncludes(keys, ["A", "B"]);
  await nhg.kvm.destroy(id);
});

Deno.test("kv - watch", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 512 * 1024 });

  await Promise.all([
    kv.put("a", "a"),
    kv.put("b", "b"),
    kv.put("c", "c"),
  ]);

  const d = deferred();

  const events: KvChangeEvent[] = [];
  const w = await kv.watch({
    ignoreDeletes: false,
    include: "allHistory",
    callback: (err, e) => {
      if (err) {
        fail(err.message);
      }
      if (e) {
        events.push(e);
        if (events.length === 4) {
          d.resolve();
        }
      }
    },
  });

  await kv.put("d", "d");
  await d;
  w.stop();
  assertEquals(events.length, 4);
  await nhg.kvm.destroy(id);
});

Deno.test("kv - info", async () => {
  const kvm = newNHG(getConnectionDetails()).kvm;
  const id = crypto.randomUUID();
  await assertRejects(
    () => {
      return kvm.info(id);
    },
    Error,
    "404: Not Found",
  );

  const kv = await kvm.add(id, { max_bytes: 512 * 1024 });
  const info = await kv.info();
  assertEquals(info.name, id);
  await kvm.destroy(id);
});

Deno.test("kv - example", async () => {
  // create an instance of the API using the specified connection details
  // { url: string; apiKey: string },
  const nhg = newNHG(getConnectionDetails());
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
});
