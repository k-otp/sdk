import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import npmPackage from "../../../packages/sdk/package.json";
import packages from "../../../sdks/packages.json";
import { json, root } from "./common";

export const previewPackages: Record<
  string,
  { version: string; entry: string; package: string }
> = Object.fromEntries(
  Object.entries(packages.targets).map(([target, value]) => [
    target,
    {
      ...value,
      version:
        value.version === "workspace" ? npmPackage.version : value.version,
    },
  ]),
);
export const previewRoot = path.join(root, "sdks");
export function consumerSource(language: string, filename: string) {
  if (process.env.POC_PROFILE !== "preview")
    return path.join(root, "poc/kiota/harness", language, filename);
  const extension = path.extname(filename);
  return path.join(
    root,
    "poc/kiota/consumers",
    language.replace(/-consumer$/, ""),
    `consumer${extension}`,
  );
}
export async function preparePreviewSdk(language: string, sdk: string) {
  if (process.env.POC_PROFILE !== "preview") return;
  const source = path.join(previewRoot, language);
  await cp(path.join(source, "README.md"), path.join(sdk, "README.md"));
  await cp(path.join(root, "LICENSE"), path.join(sdk, "LICENSE"));
  if (language === "typescript") {
    await mkdir(path.join(sdk, "preview"), { recursive: true });
    for (const file of ["index.ts", "compatibility.ts"])
      await cp(path.join(source, file), path.join(sdk, "preview", file));
    const configFile = path.join(sdk, "tsconfig.json");
    const config = await Bun.file(configFile).json();
    config.include.push("preview/**/*.ts");
    await json(configFile, config);
  } else if (language === "dotnet") {
    await cp(
      path.join(source, "KotpClient.cs"),
      path.join(sdk, "KotpClient.cs"),
    );
    const file = path.join(sdk, "SDK.csproj");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replace(
          '<Compile Include="generated/**/*.cs" />',
          '<Compile Include="generated/**/*.cs" /><Compile Include="KotpClient.cs" /><None Include="README.md" Pack="true" PackagePath="/" /><None Include="LICENSE" Pack="true" PackagePath="/" />',
        )
        .replace(
          "<GeneratePackageOnBuild>",
          "<PackageReadmeFile>README.md</PackageReadmeFile><PackageLicenseExpression>MIT</PackageLicenseExpression><GeneratePackageOnBuild>",
        ),
    );
  } else if (language === "java") {
    await mkdir(path.join(sdk, "src/main/java/dev/kotp/sdk"), {
      recursive: true,
    });
    await cp(
      path.join(source, "KotpClient.java"),
      path.join(sdk, "src/main/java/dev/kotp/sdk/KotpClient.java"),
    );
    const file = path.join(sdk, "pom.xml");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replace(
          "<sourceDirectory>generated</sourceDirectory>",
          "<sourceDirectory>src/main/java</sourceDirectory><resources><resource><directory>.</directory><includes><include>README.md</include><include>LICENSE</include></includes></resource></resources>",
        )
        .replace(
          "<artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version>",
          "<artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version>",
        ),
    );
  } else if (language === "python") {
    await cp(path.join(source, "kotp_sdk"), path.join(sdk, "kotp_sdk"), {
      recursive: true,
    });
    const file = path.join(sdk, "pyproject.toml");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replace(
          'version = "0.0.0"',
          `version = "${previewPackages.Python?.version}"`,
        )
        .replace(
          'description = "Unpublished local Kiota consumer fixture"',
          'description = "K-OTP server client preview"\nreadme = "README.md"\nlicense = {file = "LICENSE"}',
        )
        .replace(
          '["kotp_sdk_generated*"]',
          '["kotp_sdk_generated*", "kotp_sdk*"]',
        ),
    );
  } else if (language === "php") {
    await mkdir(path.join(sdk, "preview"), { recursive: true });
    await cp(
      path.join(source, "KotpClient.php"),
      path.join(sdk, "preview/KotpClient.php"),
    );
    const file = path.join(sdk, "composer.json");
    const manifest = await Bun.file(file).json();
    manifest.version = previewPackages.PHP?.version;
    manifest.description = "K-OTP server client preview";
    manifest.autoload["psr-4"]["KOtp\\"] = "preview/";
    manifest.autoload.files = ["preview/KotpClient.php"];
    await json(file, manifest);
  } else if (language === "go") {
    await cp(path.join(source, "client.go"), path.join(sdk, "client.go"));
    for (const file of ["go.mod", "go.sum"])
      await cp(path.join(source, file), path.join(sdk, file));
  } else if (language === "ruby") {
    await cp(path.join(source, "lib"), path.join(sdk, "preview"), {
      recursive: true,
    });
    const input = await Bun.file(
      path.join(sdk, "../reports/openapi-overlay.json"),
    ).json();
    const aliases: Record<string, string> = {};
    function enumValues(node: unknown) {
      if (!node || typeof node !== "object") return;
      const values = (node as { enum?: unknown }).enum;
      if (Array.isArray(values))
        for (const value of values) {
          if (typeof value !== "string") continue;
          const key = value[0]?.toUpperCase() + value.slice(1);
          if (aliases[key] && aliases[key] !== value)
            throw new Error(`Ambiguous enum alias ${key}`);
          aliases[key] = value;
        }
      for (const child of Object.values(node)) enumValues(child);
    }
    enumValues(input);
    await json(
      path.join(sdk, "preview/kotp_sdk/enum-wire-values.json"),
      aliases,
    );
  } else if (language === "dart") {
    await cp(path.join(source, "lib"), path.join(sdk, "lib"), {
      recursive: true,
    });
    const file = path.join(sdk, "pubspec.yaml");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replace("version: 0.0.0", `version: ${previewPackages.Dart?.version}`)
        .replace(
          "description: Unpublished generated client build and consumer fixture.",
          "description: K-OTP server client preview.",
        ),
    );
  }
  // Only package manifests and our wrapper sources are adapted here. Kiota
  // generated sources are copied byte-for-byte from their generation output.
  const metadata = "https://github.com/k-otp/sdk";
  if (language === "dotnet") {
    const file = path.join(sdk, "SDK.csproj");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replace("KOtp.Kiota.Poc", "KOtp.Sdk")
        .replace(
          "<PackageId>",
          `<Authors>K-OTP</Authors><Description>K-OTP server SDK</Description><PackageProjectUrl>https://k-otp.dev</PackageProjectUrl><RepositoryUrl>${metadata}</RepositoryUrl><PackageId>`,
        ),
    );
  } else if (language === "java") {
    const file = path.join(sdk, "pom.xml");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replaceAll("dev.kotp.poc", "dev.kotp")
        .replaceAll("kiota-sdk", "kotp-sdk")
        .replace(
          "<build>",
          `<name>K-OTP SDK</name><description>K-OTP server SDK for Java and Kotlin/JVM</description><url>https://k-otp.dev</url><licenses><license><name>MIT</name><url>https://opensource.org/licenses/MIT</url></license></licenses><scm><url>${metadata}</url><connection>scm:git:${metadata}.git</connection></scm><developers><developer><id>k-otp</id><name>K-OTP</name></developer></developers><build>`,
        ),
    );
  } else if (language === "python") {
    const file = path.join(sdk, "pyproject.toml");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replace('name = "kotp-kiota-poc"', 'name = "kotp-sdk"')
        .replace(
          'description = "K-OTP server client preview"',
          'description = "K-OTP server SDK"',
        )
        .replace('requires-python = ">=3.11"', 'requires-python = ">=3.13"') +
        `\n[project.urls]\nHomepage = "https://k-otp.dev"\nRepository = "${metadata}"\n`,
    );
    await Bun.write(path.join(sdk, "kotp_sdk/py.typed"), "");
  } else if (language === "php") {
    const file = path.join(sdk, "composer.json");
    const manifest = await Bun.file(file).json();
    Object.assign(manifest, {
      name: "k-otp/sdk",
      description: "K-OTP server SDK",
      homepage: "https://k-otp.dev",
      support: { source: metadata, issues: `${metadata}/issues` },
    });
    await json(file, manifest);
  } else if (language === "dart") {
    const file = path.join(sdk, "pubspec.yaml");
    await Bun.write(
      file,
      (await Bun.file(file).text())
        .replace("name: kotp_kiota_poc", "name: kotp_sdk")
        .replace(
          "description: K-OTP server client preview.",
          "description: K-OTP server SDK for Dart.",
        )
        .replace("publish_to: none\n", "") +
        `\nhomepage: https://k-otp.dev\nrepository: ${metadata}\n`,
    );
  }
}
