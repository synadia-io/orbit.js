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

import { authorizationService, Authorizer } from "../src/mod.ts";
import * as ts from "test_helpers";
import {
  addAccount,
  authAccount,
  authUser,
  connectAuth,
  connectUser,
  operator,
  SYS,
  SysClient,
  targetAccount,
} from "./utils.ts";
import * as jwt from "@nats-io/jwt";
import { nuid } from "@nats-io/transport-deno";
import { assertArrayIncludes } from "@std/assert";

Deno.test("dynamic", async () => {
  const okp = jwt.checkKey(operator, "O", true);
  const sysKP = jwt.checkKey(SYS, "A", true);
  const resolverPreload: Record<string, string> = {};

  const targetKP = jwt.checkKey(targetAccount, "A", true);
  const su = jwt.checkKey(authUser, "U", true);

  await addAccount(resolverPreload, "$SYS", SYS);
  await addAccount(resolverPreload, "A", targetAccount);
  await addAccount(resolverPreload, "AUTH", authAccount, {
    authorization: {
      auth_users: [su.getPublicKey()],
      allowed_accounts: [targetKP.getPublicKey()],
    },
  });

  const conf = {
    debug: true,
    operator: await jwt.encodeOperator("O", okp, {
      system_account: sysKP.getPublicKey(),
    }),
    system_account: sysKP.getPublicKey(),
    resolver: {
      type: "full",
      dir: `/tmp/jwts_${nuid.next()}`,
      allow_delete: true,
      interval: "2s",
      timeout: "1.9s",
    },
    resolver_preload: resolverPreload,
  };

  const ns = await ts.NatsServer.start(conf, true);

  const authKP = jwt.checkKey(authAccount, "A", true);

  const nc = await connectUser(
    ns.port,
    "auth service",
    su,
    authKP,
    jwt.defaultUser(),
  );

  // map auth tokens to users, so we can revoke them
  const tokens = new Map<string, string>();

  class MyAuthorizer implements Authorizer {
    async authorize(
      req: jwt.AuthorizationRequest,
    ): Promise<Partial<jwt.AuthorizationResponse>> {
      console.log("req", req);
      try {
        const user = jwt.defaultUser({
          pub: { allow: ["$SYS.REQ.USER.INFO", "hello.>"] },
          sub: { allow: ["q", "_INBOX.>"] },
          resp: { max: 1 },
        });
        const token = await jwt.encodeUser(
          req.client_info.user!,
          req.user_nkey,
          targetKP,
          user,
        );
        tokens.set(req.connect_opts.auth_token || "notset", req.user_nkey);
        // the authorizer is simply returning a struct with the jwt is successful
        return { jwt: token };
      } catch (err) {
        // or an error if it fails or wants to reject
        return { error: `failed: ${err.message}` };
      }
    }
  }

  await authorizationService(nc, new MyAuthorizer(), authKP);

  // client connect to the auth service
  const [nc2] = await connectAuth(ns.port, "sentinel", authKP, {
    name: "hello",
    token: "hi ho",
    reconnect: false,
  });

  // @ts-ignore: internal
  const r = await nc2.context();
  assertArrayIncludes(r.data.permissions.publish.allow, ["hello.>"]);
  assertArrayIncludes(r.data.permissions.subscribe.allow, ["q"]);

  // update the account JWT with a revocations
  const revocations: Record<string, number> = {};
  const revID = tokens.get("hi ho") || "unknown";
  revocations[revID] = Math.round(Date.now() / 1000);
  const token = await jwt.encodeAccount("A", targetAccount, {
    revocations: revocations,
  }, { signer: okp });

  // now we are going to revoke the user, by updating the account
  const sys = new SysClient(
    await connectUser(ns.port, "sys", jwt.createUser(), SYS),
  );
  await sys.updateAccount(
    token,
  );

  // nc2 will disconnect, we don't reconnect so it should close
  await nc2.closed();

  await ts.cleanup(ns, nc, sys.nc);
});
