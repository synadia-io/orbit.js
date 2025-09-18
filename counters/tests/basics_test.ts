/*
 * Copyright 2025 Synadia Communications, Inc
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

import { wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import { type Counter, NewCounter } from "../src/mod.ts";
import { assertArrayIncludes, assertEquals, assertExists } from "@std/assert";

const url = "ws://localhost:9222";

Deno.test("counter - basics", async () => {
  const nc = await wsconnect({ servers: url });

  const jsm = await jetstreamManager(nc);
  await jsm.streams.delete("counters").catch(() => {});

  await jsm.streams.add({
    name: "counters",
    subjects: ["counters.>"],
    allow_msg_counter: true,
    allow_direct: true,
  });

  const c = await NewCounter(nc, "counters");
  assertEquals(await c.increment("counters.a", 10), 10n);
  assertEquals(await c.increment("counters.a", 1), 11n);
  assertEquals(await c.increment("counters.a", -11), 0n);
  assertEquals(await c.increment("counters.b", 101), 101n);

  assertEquals(await c.value("counters.a", 1), 10n);
  assertEquals(await c.value("counters.a", 2), 11n);
  assertEquals(await c.value("counters.a", 3), 0n);
  assertEquals(await c.value("counters.a"), 0n);

  assertEquals(await c.value("counters.c"), null);

  let ce = await c.getCounter("counters.a");
  assertExists(ce);
  assertEquals(ce.value, 0n);
  assertEquals(ce.stream, "counters");
  assertEquals(ce.subject, "counters.a");

  ce = await c.getCounter("counters.a", 1);
  assertExists(ce);
  assertEquals(ce.value, 10n);
  assertEquals(ce.delta, 10n);
  assertEquals(ce.seq, 1);
  assertEquals(ce.subject, "counters.a");
  assertExists(ce.time);
  assertExists(ce.timestamp);

  ce = await c.getCounter("counters.a", 3);
  assertExists(ce);
  assertEquals(ce.value, 0n);
  assertEquals(ce.delta, -11n);
  assertEquals(ce.seq, 3);
  assertEquals(ce.subject, "counters.a");
  assertExists(ce.time);
  assertExists(ce.timestamp);

  const buf: bigint[] = [];
  const iter = await c.values("counters.*");
  for await (const v of iter) {
    buf.push(v);
  }
  assertEquals(iter.getProcessed(), 2);
  assertEquals(buf.length, 2);
  assertArrayIncludes(buf, [101n, 0n]);

  await nc.close();
});

Deno.test("counter - multiple", async () => {
  const nc = await wsconnect({ servers: url });

  const jsm = await jetstreamManager(nc);
  await jsm.streams.delete("many").catch(() => {});

  await jsm.streams.add({
    name: "many",
    subjects: ["many.>"],
    allow_msg_counter: true,
    allow_direct: true,
  });

  const c = await NewCounter(nc, "many");
  for (let i = 1; i <= 200; i++) {
    await c.increment("many." + i, i);
  }

  const iter = await c.getCounters(["many.100", "many.101", "many.1000"]);
  const buf: Counter[] = [];
  for await (const v of iter) {
    buf.push(v);
  }
  assertEquals(iter.getProcessed(), 2);
  assertEquals(buf.length, 2);
  const c100 = buf.find((v) => v.subject === "many.100");
  assertExists(c100);
  assertEquals(c100.value, 100n);
  assertEquals(c100.delta, 100n);

  const c101 = buf.find((v) => v.subject === "many.101");
  assertExists(c101);
  assertEquals(c101.value, 101n);
  assertEquals(c101.delta, 101n);

  const c1000 = buf.find((v) => v.subject === "many.1000");
  assertEquals(c1000, undefined);

  await nc.close();
});
