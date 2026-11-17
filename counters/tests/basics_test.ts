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

import { jetstreamManager } from "@nats-io/jetstream";
import { type Counter, NewCounter } from "../src/mod.ts";
import {
  assertArrayIncludes,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "@std/assert";
import { setup } from "./server.ts";

Deno.test("counter - basics", async () => {
  await using ctx = await setup(true);
  const { nc } = ctx;

  const jsm = await jetstreamManager(nc);
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
});

Deno.test("counter - multiple", async () => {
  await using ctx = await setup(true);
  const { nc } = ctx;

  const jsm = await jetstreamManager(nc);
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
});

Deno.test("counter - timestamp", async () => {
  await using ctx = await setup(true);
  const { nc } = ctx;

  const jsm = await jetstreamManager(nc);
  await jsm.streams.add({
    name: "ts",
    subjects: ["ts.>"],
    allow_msg_counter: true,
    allow_direct: true,
  });

  const c = NewCounter(nc, "ts");
  await c.increment("ts.a", 1);
  await c.increment("ts.b", 2);

  // the stored messages are the reference for the time the server recorded,
  // so the counter's time has to match exactly
  const stored = new Map<number, number>();
  for (const seq of [1, 2]) {
    const sm = await jsm.streams.getMessage("ts", { seq });
    assertExists(sm);
    stored.set(seq, sm.time.getTime());
  }

  function check(ce: Counter | null, seq: number) {
    assertExists(ce);
    assertEquals(ce.seq, seq);
    assertNotEquals(ce.timestamp, "");
    assertEquals(ce.time.getTime(), stored.get(seq));
  }

  // by subject
  check(await c.getCounter("ts.a"), 1);

  // by sequence
  check(await c.getCounter("ts.b", 2), 2);

  // batch
  const iter = await c.getCounters(["ts.a", "ts.b"]);
  for await (const ce of iter) {
    check(ce, ce.subject === "ts.a" ? 1 : 2);
  }
  assertEquals(iter.getProcessed(), 2);
});

Deno.test("counter - value only for the named counter", async () => {
  await using ctx = await setup(true);
  const { nc } = ctx;

  const jsm = await jetstreamManager(nc);
  await jsm.streams.add({
    name: "seqs",
    subjects: ["seqs.>"],
    allow_msg_counter: true,
    allow_direct: true,
  });

  const c = NewCounter(nc, "seqs");
  await c.increment("seqs.a", 1);
  await c.increment("seqs.b", 10);

  // seq 2 is a revision of seqs.b, not seqs.a
  assertEquals(await c.value("seqs.a", 2), null);

  // the matching counter still resolves
  assertEquals(await c.value("seqs.b", 2), 10n);
  assertEquals(await c.value("seqs.a", 1), 1n);

  // a sequence that doesn't exist
  assertEquals(await c.value("seqs.a", 100), null);

  // a wildcard isn't a counter name, the batch apis take wildcards
  assertEquals(await c.value("seqs.*"), null);
  assertEquals(await c.value("seqs.a"), 1n);
});

Deno.test("counter - sources", async () => {
  await using ctx = await setup(true);
  const { nc } = ctx;

  const jsm = await jetstreamManager(nc);
  await jsm.streams.add({
    name: "es",
    subjects: ["es.>"],
    allow_msg_counter: true,
    allow_direct: true,
  });
  await jsm.streams.add({
    name: "fr",
    subjects: ["fr.>"],
    allow_msg_counter: true,
    allow_direct: true,
  });
  // the aggregate sums both regions into eu.hits
  await jsm.streams.add({
    name: "eu",
    subjects: ["eu.>"],
    allow_msg_counter: true,
    allow_direct: true,
    sources: [
      { name: "es", subject_transforms: [{ src: "es.>", dest: "eu.>" }] },
      { name: "fr", subject_transforms: [{ src: "fr.>", dest: "eu.>" }] },
    ],
  });

  const es = NewCounter(nc, "es");
  const fr = NewCounter(nc, "fr");
  await es.increment("es.hits", 10);
  await fr.increment("fr.hits", 5);
  await es.increment("es.hits", 1);

  // a counter that isn't sourced has no sources
  const local = await es.getCounter("es.hits");
  assertExists(local);
  assertEquals(local.sources, {});

  const eu = NewCounter(nc, "eu");
  let agg: Counter | null = null;
  for (let i = 0; i < 50; i++) {
    agg = await eu.getCounter("eu.hits");
    if (agg?.value === 16n) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assertExists(agg);
  assertEquals(agg.value, 16n);
  // keyed by source stream, then by the subject before the transform
  assertEquals(agg.sources, {
    es: { "es.hits": 11n },
    fr: { "fr.hits": 5n },
  });

  // the batch api returns them too
  const iter = await eu.getCounters("eu.hits");
  for await (const c of iter) {
    assertEquals(c.sources, agg.sources);
  }
  assertEquals(iter.getProcessed(), 1);
});
