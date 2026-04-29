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

import { wsconnect } from "@nats-io/nats-core";
import { jetstreamManager } from "@nats-io/jetstream";
import {
  type FastIngest,
  type FastIngestOptions,
  type FastIngestProgress,
  startFastIngest,
} from "../src/mod.ts";
import { assertEquals, assertExists } from "@std/assert";

const url = Deno.env.get("NATS_URL") ?? "wss://demo.nats.io:8443";

Deno.test("fastingest - exports", () => {
  assertEquals(typeof startFastIngest, "function");
  const _o: Partial<FastIngestOptions> = { allowGaps: false };
  const _f: FastIngest | null = null;
  const _p: FastIngestProgress | null = null;
  assertExists(_o);
});

Deno.test("fastingest - basics", async () => {
  const nc = await wsconnect({ servers: url });
  const jsm = await jetstreamManager(nc);

  try {
    await jsm.streams.delete("fibatch").catch(() => {});
    await jsm.streams.add({
      name: "fibatch",
      subjects: ["fi"],
      allow_batched: true,
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("allow_batched") || msg.includes("invalid JSON")) {
      console.warn(`skipping: server does not support allow_batched (${url})`);
      await nc.close();
      return;
    }
    throw err;
  }

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

  await jsm.streams.delete("fibatch").catch(() => {});
  await nc.close();
});
