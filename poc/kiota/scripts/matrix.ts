import { config } from "./common";

const include = config.targets
  .filter((target) => target.harness !== null)
  .flatMap((target) =>
    ["raw", "overlay"].map((variant) => ({ ...target, variant })),
  );
const value = JSON.stringify({ include });
if (process.env.GITHUB_OUTPUT) {
  const file = Bun.file(process.env.GITHUB_OUTPUT);
  await Bun.write(file, `${await file.text()}matrix=${value}\n`);
} else console.log(value);
