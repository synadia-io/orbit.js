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

import { connect, jwtAuthenticator } from "@nats-io/transport-deno";
import * as jwt from "@nats-io/jwt";
import { NatsServer } from "test_helpers";

Deno.test("jwt - user", async () => {
  const okp = jwt.createOperator();
  const resolver_preload: Record<string, string> = {};

  async function createAcc(
    name: string,
    config: Partial<jwt.Account> = {},
  ): Promise<jwt.KeyPair> {
    const akp = jwt.createAccount();
    const limits = Object.assign(jwt.defaultNatsLimits(), { conn: -1 });
    config = Object.assign({ limits }, config);
    const token = await jwt.encodeAccount(name, akp, config, { signer: okp });
    resolver_preload[akp.getPublicKey()] = token;

    console.log(jwt.decode<jwt.Account>(token));

    return akp;
  }

  const sysKp = await createAcc("SYS");
  const akp = await createAcc("A");

  const conf = {
    trace: true,
    operator: await jwt.encodeOperator("O", okp, {
      system_account: sysKp.getPublicKey(),
    }),
    system_account: sysKp.getPublicKey(),
    resolver: "MEMORY",
    resolver_preload,
  };

  const ns = await NatsServer.start(conf, true);

  const ukp = jwt.createUser();
  const uJWT = await jwt.encodeUser("U", ukp, akp, { bearer_token: true });
  console.log(jwt.decode<jwt.User>(uJWT));

  const nc = await connect({
    port: ns.port,
    authenticator: jwtAuthenticator(uJWT),
    debug: true,
  });
  nc.subscribe("hello", {
    callback: (err, msg) => {
      if (err) {
        console.log(err);
      } else {
        console.log(msg.subject);
      }
    },
  });

  await nc.publish("hello");
  await nc.flush();

  await nc.close();
  await ns.stop();
});
