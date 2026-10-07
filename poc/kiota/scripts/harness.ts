import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  codeManifest,
  command,
  config,
  files,
  json,
  outputRoot,
  root,
  type Stage,
  sha256,
  stage,
} from "./common";

const name = process.argv[2];
const variant = process.argv[3] ?? "raw";
const target = config.targets.find((t) => t.target === name);
if (!target?.harness) throw new Error(`No harness for ${name}`);
const out = path.join(outputRoot, `${name}-${variant}`);
const sdk = path.join(out, "sdk");
const consumer = path.join(out, "consumer");
const log = (label: string) => path.join(out, "logs", `${label}.txt`);
const resultFile = path.join(out, "reports/result.json");
const result = await Bun.file(resultFile).json();
const template = (language: string) =>
  path.join(root, "poc/kiota/harness", language);
const version = `0.0.0-poc-${variant}`;
const env = { POC_TARGET_DIR: out };

class Failure extends Error {
  constructor(
    readonly step: Stage,
    readonly status: "failed" | "blocked",
    message: string,
  ) {
    super(message);
  }
}
async function execute(
  step: Stage,
  label: string,
  argv: string[],
  cwd = root,
  extraEnv: Record<string, string> = {},
) {
  const execution = await command(argv, log(label), cwd, {
    ...env,
    ...extraEnv,
  });
  result.evidencePaths.push(path.relative(root, execution.log));
  if (execution.exitCode)
    throw new Failure(
      step,
      execution.exitCode === 127 ? "blocked" : "failed",
      `${label} exited ${execution.exitCode}; see ${path.relative(root, execution.log)}`,
    );
  return execution;
}
async function tool(key: string, argv: string[]) {
  const execution = await execute("buildOrLoad", `${key}-version`, argv);
  result.runtimeVersions[key] = execution.output.trim();
}
async function copyTemplate(
  language: string,
  destination: string,
  include: string[],
) {
  await mkdir(destination, { recursive: true });
  for (const file of include)
    await cp(
      path.join(template(language), file),
      path.join(destination, file),
      { recursive: true },
    );
}
async function lock(language: string, names: string[]) {
  for (const file of names) {
    const location = path.join(template(language), file);
    if (await Bun.file(location).exists())
      result.dependencyLockHash[`${language}/${file}`] = sha256(
        await Bun.file(location).bytes(),
      );
    else
      throw new Failure(
        "buildOrLoad",
        "blocked",
        `Missing committed dependency lock ${language}/${file}`,
      );
  }
}
async function runWire(argv: string[]) {
  const execution = await command(
    ["bun", "run", path.join(root, "poc/kiota/scripts/wire.ts"), ...argv],
    log("wire-evaluation"),
    root,
    env,
  );
  result.evidencePaths.push(
    path.relative(root, execution.log),
    path.relative(root, path.join(out, "reports/wire-cases.json")),
    path.relative(root, path.join(out, "reports/http-requests.json")),
  );
  result.wireContract = stage(
    execution.exitCode ? "failed" : "passed",
    execution.output.trim(),
  );
  if (name === "Kotlin")
    result.kotlinInterop = stage(
      execution.exitCode ? "failed" : "passed",
      "Separate Kotlin 2.1.20 consumer of the Java JAR; synchronous JVM API, nullable/enum/union/error calls",
    );
  if (execution.exitCode)
    result.blockers.push(
      "Common wire fixtures failed; inspect per-case evidence",
    );
}

