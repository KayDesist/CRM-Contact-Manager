# CRM Web App Setup

This is the FastAPI web app for local development and browser-based usage.
It does not require Slack for local usage; chat and AI run directly through the web UI and API routes.

## 1) Run Locally (localhost)

From the repo root:

```powershell
cd crm-web
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Open:

- http://127.0.0.1:8000
- http://127.0.0.1:8000/static/login.html
- http://127.0.0.1:8000/static/register.html
- http://127.0.0.1:8000/static/dashboard.html

## 2) Where API Keys and Secrets Go

- Local-only secrets go in `crm-web/.env`
- Template values go in `crm-web/.env.example`
- `crm-web/.env` should never be committed to git

The app reads:

- `SECRET_KEY` for JWT tokens
- `DATABASE_URL` for DB connection
- `AWS_REGION` and `BEDROCK_MODEL_ID` for AI extraction
- `BEDROCK_INFERENCE_PROFILE_ID` when your model requires inference-profile throughput
- AWS auth from `AWS_PROFILE` or AWS access key env vars

## 3) AWS Setup for Local AI (Bedrock)

Recommended auth for local development:

```powershell
aws configure --profile crm-local
```

Then set this in `crm-web/.env`:

```env
AWS_PROFILE=crm-local
AWS_REGION=us-east-2
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-6
BEDROCK_INFERENCE_PROFILE_ID=arn:aws:bedrock:us-east-2:123456789012:inference-profile/your-profile-id
```

Important checks in AWS:

- Bedrock is enabled in your chosen region
- Your IAM user/role has Bedrock runtime permissions
- The model in `BEDROCK_MODEL_ID` is available for your account/region
- If Bedrock returns an on-demand throughput validation error, use an inference profile ARN in `BEDROCK_INFERENCE_PROFILE_ID`

If using temporary credentials (SSO/STS), refresh them before running the app.

Optional quick verification before starting the app:

```powershell
cd crm-web
.\venv\Scripts\python.exe scripts\verify_aws_bedrock.py
```

## 4) Deploying Web App to AWS

For production web hosting, place app env vars in AWS service config (not in code):

- Elastic Beanstalk: Environment Properties
- ECS/Fargate: Task Definition secrets + env
- EC2/Systemd: `/etc/environment` or secrets manager pull at startup

Preferred production secret storage:

- AWS Secrets Manager or AWS Systems Manager Parameter Store

Do not put production secrets in git-tracked files.
