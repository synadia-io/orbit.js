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

import { ensureDir } from "@std/fs";
import { join } from "@std/path";

interface ProjectConfig {
  name: string;
  description: string;
  version?: string;
  author?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

class ProjectTemplateGenerator {
  private projectName: string;
  private config: ProjectConfig;
  private basePath: string;

  constructor(projectName: string, config: ProjectConfig, basePath = ".") {
    this.projectName = projectName;
    this.config = config;
    this.basePath = basePath;
  }

  async generate(): Promise<void> {
    const projectPath = join(this.basePath, this.projectName);
    await ensureDir(projectPath);
    await ensureDir(join(projectPath, "src"));
    await ensureDir(join(this.basePath, ".github", "workflows"));

    await this.createDenoJson(projectPath);
    await this.createPackageJson(projectPath);
    await this.createTsConfig(projectPath);
    await this.createMainWorkflowYml();
    await this.createEsmWorkflowYml();
    await this.createNpmWorkflowYml();
    await this.createModTs(projectPath);
    await this.createLicense(projectPath);
    await this.createReadme(projectPath);

    console.log(`Project "${this.projectName}" created successfully!`);
    console.log(`Location: ${projectPath}`);
  }

  private async createDenoJson(projectPath: string): Promise<void> {
    const denoConfig = {
      name: `@synadiaorbit/${this.projectName}`,
      version: this.config.version || "1.0.0-1",
      exports: {
        ".": "./src/mod.ts",
      },
      publish: {
        exclude: ["./examples"],
      },
      tasks: {},
      imports: {
        "@nats-io/nats-core": "jsr:@nats-io/nats-core@^3.1.0",
        "@std/assert": "jsr:@std/assert@^1.0.14",
        ...this.config.dependencies,
      },
      nodeModulesDir: "auto",
    };

    await Deno.writeTextFile(
      join(projectPath, "deno.json"),
      JSON.stringify(denoConfig, null, 2),
    );
  }

  private async createPackageJson(projectPath: string): Promise<void> {
    const packageConfig = {
      name: `@synadiaorbit/${this.projectName}`,
      version: this.config.version || "1.0.0-1",
      files: [
        "lib/",
        "LICENSE",
        "README.md",
      ],
      types: "./lib/mod.d.js",
      exports: {
        ".": "./lib/mod.js",
      },
      license: "Apache-2.0",
      repository: {
        type: "git",
        url: "git+https://github.com/synadia-io/orbit.js.git",
      },
      private: false,
      scripts: {
        "real-clean": "npm run clean && shx rm -Rf ./node_modules",
        "clean": "shx rm -Rf ./build ./lib",
        "pre-process":
          "npm run clean && deno run -A ../bin/cjs-fix-imports.ts -o ./build/src ./src",
        "build-cjs": "npm run pre-process && tsc",
        "build": "npm run build-cjs",
        "prepack": "npm run build",
        "bump-qualifier":
          "npm version prerelease --no-commit-hooks --no-git-tag-version",
        "bump-release":
          "npm version patch --no-commit-hooks --no-git-tag-version",
      },
      keywords: [],
      author: {
        name: this.config.author || "The NATS Authors",
      },
      description: this.config.description,
      dependencies: {
        "@nats-io/nats-core": "3.1.0",
        ...this.config.dependencies,
      },
      devDependencies: {
        "@types/node": "^24.5.0",
        "shx": "^0.4.0",
        "typescript": "^5.9.2",
        ...this.config.devDependencies,
      },
    };

    await Deno.writeTextFile(
      join(projectPath, "package.json"),
      JSON.stringify(packageConfig, null, 2),
    );
  }

