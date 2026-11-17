#!/usr/bin/env -S deno run --allow-run=git,gh
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

// prints markdown release notes for one module of the monorepo: the pull
// requests that changed files under <module>/ since the module's previous
// release tag, in the format of github's generated notes.
//
//   deno run --allow-run=git,gh bin/release-notes.ts <module> [--to <ref>] [--from <ref>]
//
// --to defaults to HEAD. --from defaults to the newest <module>/v* tag that is
// an ancestor of --to (other than --to itself); prerelease tags are skipped
// unless --to is itself a prerelease, so a final release covers the whole
// cycle. needs git and an authenticated gh.

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error(
    "usage: release-notes.ts <module> [--to <ref>] [--from <ref>]",
  );
  Deno.exit(1);
}

async function run(cmd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command(cmd, { args, stderr: "piped" }).output();
  if (!out.success) {
    throw new Error(
      `${cmd} ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  return new TextDecoder().decode(out.stdout).trim();
}

function isPrerelease(tag: string): boolean {
  return tag.includes("-");
}

const args = [...Deno.args];
const module = args.shift();
if (!module || module.startsWith("-")) usage();
let to = "HEAD";
let from = "";
while (args.length) {
  const a = args.shift();
  if (a === "--to") to = args.shift() ?? usage("--to needs a ref");
  else if (a === "--from") from = args.shift() ?? usage("--from needs a ref");
  else usage(`unknown argument ${a}`);
}

try {
  await run("git", "rev-parse", "--verify", "--quiet", `${to}:${module}`);
} catch {
  usage(`${module}/ doesn't exist at ${to}`);
}

if (!from) {
  // git describe takes --match and --exclude as glob patterns, so a module or
  // ref with glob characters would select the wrong tags instead of failing
  if (/[*?[\]]/.test(module) || /[*?[\]]/.test(to)) {
    usage("the module and --to can't contain glob characters (*, ?, [, ])");
  }
  // the nearest tag in history, git's version sort puts 1.0.0-1 after 1.0.0
  const describe = [
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    `${module}/v*`,
    "--exclude",
    to,
  ];
  if (!isPrerelease(to)) describe.push("--exclude", `${module}/v*-*`);
  try {
    from = await run("git", ...describe, to);
  } catch {
    usage(`no previous ${module}/v* tag before ${to}, pass --from`);
  }
}

const repo = await run(
  "gh",
  "repo",
  "view",
  "--json",
  "nameWithOwner",
  "--jq",
  ".nameWithOwner",
);
const base = `https://github.com/${repo}`;

// squash merges end the subject with the pull request number
const log = await run(
  "git",
  "log",
  "--format=%H%x09%s",
  `${from}..${to}`,
  "--",
  `${module}/`,
);

const lines: string[] = [];
for (const entry of log.split("\n").filter((l) => l !== "")) {
  const [sha, subject] = entry.split("\t");
  const m = subject.match(/\(#(\d+)\)$/);
  if (m) {
    const pr = JSON.parse(
      await run(
        "gh",
        "api",
        `repos/${repo}/pulls/${m[1]}`,
        "--jq",
        "{title: .title, author: .user.login, url: .html_url}",
      ),
    ) as { title: string; author: string; url: string };
    lines.push(`* ${pr.title} by @${pr.author} in ${pr.url}`);
  } else {
    // a commit that didn't come through a pull request
    lines.push(`* ${subject} in ${base}/commit/${sha.slice(0, 7)}`);
  }
}

const toLabel = to === "HEAD" ? await run("git", "rev-parse", "HEAD") : to;
console.log("## What's Changed\n");
console.log(lines.length ? lines.join("\n") : `* no changes to ${module}/`);
console.log(
  `\n**Full Changelog**: ${base}/compare/${from}...${toLabel}`,
);
