/*
 * Copyright 2026 Synadia Communications, Inc
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

import "./connect.ts";

import { jetstreamManager } from "@nats-io/jetstream";
import { type FastIngestOptions, startFastIngest } from "../src/mod.ts";
import { assertEquals, assertExists } from "@std/assert";
import { jetstreamServerConf, notCompatible, setup } from "@nats-io/nst";

Deno.test("fastingest - exports", () => {
  assertEquals(typeof startFastIngest, "function");
  const _o: Partial<FastIngestOptions> = { allowGaps: false };
  assertExists(_o);
});

Deno.test("fastingest - basics", async () => {
  await using ctx = await setup(jetstreamServerConf({}));
  const { ns, nc } = ctx;
  if (await notCompatible(ns, nc, "2.14.0")) {
    return;
  }

  const jsm = await jetstreamManager(nc);
  await jsm.streams.add({
    name: "fibatch",
    subjects: ["fi"],
    allow_batched: true,
  });

  const fi = await startFastIngest(nc, "fi", "1", {
    allowGaps: false,
    ackInterval: 5,
  });
  await fi.add("fi", "2");
  await fi.add("fi", "3");
  await fi.add("fi", "4");
  const ack = await fi.last("fi", "5");

  assertEquals(ack.stream, "fibatch");
  assertEquals(ack.batch, fi.batch);
  assertEquals(ack.count, 5);
  assertEquals(ack.seq, 5);
});