try {
  if (result.generation.status !== "passed")
    throw new Failure(
      "buildOrLoad",
      "blocked",
      "Generation did not produce a client",
    );
  await rm(sdk, { recursive: true, force: true });
  await rm(consumer, { recursive: true, force: true });
  await rm(path.join(out, "packages"), { recursive: true, force: true });
  await mkdir(consumer, { recursive: true });
  const sourceManifest = await codeManifest(
    path.join(out, "generated"),
    target.extension,
  );
  if (Object.keys(sourceManifest).length !== result.generatedSourceFiles)
    throw new Failure(
      "buildOrLoad",
      "failed",
      "Source inventory changed after generation",
    );
  await json(path.join(out, "reports/build-inputs.json"), sourceManifest);
  if (name === "CSharp") {
    await tool("dotnet", ["dotnet", "--version"]);
    await lock("dotnet", ["packages.lock.json"]);
    await copyTemplate("dotnet", sdk, ["SDK.csproj", "packages.lock.json"]);
    await cp(path.join(out, "generated"), path.join(sdk, "generated"), {
      recursive: true,
    });
    await execute(
      "buildOrLoad",
      "restore",
      ["dotnet", "restore", "SDK.csproj", "--locked-mode"],
      sdk,
    );
    await execute(
      "buildOrLoad",
      "build",
      [
        "dotnet",
        "build",
        "SDK.csproj",
        "--no-restore",
        "-c",
        "Release",
        `-p:Version=${version}`,
      ],
      sdk,
    );
    result.buildOrLoad = stage(
      "passed",
      `${result.generatedSourceFiles} generated C# source inputs`,
    );
    const packages = path.join(out, "packages");
    await execute(
      "packageConsumer",
      "package",
      [
        "dotnet",
        "pack",
        "SDK.csproj",
        "--no-build",
        "-c",
        "Release",
        "-o",
        packages,
        `-p:Version=${version}`,
      ],
      sdk,
    );
    await copyTemplate("dotnet-consumer", consumer, [
      "Consumer.csproj",
      "Program.cs",
    ]);
    if (variant === "raw") {
      const program = path.join(consumer, "Program.cs");
      await Bun.write(
        program,
        (await Bun.file(program).text())
          .replace(
            /VerificationStatusAsGetVerificationStatusQueryParameterType=Enum\.Parse<[^>]+>\(([^;]+)\.GetValue<string>\(\),true\)/g,
            "VerificationStatus=$1.GetValue<string>()",
          )
          .replace(
            /EntryTypeAsGetEntryTypeQueryParameterType=Enum\.Parse<[^>]+>\(([^;]+)\.GetValue<string>\(\),true\)/g,
            "EntryType=$1.GetValue<string>()",
          ),
      );
    }
    const project = path.join(consumer, "Consumer.csproj");
    await Bun.write(
      project,
      (await Bun.file(project).text()).replaceAll("0.0.0-poc-overlay", version),
    );
    await execute(
      "packageConsumer",
      "consumer-install",
      [
        "dotnet",
        "restore",
        "Consumer.csproj",
        "--packages",
        path.join(consumer, ".packages"),
        "--source",
        packages,
        "--source",
        "https://api.nuget.org/v3/index.json",
      ],
      consumer,
    );
    await execute(
      "packageConsumer",
      "consumer-build",
      ["dotnet", "build", "Consumer.csproj", "--no-restore"],
      consumer,
    );
    result.packageConsumer = stage(
      "passed",
      "NuGet artifact restored in an independent consumer with a fresh package cache",
    );
    await runWire([
      "dotnet",
      path.join(consumer, "bin/Debug/net8.0/Consumer.dll"),
    ]);
  } else if (name === "Java" || name === "Kotlin") {
    const mvn = process.env.MAVEN_BIN ?? "mvn";
    await tool("java", ["java", "-version"]);
    await tool("maven", [mvn, "--version"]);
    await copyTemplate("java", sdk, ["pom.xml"]);
    await cp(path.join(out, "generated"), path.join(sdk, "generated"), {
      recursive: true,
    });
    const pom = path.join(sdk, "pom.xml");
    await Bun.write(
      pom,
      (await Bun.file(pom).text()).replace(
        "<version>0.0.0-poc</version>",
        `<version>${version}</version>`,
      ),
    );
    await execute(
      "buildOrLoad",
      "build",
      [mvn, "-B", "package", "-DskipTests"],
      sdk,
    );
    await execute(
      "buildOrLoad",
      "dependencies",
      [
        mvn,
        "-B",
        "dependency:tree",
        `-DoutputFile=${path.join(out, "reports/maven-dependencies.txt")}`,
      ],
      sdk,
    );
    result.dependencyLockHash["java/pom.xml"] = sha256(
      await Bun.file(path.join(template("java"), "pom.xml")).bytes(),
    );
    result.dependencyLockHash["java/resolved-dependencies"] = sha256(
      await Bun.file(path.join(out, "reports/maven-dependencies.txt")).bytes(),
    );
    result.buildOrLoad = stage(
      "passed",
      `${result.generatedSourceFiles} generated Java source inputs`,
    );
    await execute(
      "packageConsumer",
      "install-local-jar",
      [mvn, "-B", "install", "-DskipTests"],
      sdk,
    );
    const language = name === "Kotlin" ? "kotlin-consumer" : "java-consumer";
    await cp(template(language), consumer, { recursive: true });
    if (variant === "raw") {
      const relative =
        name === "Kotlin"
          ? "src/main/kotlin/KotlinConsumer.kt"
          : "src/main/java/WireConsumer.java";
      const source = path.join(consumer, relative);
      await Bun.write(
        source,
        (await Bun.file(source).text())
          .replace(
            /^import dev\.kotp\.sdk\.generated\.(issues|creditledger)\.Get(VerificationStatus|EntryType)QueryParameterType;?\r?\n/gm,
            "",
          )
          .replace(
            /Get(VerificationStatus|EntryType)QueryParameterType\.forValue\((q|query)\.get\("(verificationStatus|entryType)"\)\.(getAsString\(\)|asString)\)/g,
            '$2.get("$3").$4',
          ),
      );
    }
    const consumerPom = path.join(consumer, "pom.xml");
    const consumerText = await Bun.file(consumerPom).text();
    await Bun.write(
      consumerPom,
      consumerText.replace(
        "<artifactId>kiota-sdk</artifactId><version>0.0.0-poc</version>",
        `<artifactId>kiota-sdk</artifactId><version>${version}</version>`,
      ),
    );
    await execute(
      "packageConsumer",
      "consumer-build",
      [
        mvn,
        "-B",
        "package",
        "dependency:build-classpath",
        "-Dmdep.outputFile=classpath.txt",
      ],
      consumer,
    );
    const cpText = (
      await Bun.file(path.join(consumer, "classpath.txt")).text()
    ).trim();
    result.packageConsumer = stage(
      "passed",
      "Installed Java JAR dependency in a separate consumer project; no SDK source directory on the consumer classpath",
    );
    await runWire([
      "java",
      "-cp",
      `${path.join(consumer, "target/classes")}${path.delimiter}${cpText}`,
      name === "Kotlin" ? "KotlinConsumerKt" : "WireConsumer",
    ]);
  } else if (name === "Python") {
    const python = process.env.PYTHON_BIN ?? "python3";
    await tool("python", [python, "--version"]);
    await lock("python", ["requirements.lock"]);
    await copyTemplate("python", sdk, ["pyproject.toml"]);
    await cp(
      path.join(out, "generated"),
      path.join(sdk, "kotp_sdk_generated"),
      { recursive: true },
    );
    await execute("buildOrLoad", "venv", [
      python,
      "-m",
      "venv",
      path.join(sdk, ".venv"),
    ]);
    const interpreter = path.join(sdk, ".venv/bin/python");
    await execute("buildOrLoad", "install", [
      interpreter,
      "-m",
      "pip",
      "install",
      "--require-hashes",
      "-r",
      path.join(template("python"), "requirements.lock"),
    ]);
    await execute(
      "buildOrLoad",
      "import-all",
      [
        interpreter,
        "-c",
        "import importlib,pathlib;root=pathlib.Path('kotp_sdk_generated');modules=['.'.join(p.with_suffix('').parts) for p in root.rglob('*.py') if p.name!='__init__.py'];[importlib.import_module(m) for m in modules];print('Imported',len(modules),'generated modules')",
      ],
      sdk,
    );
    result.buildOrLoad = stage(
      "passed",
      `${result.generatedSourceFiles} generated modules imported using real runtimes`,
    );
    await execute(
      "packageConsumer",
      "wheel",
      [interpreter, "-m", "build", "--wheel", "--no-isolation"],
      sdk,
    );
    await execute("packageConsumer", "consumer-venv", [
      python,
      "-m",
      "venv",
      path.join(consumer, ".venv"),
    ]);
    const isolated = path.join(consumer, ".venv/bin/python");
    await execute("packageConsumer", "consumer-dependencies", [
      isolated,
      "-m",
      "pip",
      "install",
      "--require-hashes",
      "-r",
      path.join(template("python"), "requirements.lock"),
    ]);
    await execute("packageConsumer", "consumer-install", [
      isolated,
      "-m",
      "pip",
      "install",
      "--no-deps",
      path.join(sdk, "dist/kotp_kiota_poc-0.0.0-py3-none-any.whl"),
    ]);
    await cp(
      path.join(template("python"), "runner.py"),
      path.join(consumer, "runner.py"),
    );
    if (variant === "raw") {
      const runner = path.join(consumer, "runner.py");
      await Bun.write(
        runner,
        (await Bun.file(runner).text())
          .replace(
            /^from kotp_sdk_generated\.(issues|credit_ledger)\.get_[^ ]+ import Get[^\n]+\n/gm,
            "",
          )
          .replace(
            /Get(VerificationStatus|EntryType)QueryParameterType\(query\["(verificationStatus|entryType)"\]\)/g,
            'query["$2"]',
          ),
      );
    }
    result.packageConsumer = stage(
      "passed",
      "Wheel installed into a separate venv; consumer has no source checkout on sys.path",
    );
    result.usageLayer = {
      workarounds: [
        "Python composed writer drops false: use official AdditionalData for webOtp=false",
        "Read dynamic error data from actual deserialized AdditionalData; mixed-list reserialization is a runtime limitation",
      ],
      retry:
        "HTTP transport has zero automatic retries; explicit issue retry reuses key/body",
    };
    await runWire([isolated, "runner.py"]);
  } else if (name === "PHP") {
    await tool("php", ["php", "--version"]);
    await tool("composer", ["composer", "--version"]);
    await lock("php", ["composer.lock"]);
    await copyTemplate("php", sdk, ["composer.json", "composer.lock"]);
    await cp(path.join(out, "generated"), path.join(sdk, "generated"), {
      recursive: true,
    });
    await execute(
      "buildOrLoad",
      "install",
      ["composer", "install", "--no-interaction", "--no-progress"],
      sdk,
    );
    await execute(
      "buildOrLoad",
      "load-all",
      [
        "php",
        "-r",
        "require 'vendor/autoload.php';$n=0;foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator('generated'))as$f){if($f->isFile()&&$f->getExtension()==='php'){require_once $f->getPathname();$n++;}}echo 'Loaded '.$n.' generated files';",
      ],
      sdk,
    );
    result.buildOrLoad = stage(
      "passed",
      `${result.generatedSourceFiles} generated PHP files loaded through Composer`,
    );
    const packages = path.join(out, "packages");
    await mkdir(packages, { recursive: true });
    await execute(
      "packageConsumer",
      "archive",
      [
        "composer",
        "archive",
        "--format=zip",
        "--dir",
        packages,
        "--no-interaction",
      ],
      sdk,
    );
    await json(path.join(consumer, "composer.json"), {
      name: "k-otp/kiota-poc-consumer",
      require: { "k-otp/kiota-poc": "0.0.0" },
      repositories: [{ type: "artifact", url: packages }],
      config: { "allow-plugins": false },
    });
    await execute(
      "packageConsumer",
      "consumer-install",
      ["composer", "install", "--no-interaction", "--no-progress"],
      consumer,
    );
    await cp(
      path.join(template("php"), "runner.php"),
      path.join(consumer, "runner.php"),
    );
    result.packageConsumer = stage(
      "passed",
      "Composer artifact ZIP installed into a separate consumer; PSR-4 resolves packaged generated files",
    );
    await runWire(["php", "runner.php"]);
  } else if (name === "Go") {
    const go = process.env.GO_BIN ?? "go";
    await tool("go", [go, "version"]);
    await lock("go", ["go.mod", "go.sum"]);
    await cp(path.join(out, "generated"), sdk, { recursive: true });
    await copyTemplate("go", sdk, ["go.mod", "go.sum"]);
    await execute(
      "buildOrLoad",
      "build",
      [go, "test", "-mod=readonly", "./..."],
      sdk,
    );
    result.buildOrLoad = stage(
      "passed",
      `${result.generatedSourceFiles} generated Go files built as all packages`,
    );
    const module = "github.com/k-otp/sdk/poc/kiota/generated";
    const moduleVersion = `v${version}`;
    const packages = path.join(out, "packages");
    await execute("packageConsumer", "module-zip", [
      "python3",
      "-c",
      `import pathlib,zipfile,json;root=pathlib.Path(${JSON.stringify(sdk)});mod=${JSON.stringify(module)};v=${JSON.stringify(moduleVersion)};d=pathlib.Path(${JSON.stringify(packages)})/mod/'@v';d.mkdir(parents=True,exist_ok=True);(d/(v+'.mod')).write_bytes((root/'go.mod').read_bytes());(d/(v+'.info')).write_text(json.dumps({'Version':v,'Time':'2026-10-07T00:00:00Z'}));(d/'list').write_text(v+'\\n');z=zipfile.ZipFile(d/(v+'.zip'),'w');[(z.write(f,mod+'@'+v+'/'+str(f.relative_to(root)))) for f in root.rglob('*') if f.is_file() and f.suffix in ['.go','.mod','.sum']];z.close()`,
    ]);
    await copyTemplate("go-consumer", consumer, [
      "go.mod",
      "go.sum",
      "main.go",
    ]);
    if (variant === "raw") {
      const source = path.join(consumer, "main.go");
      await Bun.write(
        source,
        (await Bun.file(source).text())
          .replace(
            /\t\tenum, err := (issues|creditledger)\.ParseGet[^\n]+\n\t\tif err != nil \{\n\t\t\treturn nil, err\n\t\t\}\n/g,
            "",
          )
          .replace(
            /VerificationStatusAsGetVerificationStatusQueryParameterType: enum\.\(\*issues\.GetVerificationStatusQueryParameterType\)/g,
            'VerificationStatus: ptr(test.Query["verificationStatus"].(string))',
          )
          .replace(
            /EntryTypeAsGetEntryTypeQueryParameterType: enum\.\(\*creditledger\.GetEntryTypeQueryParameterType\)/g,
            'EntryType: ptr(test.Query["entryType"].(string))',
          ),
      );
    }
    const moduleFile = path.join(consumer, "go.mod");
    await Bun.write(
      moduleFile,
      (await Bun.file(moduleFile).text()).replaceAll(
        "v0.0.0-poc-overlay",
        moduleVersion,
      ),
    );
    const goEnv = {
      GOPROXY: `file://${packages},https://proxy.golang.org`,
      GONOSUMDB: module,
      GOMODCACHE: path.join(out, "module-cache"),
    };
    await execute(
      "packageConsumer",
      "consumer-install",
      [go, "mod", "download", `${module}@${moduleVersion}`],
      consumer,
      goEnv,
    );
    await execute(
      "packageConsumer",
      "consumer-build",
      [go, "build", "-mod=readonly", "-o", "runner", "."],
      consumer,
      goEnv,
    );
    result.packageConsumer = stage(
      "passed",
      "Local module ZIP consumed through a file Go proxy; no replace directive or SDK workspace source reference",
    );
    result.runtimeVersions.kiotaAbstractions =
      "v1.11.1 (v1.9.3 nil optional date query panic retained as a separate repro)";
    await runWire([path.join(consumer, "runner")]);
  } else if (name === "TypeScript") {
    await copyTemplate("typescript", sdk, [
      "package.json",
      "bun.lock",
      "tsconfig.json",
      "runner.ts",
      "usage.ts",
      "usage.test.ts",
    ]);
    await cp(path.join(out, "generated"), path.join(sdk, "generated"), {
      recursive: true,
    });
    await lock("typescript", ["bun.lock"]);
    await execute(
      "buildOrLoad",
      "install",
      ["bun", "install", "--frozen-lockfile"],
      sdk,
    );
    await execute(
      "buildOrLoad",
      "typecheck",
      [
        path.join(sdk, "node_modules/.bin/ttsc"),
        "--noEmit",
        "-p",
        "tsconfig.json",
      ],
      sdk,
    );
    result.buildOrLoad = stage(
      "passed",
      "ttsc checks every generated TypeScript input and consumer",
    );
    await execute(
      "buildOrLoad",
      "typescript-usage-tests",
      ["bun", "test", "usage.test.ts"],
      sdk,
    );
    await execute(
      "packageConsumer",
      "typescript-build",
      [
        "bun",
        "build",
        "generated/kOtpApiClient.ts",
        "--outdir",
        "dist",
        "--target",
        "bun",
        "--packages",
        "external",
      ],
      sdk,
    );
    const manifestPath = path.join(sdk, "package.json");
    const manifest = await Bun.file(manifestPath).json();
    manifest.files = ["dist", "generated/**/*.ts"];
    manifest.exports = {
      ".": {
        types: "./generated/kOtpApiClient.ts",
        default: "./dist/kOtpApiClient.js",
      },
      "./issue": "./generated/issue/index.ts",
      "./verify": "./generated/verify/index.ts",
      "./generated/*": "./generated/*/index.ts",
    };
    await json(manifestPath, manifest);
    const packages = path.join(out, "packages");
    await mkdir(packages, { recursive: true });
    await execute(
      "packageConsumer",
      "typescript-pack",
      ["bun", "pm", "pack", "--destination", packages],
      sdk,
    );
    const archive = path.join(packages, "kotp-kiota-poc-typescript-0.0.0.tgz");
    await json(path.join(consumer, "package.json"), {
      name: "kotp-kiota-typescript-consumer",
      private: true,
      type: "module",
      dependencies: { "kotp-kiota-poc-typescript": `file:${archive}` },
      devDependencies: {
        ttsc: "0.30.4",
        typescript: "7.0.2",
        "@types/bun": "1.4.2",
      },
    });
    const runner = (
      await Bun.file(path.join(template("typescript"), "runner.ts")).text()
    )
      .replace('"./generated/kOtpApiClient"', '"kotp-kiota-poc-typescript"')
      .replace('"./generated/issue"', '"kotp-kiota-poc-typescript/issue"')
      .replace('"./generated/verify"', '"kotp-kiota-poc-typescript/verify"');
    await Bun.write(
      path.join(consumer, "runner.ts"),
      runner.replaceAll(
        '"./generated/',
        '"kotp-kiota-poc-typescript/generated/',
      ),
    );
    await cp(
      path.join(template("typescript"), "usage.ts"),
      path.join(consumer, "usage.ts"),
    );
    await cp(
      path.join(template("typescript"), "tsconfig.json"),
      path.join(consumer, "tsconfig.json"),
    );
    await execute(
      "packageConsumer",
      "typescript-consumer-install",
      ["bun", "install"],
      consumer,
    );
    await execute(
      "packageConsumer",
      "typescript-consumer-typecheck",
      [
        path.join(consumer, "node_modules/.bin/ttsc"),
        "--noEmit",
        "-p",
        "tsconfig.json",
      ],
      consumer,
    );
    await execute(
      "packageConsumer",
      "typescript-consumer-import",
      [
        "bun",
        "-e",
        "import {createKOtpApiClient} from 'kotp-kiota-poc-typescript';if(typeof createKOtpApiClient!=='function')throw new Error('missing packaged client')",
      ],
      consumer,
    );
    result.packageConsumer = stage(
      "passed",
      "Built client packed as a local tarball and loaded from an independent Bun consumer",
    );
    await runWire(["bun", "runner.ts"]);
  } else if (name === "Ruby") {
    const ruby = process.env.RUBY_BIN ?? "ruby";
    await tool("ruby", [ruby, "--version"]);
    await copyTemplate("ruby", sdk, ["Gemfile", "Gemfile.lock"]);
    await lock("ruby", ["Gemfile.lock"]);
    await cp(path.join(out, "generated"), path.join(sdk, "generated"), {
      recursive: true,
    });
    const rubyEnv = {
      BUNDLE_FROZEN: "true",
      BUNDLE_PATH: path.join(out, "ruby-dependencies"),
    };
    await rm(rubyEnv.BUNDLE_PATH, { recursive: true, force: true });
    await execute(
      "buildOrLoad",
      "install",
      [ruby, "-S", "bundle", "install"],
      sdk,
      rubyEnv,
    );
    await execute(
      "buildOrLoad",
      "load-all",
      [
        ruby,
        "-S",
        "bundle",
        "exec",
        ruby,
        "-e",
        "files=Dir.glob('generated/**/*.rb');files.each{|f|abort('syntax failure '+f)unless system(RbConfig.ruby,'-c',f,out:File::NULL)};files.each{|f|require File.expand_path(f)};puts 'Loaded '+files.length.to_s+' generated files'",
      ],
      sdk,
      rubyEnv,
    );
    result.buildOrLoad = stage(
      "passed",
      `${result.generatedSourceFiles} generated Ruby files syntax checked and required with official runtimes`,
    );
    const packages = path.join(out, "packages");
    await mkdir(packages, { recursive: true });
    await cp(
      path.join(template("ruby"), "kotp_kiota_poc.gemspec"),
      path.join(sdk, "kotp_kiota_poc.gemspec"),
    );
    await execute(
      "packageConsumer",
      "gem-build",
      [
        ruby,
        "-S",
        "gem",
        "build",
        "kotp_kiota_poc.gemspec",
        "--output",
        path.join(packages, "kotp_kiota_poc-0.0.0.gem"),
      ],
      sdk,
      rubyEnv,
    );
    await execute(
      "packageConsumer",
      "gem-consumer-install",
      [
        ruby,
        "-S",
        "gem",
        "install",
        "--local",
        path.join(packages, "kotp_kiota_poc-0.0.0.gem"),
        "--install-dir",
        path.join(consumer, "gems"),
        "--ignore-dependencies",
        "--no-document",
      ],
      consumer,
    );
    const apiVersion = await command(
      [ruby, "-e", "print Gem.ruby_api_version"],
      log("ruby-api-version"),
    );
    const installedRuntimes = path.join(
      out,
      "ruby-dependencies/ruby",
      apiVersion.output.trim(),
    );
    const gemEnv = {
      ...env,
      GEM_HOME: path.join(consumer, "gems"),
      GEM_PATH: [path.join(consumer, "gems"), installedRuntimes].join(
        path.delimiter,
      ),
    };
    const rubySource = (
      await Bun.file(path.join(template("ruby"), "runner.rb")).text()
    ).replace(
      "require_relative 'generated/k_otp_api_client'",
      "require 'k_otp_api_client'",
    );
    await Bun.write(path.join(consumer, "runner.rb"), rubySource);
    await cp(
      path.join(template("ruby"), "usage.rb"),
      path.join(consumer, "usage.rb"),
    );
    const rubyInput = await Bun.file(
      path.join(
        root,
        variant === "overlay"
          ? path.relative(root, path.join(out, "reports/openapi-overlay.json"))
          : config.spec,
      ),
    ).json();
    const enumWireValues: Record<string, string> = {};
    function enumValues(node: unknown) {
      if (node === null || typeof node !== "object") return;
      const values = (node as { enum?: unknown }).enum;
      if (Array.isArray(values)) {
        for (const value of values) {
          if (typeof value !== "string") continue;
          const key = value[0]?.toUpperCase() + value.slice(1);
          if (enumWireValues[key] && enumWireValues[key] !== value)
            throw new Failure(
              "wireContract",
              "blocked",
              `Ambiguous Ruby enum wire name ${key}`,
            );
          enumWireValues[key] = value;
        }
      }
      for (const child of Object.values(node)) enumValues(child);
    }
    enumValues(rubyInput);
    await json(path.join(consumer, "enum-wire-values.json"), enumWireValues);
    await json(path.join(out, "reports/enum-wire-values.json"), enumWireValues);
    await execute(
      "packageConsumer",
      "gem-load",
      [
        ruby,
        "-e",
        "require 'k_otp_api_client';puts KOtpSdkGenerated::KOtpApiClient.name",
      ],
      consumer,
      gemEnv,
    );
    await cp(
      path.join(template("ruby"), "usage_test.rb"),
      path.join(consumer, "usage_test.rb"),
    );
    await execute(
      "packageConsumer",
      "ruby-usage-tests",
      [ruby, "usage_test.rb"],
      consumer,
      gemEnv,
    );
    result.packageConsumer = stage(
      "passed",
      "Built gem installed from a local artifact; runtime dependencies are real installed gems from the frozen lock, not source stubs",
    );
    const rubyWire = await command(
      [
        "bun",
        "run",
        path.join(root, "poc/kiota/scripts/wire.ts"),
        ruby,
        "runner.rb",
      ],
      log("wire-evaluation"),
      root,
      gemEnv,
    );
    result.wireContract = stage(
      rubyWire.exitCode ? "failed" : "passed",
      rubyWire.output.trim(),
    );
    if (rubyWire.exitCode)
      result.blockers.push(
        "Ruby runtime wire fixtures failed; inspect per-case evidence",
      );
  } else if (name === "Dart") {
    const dart = process.env.DART_BIN ?? "dart";
    await tool("dart", [dart, "--version"]);
    await copyTemplate("dart", sdk, ["pubspec.yaml", "pubspec.lock"]);
    await lock("dart", ["pubspec.lock"]);
    await mkdir(path.join(sdk, "lib"), { recursive: true });
    await cp(path.join(out, "generated"), path.join(sdk, "lib/generated"), {
      recursive: true,
    });
    await execute(
      "buildOrLoad",
      "install",
      [dart, "pub", "get", "--enforce-lockfile"],
      sdk,
    );
    await execute("buildOrLoad", "analyze", [dart, "analyze"], sdk);
    result.buildOrLoad = stage(
      "passed",
      `${result.generatedSourceFiles} generated Dart source inputs analyzed with official pub dependencies`,
    );
    const packages = path.join(out, "packages");
    await mkdir(packages, { recursive: true });
    const archive = path.join(packages, "kotp-kiota-poc-dart.tar.gz");
    await execute(
      "packageConsumer",
      "dart-archive",
      ["tar", "-czf", archive, "lib", "pubspec.yaml", "pubspec.lock"],
      sdk,
    );
    const installed = path.join(consumer, "installed-sdk");
    await mkdir(installed, { recursive: true });
    await execute("packageConsumer", "dart-consumer-extract", [
      "tar",
      "-xzf",
      archive,
      "-C",
      installed,
    ]);
    await Bun.write(
      path.join(consumer, "pubspec.yaml"),
      "name: kotp_dart_consumer\npublish_to: none\nenvironment:\n  sdk: '>=3.9.0 <4.0.0'\ndependencies:\n  kotp_kiota_poc:\n    path: installed-sdk\n  microsoft_kiota_bundle: 0.1.1\n",
    );
    let dartSource = (
      await Bun.file(path.join(template("dart"), "runner.dart")).text()
    ).replaceAll("'lib/generated/", "'package:kotp_kiota_poc/generated/");
    if (variant === "overlay") {
      dartSource =
        "import 'package:kotp_kiota_poc/generated/issues/get_verification_status_query_parameter_type.dart';\n" +
        "import 'package:kotp_kiota_poc/generated/creditLedger/get_entry_type_query_parameter_type.dart';\n" +
        dartSource
          .replace(
            "c.queryParameters.verificationStatus=query['verificationStatus']",
            "c.queryParameters.verificationStatus=query['verificationStatus']==null?null:GetVerificationStatusQueryParameterType.values.firstWhere((v)=>v.value==query['verificationStatus'])",
          )
          .replace(
            "c.queryParameters.entryType=query['entryType']",
            "c.queryParameters.entryType=query['entryType']==null?null:GetEntryTypeQueryParameterType.values.firstWhere((v)=>v.value==query['entryType'])",
          );
    }
    await Bun.write(path.join(consumer, "runner.dart"), dartSource);
    await Bun.write(
      path.join(consumer, "usage.dart"),
      (
        await Bun.file(path.join(template("dart"), "usage.dart")).text()
      ).replaceAll("'lib/generated/", "'package:kotp_kiota_poc/generated/"),
    );
    await execute(
      "packageConsumer",
      "dart-consumer-install",
      [dart, "pub", "get"],
      consumer,
    );
    await execute(
      "packageConsumer",
      "dart-consumer-compile",
      [dart, "compile", "kernel", "runner.dart", "-o", "runner.dill"],
      consumer,
    );
    result.packageConsumer = stage(
      "passed",
      "Local archive extracted into a separate Pub consumer; kernel compilation references packaged SDK files",
    );
    await runWire([dart, "run", "runner.dart"]);
    if (variant === "overlay") {
      await Bun.write(
        path.join(consumer, "usage_test.dart"),
        (
          await Bun.file(path.join(template("dart"), "usage_test.dart")).text()
        ).replaceAll("'lib/generated/", "'package:kotp_kiota_poc/generated/"),
      );
      await execute(
        "wireContract",
        "dart-usage-tests",
        [dart, "run", "usage_test.dart"],
        consumer,
      );
    }
  } else if (name === "HTTP") {
    result.buildOrLoad = stage(
      "not_applicable",
      "Request examples, not an SDK",
    );
    result.packageConsumer = stage("not_applicable");
    const inspection = await command(
      ["bun", "run", path.join(root, "poc/kiota/scripts/http.ts")],
      log("http-examples"),
      root,
      env,
    );
    result.wireContract = stage(
      inspection.exitCode ? "failed" : "passed",
      inspection.output.trim(),
    );
    result.evidencePaths.push(path.relative(root, inspection.log));
  }
} catch (error) {
  if (error instanceof Failure) {
    result[error.step] = stage(error.status, error.message);
    result.blockers.push(error.message);
  } else {
    result.blockers.push(String(error));
    result.buildOrLoad = stage("failed", String(error));
  }
} finally {
  const packages = path.join(out, "packages");
  await mkdir(packages, { recursive: true });
  for (const file of [
    path.join(sdk, `target/kiota-sdk-${version}.jar`),
    path.join(sdk, "dist/kotp_kiota_poc-0.0.0-py3-none-any.whl"),
  ]) {
    if (await Bun.file(file).exists())
      await cp(file, path.join(packages, path.basename(file)));
  }
  result.fixtureSha256 = sha256(
    await Bun.file(path.join(root, "poc/kiota/fixtures/contract.json")).bytes(),
  );
  result.packageArtifacts = Object.fromEntries(
    await Promise.all(
      (await files(packages)).map(async (file) => [
        path.relative(packages, file),
        sha256(await Bun.file(file).bytes()),
      ]),
    ),
  );
  await json(resultFile, result);
}
console.log(
  `${name}/${variant}: build=${result.buildOrLoad.status}, wire=${result.wireContract.status}, package=${result.packageConsumer.status}`,
);
process.exitCode = ["buildOrLoad", "wireContract", "packageConsumer"].some(
  (key) => result[key].status === "failed" || result[key].status === "blocked",
)
  ? 1
  : 0;
