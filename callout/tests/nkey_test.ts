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
import {
  connect,
  createInbox,
  delay,
  nkeyAuthenticator,
} from "@nats-io/transport-deno";

const accountA: jwt.Key =
  "SAAGNWU5END33QMSWG3LGWDBQLHYGC4OBIC7KUDZXQIX7ZHUCAOG3XTO2U";

const authUser: jwt.Key =
  "SUACSSL3UAHUDXKFSNVUZRF5UHPMWZ6BFDTJ7M6USDXIEDNPPQYYYCU3VY";

const user: jwt.Key =
  "SUAHDHT5JIKEM4BW55GUX4P2PECHD6VSTIFEA6NU34DVSJZA2LO45R6OTE";

Deno.test("nkey", async () => {
  const akp = jwt.checkKey(accountA, "A", true);
  const authKP = jwt.checkKey(authUser, "U", true);

  // this is an example of a server configuration that uses the
  // authorizer to place users into account B. The server expects
  // the authorization to be signed by the specified account nkey.
  // Note that this is using conf accounts, not delegated - so no
  // no account JWTs.
  const conf = {
    accounts: {
      B: {},
    },
    authorization: {
      timeout: "1s",
      users: [{ nkey: authKP.getPublicKey() }],
      auth_callout: {
        issuer: akp.getPublicKey(),
        // the user `auth` will provide credentials, and will not be sent
        // to the auth callout service as it is the auth callout user.
        auth_users: [authKP.getPublicKey()],
      },
    },
  };

  const { ns, nc } = await ts.setup(conf, {
    authenticator: nkeyAuthenticator(new TextEncoder().encode(authUser)),
  });

  // Here's an example of the Authorizer, it simply crafts a JWT.
  class MyAuthorizer implements Authorizer {
    async authorize(
      req: jwt.AuthorizationRequest,
    ): Promise<Partial<jwt.AuthorizationResponse>> {
      try {
        console.log("authorizing", req);
        const user = jwt.defaultUser({
          pub: { allow: ["$SYS.REQ.USER.INFO", "q"] },
          sub: { allow: ["q", "_INBOX.>"] },
          resp: { max: 10 },
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
  const service = await authorizationService(nc, new MyAuthorizer(), akp);
  service.stopped.then((err: Error | null) => {
    console.log("authorizer closed", err);
  });

  const nc2 = await connect({
    port: ns.port,
    authenticator: nkeyAuthenticator(new TextEncoder().encode(user)),
    debug: true,
  });

  (async () => {
    for await (const s of nc2.status()) {
      console.log(s);
    }
  })();

  const inbox = createInbox();
  nc2.subscribe("q", {
    callback: (_err, msg) => {
      for (let i = 0; i < 10; i++) {
        msg.respond(i + "");
      }
    },
  });
  nc2.subscribe(inbox, {
    callback: (_err, msg) => {
      console.log(msg.subject);
    },
  });

  nc2.publish("q", "", { reply: inbox });

  await delay(1000);
  console.log(">>>> reconnecting");
  nc2.reconnect();
  await delay(5000);

  //@ts-ignore: test
  // const ctx = await nc2.context();
  // assertEquals(ctx.data.user, "b");
  // assertEquals(ctx.data.account, "B");
  // assertArrayIncludes(ctx.data.permissions.publish.allow, [
  //   "$SYS.REQ.USER.INFO",
  // ]);
  // assertArrayIncludes(ctx.data.permissions.subscribe.allow, ["q", "_INBOX.>"]);
  // assertEquals(ctx.data.permissions.responses.max, 1);

  await service.stop();

  //@ts-ignore: just types
  await ts.cleanup(ns, nc, nc2);
});
