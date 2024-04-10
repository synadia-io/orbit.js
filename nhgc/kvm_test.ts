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
import { newNHG } from "./mod.ts";
import { deferred } from "https://deno.land/std@0.166.0/async/deferred.ts";
import {
  assertArrayIncludes,
  assertEquals,
  assertRejects,
  fail,
} from "https://deno.land/std@0.207.0/assert/mod.ts";
import { KvEntryInfo } from "./types.ts";
import { getConnectionDetails } from "./credentials.ts";

Deno.test("kvm - add", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  await nhg.kvm.add(id, { max_bytes: 1024 * 512 });
  const info = await nhg.kvm.info(id);
  await nhg.kvm.destroy(id);
  assertEquals(info.name, id);
});

Deno.test("kvm - add with config", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  await nhg.kvm.add(id, {
    description: "testing",
    max_value_size: 1024,
    ttl: 60_000,
    max_bytes: 1024 * 512,
    compression: true,
  });
  const info = await nhg.kvm.info(id);
  assertEquals(info.name, id);
  assertEquals(info.ttl, 60_000 * 1_000_000);

  await nhg.kvm.destroy(id);
});

Deno.test("kvm - list", async () => {
  const kvm = newNHG(getConnectionDetails()).kvm;
  const id = crypto.randomUUID();
  await kvm.add(id, { max_bytes: 1024 * 512 });
  const buckets = await kvm.list();
  assertArrayIncludes(buckets, [id]);
  await kvm.destroy(id);
});

Deno.test("kvm - info", async () => {
  const kvm = newNHG(getConnectionDetails()).kvm;
  const id = crypto.randomUUID();
  await assertRejects(
    () => {
      return kvm.info(id);
    },
    Error,
    "404: Not Found",
  );

  await kvm.add(id, { max_bytes: 512 * 1024 });
  const info = await kvm.info(id);
  assertEquals(info.name, id);
  await kvm.destroy(id);
});

Deno.test("kvm - keys", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 512 * 1024 });

  await Promise.all([
    kv.put("A", "hello"),
    kv.put("B", "world"),
  ]);

  const keys = await nhg.kvm.keys(id);
  assertEquals(keys.length, 2);
  assertArrayIncludes(keys, ["A", "B"]);
  await nhg.kvm.destroy(id);
});

Deno.test("kvm - watch", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = crypto.randomUUID();
  const kv = await nhg.kvm.add(id, { max_bytes: 512 * 1024 });

  await Promise.all([
    kv.put("a", "a"),
    kv.put("b", "b"),
    kv.put("c", "c"),
  ]);

  const d = deferred();

  const events: KvEntryInfo[] = [];
  const w = await nhg.kvm.watch(id, {
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
