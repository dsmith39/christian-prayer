const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const awsDir = __dirname;
const outDir = path.join(awsDir, "out");
const frontendOutDir = path.join(outDir, "frontend");

const DEFAULT_ENV_FILE = path.join(awsDir, "aws.env");

const STATIC_FILE_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".ico",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);

const STATIC_FILE_EXCLUSIONS = new Set([
  "config.production.example.js",
  "create-github-issues.sh",
  "package-lock.json",
  "package.json",
  "README.md",
]);

function parseArgs(argv) {
  const args = { envFile: DEFAULT_ENV_FILE };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function emptyDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      continue;
    }

    fs.rmSync(entryPath, { force: true });
  }
}

function requiredValue(env, key) {
  const value = (env[key] || "").trim();
  if (!value) {
    throw new Error(`Missing required setting: ${key}`);
  }

  return value;
}

function optionalValue(env, key, fallback) {
  const value = (env[key] || "").trim();
  return value || fallback;
}

function collectConfig(env) {
  return {
    awsRegion: requiredValue(env, "AWS_REGION"),
    awsAccountId: requiredValue(env, "AWS_ACCOUNT_ID"),
    lambdaFunctionName: optionalValue(env, "LAMBDA_FUNCTION_NAME", "faithrequest-api"),
    apiBaseUrl: requiredValue(env, "API_BASE_URL"),
    clientOrigin: requiredValue(env, "CLIENT_ORIGIN"),
    dynamodbTableName: optionalValue(env, "DYNAMODB_TABLE_NAME", "faithrequest-users"),
    jwtSecretArn: requiredValue(env, "JWT_SECRET_ARN"),
    frontendS3Bucket: optionalValue(env, "FRONTEND_S3_BUCKET", ""),
    cloudFrontDistributionId: optionalValue(env, "CLOUDFRONT_DISTRIBUTION_ID", ""),
  };
}

function buildFrontendConfig(config) {
  return [
    "window.APP_CONFIG = {",
    `  API_BASE_URL: ${JSON.stringify(config.apiBaseUrl)},`,
    "};",
    "",
  ].join("\n");
}

function shouldCopyStaticFile(entryName) {
  if (STATIC_FILE_EXCLUSIONS.has(entryName)) {
    return false;
  }

  return STATIC_FILE_EXTENSIONS.has(path.extname(entryName).toLowerCase());
}

function stageFrontend(config) {
  emptyDirectory(frontendOutDir);
  ensureDirectory(frontendOutDir);

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (!shouldCopyStaticFile(entry.name)) {
      continue;
    }

    const sourcePath = path.join(rootDir, entry.name);
    const targetPath = path.join(frontendOutDir, entry.name);
    fs.copyFileSync(sourcePath, targetPath);
  }

  fs.writeFileSync(path.join(frontendOutDir, "config.js"), buildFrontendConfig(config), "utf8");
}

function buildNextSteps(config) {
  const commands = [
    "cd backend && npm ci --omit=dev && cd ..",
    "powershell -Command \"Compress-Archive -Path backend/* -DestinationPath deploy/aws/out/faithrequest-api.zip -Force\"",
    `aws lambda update-function-code --function-name ${config.lambdaFunctionName} --zip-file fileb://deploy/aws/out/faithrequest-api.zip --region ${config.awsRegion}`,
  ];

  if (config.frontendS3Bucket) {
    commands.push(`aws s3 sync deploy/aws/out/frontend s3://${config.frontendS3Bucket} --delete --region ${config.awsRegion}`);
  }

  if (config.cloudFrontDistributionId) {
    commands.push(
      `aws cloudfront create-invalidation --distribution-id ${config.cloudFrontDistributionId} --paths "/*"`
    );
  }

  return commands.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(process.cwd(), args.envFile);

  if (!fs.existsSync(envFile)) {
    throw new Error(`AWS env file not found: ${envFile}`);
  }

  const env = parseEnvFile(envFile);
  const config = collectConfig(env);

  ensureDirectory(outDir);
  stageFrontend(config);
  fs.writeFileSync(path.join(outDir, "next-steps.txt"), `${buildNextSteps(config)}\n`, "utf8");

  console.log(`Prepared AWS assets from ${path.relative(rootDir, envFile)}.`);
  console.log("Generated files:");
  console.log("- deploy/aws/out/frontend/");
  console.log("- deploy/aws/out/next-steps.txt");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
