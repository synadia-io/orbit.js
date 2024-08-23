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
  addAccount,
  authAccount,
  authUser,
  connectAuth,
  connectUser,
  operator,
  SYS,
  targetAccount,
} from "./utils.ts";

Deno.test("delegated", async () => {
  // build a resolver - need to generate JWTs
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
    operator: await jwt.encodeOperator("O", okp, {
      system_account: sysKP.getPublicKey(),
    }),
    system_account: sysKP.getPublicKey(),
    resolver: "MEMORY",
    resolver_preload: resolverPreload,
  };

  // start the NATS server
  const ns = await ts.NatsServer.start(conf);

  // this is the code for the authorizer, it doesn't check anything
  // it simply, inspect the request for tokens and other things
  class MyAuthorizer implements Authorizer {
    async authorize(
      req: jwt.AuthorizationRequest,
    ): Promise<Partial<jwt.AuthorizationResponse>> {
      console.log(req);
      try {
        // if(req.connect_opts.auth_token !== "letmein") {
        //   return {error: `failed: wrong secret word`};
        // }
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
        // the authorizer is simply returning a struct with the jwt is successful
        return { jwt: token };
      } catch (err) {
        // or an error if it fails or wants to reject
        return { error: `failed: ${err.message}` };
      }
    }
  }

  // the key the service will use to generate JWTs
  const authKP = jwt.checkKey(authAccount, "A", true);

  // create a connection for the service
  const nc = await connectUser(
    ns.port,
    "auth service",
    su,
    authKP,
    jwt.defaultUser(),
    { token: "letmein" },
  );

  // start the server
  const service = await authorizationService(nc, new MyAuthorizer(), authKP);

  const [nc2, _uk] = await connectAuth(ns.port, "sentinel", authKP, {
    token: "hi ho",
  });

  //@ts-ignore: test
  const ctx = await nc2.context();
  console.log(ctx);

  await service.stop();

  await ts.cleanup(ns, nc, nc2);
});