  private async createTsConfig(projectPath: string): Promise<void> {
    const tsConfig = {
      compilerOptions: {
        target: "esnext",
        module: "nodenext",
        outDir: "./lib/",
        moduleResolution: "nodenext",
        sourceMap: true,
        declaration: true,
        allowJs: true,
        removeComments: false,
        resolveJsonModule: true,
      },
      include: [
        "./build/src/**/*",
      ],
    };

    await Deno.writeTextFile(
      join(projectPath, "tsconfig.json"),
      JSON.stringify(tsConfig, null, 2),
    );
  }

  private async createMainWorkflowYml(): Promise<void> {
    const workflow = `name: ${this.projectName}

on:
  push:
    paths:
      - "${this.projectName}/**"
    branches:
      - "*"
  pull_request:
    paths:
      - "${this.projectName}/**"
    branches: [main]

jobs:
  test:
    name: \${{ matrix.config.kind }} \${{ matrix.config.os }}
    runs-on: ubuntu-latest
    environment: CI
    strategy:
      matrix:
        deno-version: [2.5.x]

    steps:
      - name: Git Checkout
        uses: actions/checkout@v3
        with:
          fetch-depth: 1

      - name: Use Deno Version \${{ matrix.deno-version }}
        uses: denoland/setup-deno@v1
        with:
          deno-version: \${{ matrix.deno-version }}

      - name: Lint Deno Module
        working-directory: ${this.projectName}
        run: |
          deno fmt --check --ignore=docs/

      - name: Test Deno Module
        working-directory: ${this.projectName}
        env:
          TMPDIR: \${{ runner.temp }}
          CI: true
        run: |
          deno test --allow-all --unstable --parallel --fail-fast --coverage=./cov
`;

    await Deno.writeTextFile(
      join(this.basePath, ".github", "workflows", `${this.projectName}.yml`),
      workflow,
    );
  }

  private async createEsmWorkflowYml(): Promise<void> {
    const workflow = `name: ${this.projectName} jsr release

on:
  release:
    types: [created]
    tags:
      - "${this.projectName}/*"

jobs:
  test:
    environment: CI
    strategy:
      matrix:
        deno-version: [2.5.x]

    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Git Checkout
        uses: actions/checkout@v3
        with:
          fetch-depth: 1
      - name: Use Deno Version \${{ matrix.deno-version }}
        uses: denoland/setup-deno@v1
        with:
          deno-version: \${{ matrix.deno-version }}
      - name: Test
        working-directory: ${this.projectName}
        run: |
          deno test -A
          deno task clean
      - name: Publish
        working-directory: ${this.projectName}
        run: deno publish
`;

    await Deno.writeTextFile(
      join(
        this.basePath,
        ".github",
        "workflows",
        `${this.projectName}_esm.yml`,
      ),
      workflow,
    );
  }

