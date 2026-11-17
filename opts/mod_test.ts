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
import type { ConnectionOptions } from "@nats-io/nats-core";
import { wsconnect } from "@nats-io/nats-core";
import { encode, parse } from "./mod.ts";
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.221.0/assert/mod.ts";

Deno.test("basics", async () => {
  const opts: Partial<ConnectionOptions> = {};
  opts.debug = true;
  opts.servers = ["wss://demo.nats.io:8443"];
  opts.name = "me";
  opts.noEcho = true;
  opts.reconnect = false;
  opts.timeout = 10_000;

  const u = encode(opts);
  console.log(u);

  const opts2 = await parse(u);
  console.log(opts2);

  assertEquals(opts, opts2);

  const nc = await wsconnect(opts2);
  console.log(nc.getServer());
  await nc.flush();
  await nc.close();
});

Deno.test("tls", async () => {
  const opts: Partial<ConnectionOptions> = {};
  opts.debug = true;
  opts.servers = ["demo.nats.io:2224"];
  opts.name = "me";
  opts.noEcho = true;
  opts.reconnect = false;
  opts.timeout = 10_000;
  opts.tls = {
    handshakeFirst: true,
  };

  const u = encode(opts);
  const opts2 = await parse(u);

  assertEquals(opts, opts2);
});

Deno.test("schemes", async () => {
  const opts: Partial<ConnectionOptions> = {};
  opts.servers = [
    "nats://localhost:1234",
    "localhost:4222",
    "wss://localhost",
  ];

  const s = encode(opts);
  const opts2 = await parse(s) as ConnectionOptions;

  assertExists(opts2.servers);
  assert(Array.isArray(opts2.servers));
  const n =
    (opts2.servers as string[]).find((s: string) => s.startsWith("nats://")) ||
    "";
  assertEquals(n, "");
  const n2 =
    (opts2.servers as string[]).find((s: string) =>
      s.startsWith("localhost:1234")
    ) ||
    "";
  assertEquals(n2, "localhost:1234");
});
