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
import * as jwt from "@nats-io/jwt";
import { authorizationService, Authorizer } from "../src/mod.ts";
import * as ts from "test_helpers";
import { connect } from "@nats-io/transport-deno";
import {
  assertArrayIncludes,
  assertEquals,
  assertRejects,
  fail,
} from "@std/assert";

// the key to sign accounts
const accountA: jwt.Key =
  "SAAGNWU5END33QMSWG3LGWDBQLHYGC4OBIC7KUDZXQIX7ZHUCAOG3XTO2U";

const encryptionKey: jwt.Key =
  "SXAEEYAJLBNS5M7ZVCCEPTLGBDWWYB3P6ESAPPMZRXAO7TICBTPCA5442Y";

Deno.test("encrypted conf", async () => {
  const xkp = jwt.checkKey(encryptionKey, "X", true);
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
      timeout: "2s",
      users: [{ user: "auth", password: "pwd" }],
      auth_callout: {
        // this is the public xkey of the request recipient - the server
        // encrypts request for this identity using this xkey
        xkey: xkp.getPublicKey(),
        issuer: akp.getPublicKey(),
        // the user `auth` will provide credentials, and will not be sent
        // to the auth callout service as it is the auth callout user.
        auth_users: ["auth"],
      },
    },
  };

  const ns = await ts.NatsServer.start(conf, true);
  const nc = await connect({ port: ns.port, user: "auth", pass: "pwd" });

  // Here's an example of the Authorizer, it simply crafts a JWT.
  class EncryptedAuthorizer implements Authorizer {
    async authorize(
      req: jwt.AuthorizationRequest,
    ): Promise<Partial<jwt.AuthorizationResponse>> {
      // by the time we get a request here, the server already unpacked and verified
      // that the request was encrypted for us by the server that sent and encrypted
      // the message. Similarly, the response we send out, is encrypted by the service
      // using the key that is specified for the server that sent the request.
      try {
        // inspect the request however necessary - in this case just a simple
        // test for username and password
        if (
          req.connect_opts.user !== "b" || req.connect_opts.pass !== "hello"
        ) {
          // the response generates an error that server logs
          return { error: "not allowed" };
        }
        // define some permissions/limits
        const user = jwt.defaultUser({
          pub: { allow: ["$SYS.REQ.USER.INFO"] },
          sub: { allow: ["q", "_INBOX.>"] },
          resp: { max: 1 },
        });
        // generate a user JWT
        const token = await jwt.encodeUser(
          // if the client provided a name for the connection we use it
          req.client_info.user || "U",
          // use the server assigned nkey for the connecting user
          req.user_nkey,
          // this is the private key from the account
          akp,
          user,
          // User is placed into account `B`, because the `aud` or audience
          // for the authorization is account `B` - this is in conf only
          // to place into the $G account, simply specify `$G` instead of `B`

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
  const service = await authorizationService(
    nc,
    new EncryptedAuthorizer(),
    akp,
    // here's our encryption key
    xkp,
  );

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

Deno.test("server defines xkey", async () => {
  const xkp = jwt.checkKey(encryptionKey, "X", true);
  const akp = jwt.checkKey(accountA, "A", true);

  const conf = {
    accounts: {
      "B": {},
    },
    authorization: {
      timeout: "2s",
      users: [{ user: "auth", password: "pwd" }],
      auth_callout: {
        // we set an xkey so server encrypts
        xkey: xkp.getPublicKey(),
        issuer: akp.getPublicKey(),
        // the user `auth` will provide credentials, and will not be sent
        // to the auth callout service as it is the auth callout user.
        auth_users: ["auth"],
      },
    },
  };

  const ns = await ts.NatsServer.start(conf, true);
  const nc = await connect({ port: ns.port, user: "auth", pass: "pwd" });

  // requests shouldn't get to the authorizer
  class EncryptedAuthorizer implements Authorizer {
    authorize(
      _: jwt.AuthorizationRequest,
    ): Promise<Partial<jwt.AuthorizationResponse>> {
      fail("shouldn't have been called");
    }
  }

  // the service doesn't specify an xkey, which should make the request fail
  // by the service handler
  const service = await authorizationService(
    nc,
    new EncryptedAuthorizer(),
    akp,
  );

  await assertRejects(
    () => {
      return connect({
        port: ns.port,
        user: "b",
        pass: "hello",
        reconnect: false,
        maxReconnectAttempts: 0,
      });
    },
    Error,
    "'Authorization Violation'",
  );

  await service.stop();
  await ts.cleanup(ns, nc);
});

Deno.test("service defines xkey", async () => {
  const xkp = jwt.checkKey(encryptionKey, "X", true);
  const akp = jwt.checkKey(accountA, "A", true);

  const conf = {
    accounts: {
      "B": {},
    },
    authorization: {
      timeout: "2s",
      users: [{ user: "auth", password: "pwd" }],
      auth_callout: {
        issuer: akp.getPublicKey(),
        // the user `auth` will provide credentials, and will not be sent
        // to the auth callout service as it is the auth callout user.
        auth_users: ["auth"],
      },
    },
  };

  const ns = await ts.NatsServer.start(conf, true);
  const nc = await connect({ port: ns.port, user: "auth", pass: "pwd" });

  // requests shouldn't get to the authorizer
  class EncryptedAuthorizer implements Authorizer {
    authorize(
      _: jwt.AuthorizationRequest,
    ): Promise<Partial<jwt.AuthorizationResponse>> {
      fail("shouldn't have been called");
    }
  }

  // the service specifies an xkey, but server doesn't
  const service = await authorizationService(
    nc,
    new EncryptedAuthorizer(),
    akp,
    // server doesn't define it so it should fail
    xkp,
  );

  await assertRejects(
    () => {
      return connect({
        port: ns.port,
        user: "b",
        pass: "hello",
        reconnect: false,
        maxReconnectAttempts: 0,
      });
    },
    Error,
    "'Authorization Violation'",
  );

  await service.stop();
  await ts.cleanup(ns, nc);
});
