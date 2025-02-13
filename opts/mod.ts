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

type ConnectionProperty = Omit<
  keyof ConnectionOptions & { creds: string },
  "authenticator" | "reconnectDelayHandler"
>;

const booleanProps = [
  "debug",
  "ignoreAuthErrorAbort",
  "ignoreClusterUpdates",
  "noAsyncTraces",
  "noEcho",
  "noRandomize",
  "pedantic",
  "reconnect",
  "resolve",
  "tls",
  "verbose",
  "waitOnFirstConnect",
] as const;

const numberProps = [
  "maxPingOut",
  "maxReconnectAttempts",
  "pingInterval",
  "reconnectJitter",
  "reconnectJitterTLS",
  "reconnectTimeWait",
  "port",
  "timeout",
] as const;

const stringProps = [
  "name",
  "pass",
  "token",
  "user",
  "inboxPrefix",
] as const;
const arrayProps = ["servers"] as const;

export function encode(opts: Partial<ConnectionOptions>): string {
  const u = new URL("http://nothing:80");
  arrayProps.forEach((n) => {
    let v = opts[n] as string[] | string;
    if (!Array.isArray(v)) {
      v = [v];
    }
    if (v) {
      v.forEach((s) => {
        u.searchParams.append(n, encodeURIComponent(s));
      });
    }
  });

  stringProps.forEach((n) => {
    const v = opts[n] as string | undefined;
    if (v) {
      u.searchParams.append(n, encodeURIComponent(v));
    }
  });

  numberProps.forEach((n) => {
    const v = opts[n] as number | undefined;
    if (typeof v === "number") {
      u.searchParams.append(n, v.toString());
    }
  });

  booleanProps.forEach((n) => {
    const v = opts[n] as boolean | undefined;
    if (typeof v === "boolean") {
      u.searchParams.append(n, v ? "true" : "false");
    }
  });

  return `nats-opts:${u.searchParams.toString()}`;
}

export function parse(
  str = "",
): Promise<Partial<ConnectionOptions>> {
  if (str === "") {
    return Promise.resolve({ servers: "127.0.0.1:4222" });
  }

  // some implementations of URL.parse() only handle "http/s" rip the protocol
  // url parsing will inject host/port defaults based on the protocol...
  // maybe we just ignore that and explicitly look for
  // server=
  if (!str.startsWith("nats-opts:")) {
    return Promise.reject(
      new Error(
        "Invalid connection string. Must start with encoded-opts:",
      ),
    );
  }

  const u = URL.parse(`http://nothing:80?${str.substring(10)}`);
  if (u === null) {
    return Promise.reject(new Error(`failed to parse '${str}'`));
  }

  const opts: Record<string, boolean | number | string | string[]> = {};

  function configBoolean(
    n: string,
  ) {
    const v = u?.searchParams.get(n) || null;
    if (v !== null) {
      opts[n] = v === "true";
    }
  }

  function configNumber(
    n: string,
  ) {
    const v = u?.searchParams.get(n) || null;
    if (v !== null) {
      opts[n] = parseInt(v);
    }
  }

  function configStringArray(n: string, defaultValue = "") {
    let a = u?.searchParams.getAll(n);
    a = a?.map((s) => decodeURIComponent(s));
    if (defaultValue && a === null) {
      a = [defaultValue];
    }
    if (a) {
      opts[n] = a;
    }
  }

  function configString(n: string) {
    const v = u?.searchParams.get(n);
    if (v) {
      opts[n] = decodeURIComponent(v);
    }
  }

  booleanProps.forEach((n) => {
    configBoolean(n);
  });

  stringProps.forEach((n) => {
    configString(n);
  });

  numberProps.forEach((n) => {
    configNumber(n);
  });

  arrayProps.forEach((n) => {
    configStringArray(n);
  });

  return Promise.resolve(opts);
}