  private async createNpmWorkflowYml(): Promise<void> {
    const workflow = `name: ${this.projectName} npm release

on:
  release:
    types: [created]
    tags:
      - "${this.projectName}/*"

jobs:
  test:
    environment: CI
    strategy:
      matrix:
        deno-version: [2.5.x]
        node-version: [24.x]

    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - name: Git Checkout
        uses: actions/checkout@v3
        with:
          fetch-depth: 1
      - name: Use Deno Version \${{ matrix.deno-version }}
        uses: denoland/setup-deno@v1
        with:
          deno-version: \${{ matrix.deno-version }}
      - name: Use Node.js \${{ matrix.node-version }}
        uses: actions/setup-node@v3
        with:
          node-version: \${{ matrix.node-version }}
          registry-url: "https://registry.npmjs.org"

      - name: Test
        working-directory: ${this.projectName}
        run: |
          npm install
          npm run build
      - name: Publish
        run: |
          cd ${this.projectName}
          npm publish --provenance --access public --tag=latest
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;

    await Deno.writeTextFile(
      join(
        this.basePath,
        ".github",
        "workflows",
        `${this.projectName}_npm.yml`,
      ),
      workflow,
    );
  }

  private async createModTs(projectPath: string): Promise<void> {
    const modContent = `/*
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

export class ${
      this.projectName.charAt(0).toUpperCase() + this.projectName.slice(1)
    } {
  // TODO: Implement your module here
}
`;

    await Deno.writeTextFile(
      join(projectPath, "src", "mod.ts"),
      modContent,
    );
  }

  private async createLicense(projectPath: string): Promise<void> {
    const license = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (which shall not include communications that are submitted to
      Licensor for purposes of discussing and improving the Work, but
      excluding communications that are marked or otherwise
      designated in writing by the Licensor as "Not a Contribution.")

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control
      systems, and issue tracking systems that are managed by, or on behalf
      of, the Licensor for the purpose of discussing and improving the Work,
      but excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to use, reproduce, modify, merge, publish,
      distribute, sublicense, and/or sell copies of the Work, and to
      permit persons to whom the Work is furnished to do so, subject to
      the following conditions:

      The above copyright notice and this permission notice shall be
      included in all copies or substantial portions of the Work.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, trademark, patent,
          attribution and other notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright notice within Derivative Works that
      You distribute, alongside or as an addendum to the NOTICE text from
      the Work, provided that such additional copyright notice cannot be
      construed as modifying the License.

      You may add Your own license terms to Your use, reproduction, and
      distribution of the Work or Derivative Works thereof, provided that
      Your use, reproduction, and distribution of the Work otherwise
      complies with the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Support. You may choose to offer, and to
      charge a fee for, warranty, support, indemnity or other liability
      obligations and/or rights consistent with this License. However, in
      accepting such obligations, You may act only on Your own behalf and on
      Your sole responsibility, not on behalf of any other Contributor, and
      only if You agree to indemnify, defend, and hold each Contributor
      harmless for any liability incurred by, or claims asserted against,
      such Contributor by reason of your accepting any such warranty or support.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
`;

    await Deno.writeTextFile(
      join(projectPath, "LICENSE"),
      license,
    );
  }

  private async createReadme(projectPath: string): Promise<void> {
    const readme = `# ${this.projectName}

${this.config.description}

## Installation

### Deno
\`\`\`typescript
import { ${
      this.projectName.charAt(0).toUpperCase() + this.projectName.slice(1)
    } } from "@synadiaorbit/${this.projectName}";
\`\`\`

### Node.js
\`\`\`bash
npm install @synadiaorbit/${this.projectName}
\`\`\`

\`\`\`typescript
import { ${
      this.projectName.charAt(0).toUpperCase() + this.projectName.slice(1)
    } } from "@synadiaorbit/${this.projectName}";
\`\`\`

## Usage

TODO: Add usage examples

## License

Apache License 2.0
`;

    await Deno.writeTextFile(
      join(projectPath, "README.md"),
      readme,
    );
  }
}

// CLI interface
async function main() {
  const args = Deno.args;

  if (args.length < 2) {
    console.error(
      "Usage: create-project-template.ts <project-name> <description> [options]",
    );
    console.error("Options:");
    console.error(
      "  --version <version>     Set project version (default: 1.0.0-1)",
    );
    console.error(
      "  --author <author>       Set project author (default: The NATS Authors)",
    );
    console.error(
      "  --base-path <path>      Set base path for project creation (default: .)",
    );
    Deno.exit(1);
  }

  const projectName = args[0];
  const description = args[1];

  let version = "1.0.0-1";
  let author = "Synadia Communications, Inc."

    let basePath = ".";

  // Parse additional options
  for (let i = 2; i < args.length; i += 2) {
    switch (args[i]) {
      case "--version":
        version = args[i + 1];
        break;
      case "--base-path":
        basePath = args[i + 1];
        break;
    }
  }

  const config: ProjectConfig = {
    name: projectName,
    description,
    version,
    author,
  };

  const generator = new ProjectTemplateGenerator(projectName, config, basePath);
  await generator.generate();
}

if (import.meta.main) {
  await main();
}
