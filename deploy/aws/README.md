AWS deployment assets for FaithRequest (faithrequest.com).

Files:
- aws.env.example: copy to `aws.env` and fill in your environment-specific values.
- prepare.js: generates the deployable AWS artifacts from `aws.env`.
- deploy.ps1: one-command Windows PowerShell deploy script for the generated AWS workflow.
- out/: generated directory containing the ECS task definition, staged frontend files, and next-step commands.

How to use:
1. Copy `aws.env.example` to `aws.env`.
2. Fill in AWS account, region, roles, secret ARNs, frontend domain, and optional S3/CloudFront/ECS values.
3. From the project root, run `npm run aws:prepare`.
4. Review the generated files in `deploy/aws/out/`.
5. Run the commands in `deploy/aws/out/next-steps.txt` to push the image, register the task definition, update ECS, sync S3, and invalidate CloudFront.

PowerShell shortcut:
- `npm run aws:deploy` runs prepare, Docker build/push, ECS registration, optional ECS service update, optional S3 sync, and optional CloudFront invalidation.
- `npm run aws:deploy:dry-run` prints the commands without executing them.
- `powershell -ExecutionPolicy Bypass -File ./deploy/aws/deploy.ps1 -SkipFrontend` is available if you only want to deploy the backend.

The generator intentionally keeps infrastructure creation out of scope. It prepares deployable artifacts for an existing AWS environment instead of locking the repo to CloudFormation, CDK, or Terraform.
