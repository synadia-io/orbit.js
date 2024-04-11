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
    "404: 404 nats: bucket not found",
  );

  const kv = await kvm.add(id, { max_bytes: 512 * 1024 });
  const info = await kv.info();
  assertEquals(info.name, id);
  await kvm.destroy(id);
});
