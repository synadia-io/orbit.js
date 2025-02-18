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

  const nc = await wsconnect(opts2);
  console.log(nc.getServer());
  await nc.flush();
  await nc.close();
});

Deno.test("tls", () => {
  const opts: Partial<ConnectionOptions> = {};
  opts.debug = true;
  opts.servers = ["demo.nats.io"];
  opts.name = "me";
  opts.noEcho = true;
  opts.reconnect = false;
  opts.timeout = 10_000;
  opts.tls = {
    handshakeFirst: true,
  };

  const u = encode(opts);
  console.log(u);

  console.log(parse(u));
});

Deno.test("url", async () => {
  const u = new URL("nats://hello:world@localhost");
  console.log(u);
});
