/*
 * Copyright 2024 Synadia Communications, Inc
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
import {
  assertArrayIncludes,
  assertEquals,
  assertRejects,
} from "jsr:@std/assert";
import { getConnectionDetails, randomKvName } from "./credentials.ts";

Deno.test("kvm - add", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = randomKvName();
  await nhg.kvm.add(id, { max_bytes: 1024 * 512 });
  const info = await nhg.kvm.info(id);
  await nhg.kvm.destroy(id);
  assertEquals(info.name, id);
});

Deno.test("kvm - add with config", async () => {
  const nhg = newNHG(getConnectionDetails());
  const id = randomKvName();
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
  const id = randomKvName();
  await kvm.add(id, { max_bytes: 1024 * 512 });
  const buckets = await kvm.list();
  assertArrayIncludes(buckets, [id]);
  await kvm.destroy(id);
});

Deno.test("kvm - info", async () => {
  const kvm = newNHG(getConnectionDetails()).kvm;
  const id = randomKvName();
  await assertRejects(
    () => {
      return kvm.info(id);
    },
    Error,
    "404: 404 nats: bucket not found",
  );

  await kvm.add(id, { max_bytes: 512 * 1024 });
  const info = await kvm.info(id);
  assertEquals(info.name, id);
  await kvm.destroy(id);
});
