import os
import sys
from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from dotenv import load_dotenv


def main() -> int:
    app_dir = Path(__file__).resolve().parents[1]
    load_dotenv(app_dir / ".env")

    region = os.getenv("AWS_REGION", "us-east-2")
    model_id = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-6")
    profile = os.getenv("AWS_PROFILE", "").strip()

    session_kwargs = {"region_name": region}
    if profile:
        session_kwargs["profile_name"] = profile

    try:
        session = boto3.Session(**session_kwargs)
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        bedrock = session.client("bedrock")
        bedrock.get_foundation_model(modelIdentifier=model_id)
    except (BotoCoreError, ClientError) as exc:
        print("AWS/Bedrock verification failed.")
        print(f"Region: {region}")
        print(f"Model:  {model_id}")
        if profile:
            print(f"Profile:{profile}")
        print(f"Error:  {exc}")
        return 1

    print("AWS/Bedrock verification succeeded.")
    print(f"Account: {identity.get('Account')}")
    print(f"Arn:     {identity.get('Arn')}")
    print(f"Region:  {region}")
    print(f"Model:   {model_id}")
    if profile:
        print(f"Profile: {profile}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
