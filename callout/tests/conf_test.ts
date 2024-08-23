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

import * as ts from "test_helpers";
import * as jwt from "@nats-io/jwt";
import { authorizationService, Authorizer } from "../src/mod.ts";
import { connect } from "@nats-io/transport-deno";
import { assertArrayIncludes, assertEquals } from "@std/assert";

const accountA: jwt.Key =
  "SAAGNWU5END33QMSWG3LGWDBQLHYGC4OBIC7KUDZXQIX7ZHUCAOG3XTO2U";

Deno.test("conf", async () => {
  const akp = jwt.checkKey(accountA, "A", true);

  // this is an example of a server configuration that uses the
  // authorizer to place users into account B. The server expects
  // the authorization to be signed by the specified account nkey.
  // Note that this is using conf accounts, not delegated - so no
  // no account JWTs.
  const conf = {
    accounts: {
      "B": {},
    },
    authorization: {
      timeout: "1s",
      users: [{ user: "auth", password: "pwd" }],
      auth_callout: {
        issuer: akp.getPublicKey(),
        // the user `auth` will provide credentials, and will not be sent
        // to the auth callout service as it is the auth callout user.
        auth_users: ["auth"],
      },
    },
  };

  const { ns, nc } = await ts.setup(conf, {
    user: "auth",
    pass: "pwd",
  });

  // Here's an example of the Authorizer, it simply crafts a JWT.
  class ConfAuthorizer implements Authorizer {
    async authorize(
      req: jwt.AuthorizationRequest,
    ): Promise<Partial<jwt.AuthorizationResponse>> {
      try {
        const user = jwt.defaultUser({
          pub: { allow: ["$SYS.REQ.USER.INFO"] },
          sub: { allow: ["q", "_INBOX.>"] },
          resp: { max: 1 },
        });
        const token = await jwt.encodeUser(
          req.client_info.user || "U",
          req.user_nkey,
          akp,
          user,
          // User is placed into account `B`, because the `aud` or audience
          // for the authorization is account `B` - this is in conf only
          // to place into the $G account, simply specify that instead of `B`
          { aud: "B" },
        );
        // the authorizer is simply returning a struct with the jwt is successful
        return { jwt: token };
      } catch (err) {
        // or an error if it fails or wants to reject
        return { error: `failed: ${err.message}` };
      }
    }
  }

  // This is the authorizationService - which is effectively boilerplate for
  // handling requests to `$SYS.REQ.USER.AUTH` - the service will decode the request,
  // perform some simple checks, and use the authorizer to create the JWTs,
  // it will then package the returned response from the authorizer into
  // a JWT which is signed with the account key (in case of conf, same signer)
  // and return it to the NATS server
  const service = await authorizationService(nc, new ConfAuthorizer(), akp);

  const nc2 = await connect({
    port: ns.port,
    user: "b",
    pass: "hello",
  });

  //@ts-ignore: test
  const ctx = await nc2.context();
  assertEquals(ctx.data.user, "b");
  assertEquals(ctx.data.account, "B");
  assertArrayIncludes(ctx.data.permissions.publish.allow, [
    "$SYS.REQ.USER.INFO",
  ]);
  assertArrayIncludes(ctx.data.permissions.subscribe.allow, ["q", "_INBOX.>"]);
  assertEquals(ctx.data.permissions.responses.max, 1);

  await service.stop();

  await ts.cleanup(ns, nc, nc2);
});
