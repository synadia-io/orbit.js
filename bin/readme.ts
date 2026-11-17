#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/*
 * Copyright 2026 Synadia Communications, Inc
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

// writes the module list in README.md from modules.json, between the
// modules:start and modules:end markers. with --check it only reports
// whether README.md is current, for ci.
//
//   deno run --allow-read --allow-write --allow-run bin/readme.ts [--check]
//
// run it from the repository root. a module's package name comes from its
// deno.json, and it gets an npm badge only if it has a package.json.

type Module = {
  title: string;
  description: string;
  status: "stable" | "incubating";
};

const start = "<!-- modules:start -->";
const end = "<!-- modules:end -->";
const check = Deno.args.includes("--check");

function fail(msg: string): never {
  console.error(msg);
  Deno.exit(1);
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p);
    return true;
  } catch {
    return false;
  }
}

const modules = JSON.parse(
  await Deno.readTextFile("modules.json"),
) as Record<string, Module>;

// same layout as the other orbit repositories: a table, the module name links
// to its README, and the badge
// images and links as references below it. the jsr badge links to the api
// docs, like the go reference badge in orbit.go
const rows = [
  "| Module | Description | Status | Version |",
  "| --- | --- | --- | --- |",
];
const refs: string[] = [];
for (const [dir, m] of Object.entries(modules)) {
  if (!await exists(`${dir}/deno.json`)) {
    fail(`modules.json lists ${dir}, but ${dir}/deno.json doesn't exist`);
  }
  if (!m.title || !m.description) {
    fail(`${dir}: modules.json needs a title and a description`);
  }
  if (m.status !== "stable" && m.status !== "incubating") {
    fail(`${dir}: status must be stable or incubating, not ${m.status}`);
  }
  const { name } = JSON.parse(
    await Deno.readTextFile(`${dir}/deno.json`),
  ) as { name: string };

  const badges = [`[![JSR][${dir}-jsr-image]][${dir}-jsr-url]`];
  refs.push(
    `[${dir}-jsr-url]: https://jsr.io/${name}/doc`,
    `[${dir}-jsr-image]: https://jsr.io/badges/${name}`,
  );
  if (await exists(`${dir}/package.json`)) {
    badges.push(`[![npm][${dir}-npm-image]][${dir}-npm-url]`);
    refs.push(
      `[${dir}-npm-url]: https://www.npmjs.com/package/${name}`,
      `[${dir}-npm-image]: https://img.shields.io/npm/v/${
        encodeURIComponent(name)
      }`,
    );
  }

  rows.push(
    `| [${m.title}](${dir}/README.md) | ${m.description} | ${m.status} | ${
      badges.join(" ")
    } |`,
  );
}
const sections = [rows.join("\n"), refs.join("\n")];

// every module directory in the repository should be listed
for await (const e of Deno.readDir(".")) {
  if (
    e.isDirectory && !e.name.startsWith(".") && e.name !== "bin" &&
    await exists(`${e.name}/deno.json`) && !(e.name in modules)
  ) {
    fail(`${e.name}/ has a deno.json but isn't listed in modules.json`);
  }
}

const readme = await Deno.readTextFile("README.md");
const i = readme.indexOf(start);
const j = readme.indexOf(end);
if (i === -1 || j === -1 || j < i) {
  fail(`README.md needs the ${start} and ${end} markers`);
}
// format the way `deno fmt` would, so the check agrees with the formatter
async function fmt(md: string): Promise<string> {
  const p = new Deno.Command(Deno.execPath(), {
    args: ["fmt", "--ext=md", "-"],
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(md));
  await w.close();
  const out = await p.output();
  if (!out.success) fail("deno fmt failed on README.md");
  return new TextDecoder().decode(out.stdout);
}

const next = await fmt(
  readme.slice(0, i + start.length) + "\n\n" + sections.join("\n\n") +
    "\n\n" + readme.slice(j),
);

if (check) {
  if (next !== readme) {
    fail(
      "README.md is out of date, run: deno run -A bin/readme.ts",
    );
  }
  console.log("README.md is current");
} else if (next !== readme) {
  await Deno.writeTextFile("README.md", next);
  console.log("README.md updated");
} else {
  console.log("README.md is current");
}
