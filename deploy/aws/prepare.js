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
  const awsRegion = requiredValue(env, "AWS_REGION");
  const awsAccountId = requiredValue(env, "AWS_ACCOUNT_ID");
  const ecrRepository = optionalValue(env, "ECR_REPOSITORY", "prayer-keep-api");
  const imageTag = optionalValue(env, "IMAGE_TAG", "latest");
  const containerPort = Number(optionalValue(env, "CONTAINER_PORT", "5000"));

  return {
    awsRegion,
    awsAccountId,
    ecrRepository,
    imageTag,
    imageUri: `${awsAccountId}.dkr.ecr.${awsRegion}.amazonaws.com/${ecrRepository}:${imageTag}`,
    ecsTaskFamily: optionalValue(env, "ECS_TASK_FAMILY", "prayer-keep-api"),
    ecsContainerName: optionalValue(env, "ECS_CONTAINER_NAME", "prayer-keep-api"),
    ecsExecutionRoleArn: requiredValue(env, "ECS_EXECUTION_ROLE_ARN"),
    ecsTaskRoleArn: requiredValue(env, "ECS_TASK_ROLE_ARN"),
    ecsCpu: optionalValue(env, "ECS_CPU", "256"),
    ecsMemory: optionalValue(env, "ECS_MEMORY", "512"),
    containerPort,
    logGroup: optionalValue(env, "LOG_GROUP", "/ecs/prayer-keep-api"),
    logStreamPrefix: optionalValue(env, "LOG_STREAM_PREFIX", "ecs"),
    apiBaseUrl: requiredValue(env, "API_BASE_URL"),
    clientOrigin: requiredValue(env, "CLIENT_ORIGIN"),
    mongodbSecretArn: requiredValue(env, "MONGODB_URI_SECRET_ARN"),
    jwtSecretArn: requiredValue(env, "JWT_SECRET_ARN"),
    frontendS3Bucket: optionalValue(env, "FRONTEND_S3_BUCKET", ""),
    cloudFrontDistributionId: optionalValue(env, "CLOUDFRONT_DISTRIBUTION_ID", ""),
    ecsCluster: optionalValue(env, "ECS_CLUSTER", ""),
    ecsService: optionalValue(env, "ECS_SERVICE", ""),
  };
}

function buildTaskDefinition(config) {
  return {
    family: config.ecsTaskFamily,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: String(config.ecsCpu),
    memory: String(config.ecsMemory),
    executionRoleArn: config.ecsExecutionRoleArn,
    taskRoleArn: config.ecsTaskRoleArn,
    containerDefinitions: [
      {
        name: config.ecsContainerName,
        image: config.imageUri,
        essential: true,
        portMappings: [
          {
            containerPort: config.containerPort,
            hostPort: config.containerPort,
            protocol: "tcp",
          },
        ],
        healthCheck: {
          command: [
            "CMD-SHELL",
            `wget -qO- http://localhost:${config.containerPort}/api/health || exit 1`,
          ],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 30,
        },
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": config.logGroup,
            "awslogs-region": config.awsRegion,
            "awslogs-stream-prefix": config.logStreamPrefix,
          },
        },
        secrets: [
          {
            name: "MONGODB_URI",
            valueFrom: config.mongodbSecretArn,
          },
          {
            name: "JWT_SECRET",
            valueFrom: config.jwtSecretArn,
          },
        ],
        environment: [
          {
            name: "NODE_ENV",
            value: "production",
          },
          {
            name: "PORT",
            value: String(config.containerPort),
          },
          {
            name: "CLIENT_ORIGIN",
            value: config.clientOrigin,
          },
        ],
      },
    ],
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
    `aws ecr get-login-password --region ${config.awsRegion} | docker login --username AWS --password-stdin ${config.awsAccountId}.dkr.ecr.${config.awsRegion}.amazonaws.com`,
    `docker build -t ${config.ecrRepository}:${config.imageTag} ./backend`,
    `docker tag ${config.ecrRepository}:${config.imageTag} ${config.imageUri}`,
    `docker push ${config.imageUri}`,
    "aws ecs register-task-definition --cli-input-json file://deploy/aws/out/ecs-task-definition.json",
  ];

  if (config.ecsCluster && config.ecsService) {
    commands.push(
      `aws ecs update-service --cluster ${config.ecsCluster} --service ${config.ecsService} --force-new-deployment`
    );
  }

  if (config.frontendS3Bucket) {
    commands.push(`aws s3 sync deploy/aws/out/frontend s3://${config.frontendS3Bucket} --delete`);
  }

  if (config.cloudFrontDistributionId) {
    commands.push(
      `aws cloudfront create-invalidation --distribution-id ${config.cloudFrontDistributionId} --paths \"/*\"`
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
  const taskDefinition = buildTaskDefinition(config);
  fs.writeFileSync(
    path.join(outDir, "ecs-task-definition.json"),
    `${JSON.stringify(taskDefinition, null, 2)}\n`,
    "utf8"
  );

  stageFrontend(config);
  fs.writeFileSync(path.join(outDir, "next-steps.txt"), `${buildNextSteps(config)}\n`, "utf8");

  console.log(`Prepared AWS assets from ${path.relative(rootDir, envFile)}.`);
  console.log("Generated files:");
  console.log("- deploy/aws/out/ecs-task-definition.json");
  console.log("- deploy/aws/out/frontend/");
  console.log("- deploy/aws/out/next-steps.txt");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}