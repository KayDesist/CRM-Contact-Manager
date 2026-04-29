"""
AWS Bedrock (Claude) service — Python port of BedrockExtractor.ts
"""
import json
import os
from typing import Optional

import boto3

_client = None
_client_region = None
_last_error = None


def _get_client():
    global _client, _client_region
    region = os.getenv("AWS_REGION", "us-east-2")
    if _client is None or _client_region != region:
        _client = boto3.client(
            "bedrock-runtime",
            region_name=region,
        )
        _client_region = region
    return _client


def _get_target_model_id() -> str:
    profile_id = os.getenv("BEDROCK_INFERENCE_PROFILE_ID", "").strip()
    model_id = os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-6").strip()
    return profile_id or model_id

CONTACT_EXTRACTION_PROMPT = """You are a contact information extraction assistant. Extract contact details from messages and return them in JSON format.

Return ONLY a JSON object with these fields (use null if not found):
{
  "firstName": "First name",
  "lastName": "Last name",
  "email": "Email address",
  "phone": "Primary phone number (mobile or direct line preferred)",
  "additionalPhones": "Other phone numbers if multiple are present (comma-separated)",
  "company": "Company name",
  "title": "Job title/role",
  "priority": "Priority level (High, Medium, or Low)",
  "linkedin": "LinkedIn URL",
  "notes": "Any other relevant information"
}

Rules:
- Be accurate — only extract information that is clearly stated
- If no contact info found, return {"firstName": null}
- Do not include any markdown formatting or code blocks
- For priority, look for keywords like urgent/important/asap (High), normal/standard (Medium), low priority/not urgent (Low)

Examples:
Input: "Met John Smith from Acme Corp, email john@acme.com"
Output: {"firstName": "John", "lastName": "Smith", "email": "john@acme.com", "phone": null, "additionalPhones": null, "company": "Acme Corp", "title": null, "priority": null, "linkedin": null, "notes": null}

Input: "Just chatted about the weather"
Output: {"firstName": null}"""

EDIT_EXTRACTION_PROMPT = """You are a field update assistant. Extract which contact field to update and its new value.

IMPORTANT: If the user says "name" (without specifying first/last), split into firstName and lastName.

For single field updates, return:
{"field": "firstName|lastName|email|phone|company|title|priority|linkedin|notes", "value": "new value"}

For "name" updates (both firstName and lastName), return:
{"fields": [{"field": "firstName", "value": "first part"}, {"field": "lastName", "value": "last part"}]}

Examples:
Input: "Edit email to john@newdomain.com" → {"field": "email", "value": "john@newdomain.com"}
Input: "Change company to TechCorp" → {"field": "company", "value": "TechCorp"}
Input: "Edit name to Jane Smith" → {"fields": [{"field": "firstName", "value": "Jane"}, {"field": "lastName", "value": "Smith"}]}"""

VISION_EXTRACTION_PROMPT = """You are an expert at analyzing business cards and contact information documents.

Carefully examine this image and extract ALL contact information you can find. Pay special attention to:
- Visual layout and card design (logos, icons, positioning)
- Names and titles
- Email addresses and phone numbers
- Company names and addresses
- Social media handles (LinkedIn, Twitter, etc.)
- Websites and URLs

Return ONLY a JSON object with these fields (use null if not found):
{
  "firstName": "First name",
  "lastName": "Last name",
  "email": "Email address",
  "phone": "Primary phone number",
  "additionalPhones": "Secondary phone numbers (comma-separated)",
  "company": "Company name",
  "title": "Job title/role",
  "priority": "Priority level based on title (C-level/VP=High, Director/Manager=Medium, Others=Low)",
  "linkedin": "LinkedIn URL",
  "notes": "Any other relevant info like address, website, etc."
}

Rules:
- Be accurate — only extract information that is clearly visible
- If no contact info is found, return {"firstName": null}
- Do not include any markdown formatting or code blocks"""


def _call_claude(
    messages: list,
    system: str = "",
    max_tokens: int = 500,
    temperature: float = 0.1,
) -> Optional[str]:
    global _last_error
    try:
        kwargs = {
            "modelId": _get_target_model_id(),
            "messages": messages,
            "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature},
        }
        if system:
            kwargs["system"] = [{"text": system}]

        response = _get_client().converse(**kwargs)
        content = response.get("output", {}).get("message", {}).get("content", [])
        _last_error = None
        return "".join(c.get("text", "") for c in content if c.get("text"))
    except Exception as e:
        _last_error = str(e)
        print(f"Bedrock error: {e}")
        return None


def get_last_bedrock_error() -> Optional[str]:
    return _last_error


def get_bedrock_runtime_config() -> dict:
    return {
        "region": os.getenv("AWS_REGION", "us-east-2"),
        "model_id": os.getenv("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-6").strip(),
        "inference_profile_id": os.getenv("BEDROCK_INFERENCE_PROFILE_ID", "").strip(),
        "target_model_id": _get_target_model_id(),
    }


def _parse_json(raw: str) -> Optional[dict]:
    clean = raw.strip()
    if "```json" in clean:
        clean = clean.split("```json", 1)[1]
    if "```" in clean:
        clean = clean.split("```", 1)[0]
    try:
        return json.loads(clean.strip())
    except Exception:
        return None


def extract_contact_info(text: str) -> Optional[dict]:
    result = _call_claude(
        messages=[{
            "role": "user",
            "content": [{"text": f"{CONTACT_EXTRACTION_PROMPT}\n\nExtract contact from:\n\n{text}"}],
        }],
        max_tokens=500,
        temperature=0.1,
    )
    if not result:
        return None
    data = _parse_json(result)
    if not data or not data.get("firstName"):
        return None
    return {k: v for k, v in data.items() if v not in (None, "null", "")}


def extract_contact_from_image(file_bytes: bytes, content_type: str) -> Optional[dict]:
    try:
        if "pdf" in content_type:
            content = [
                {
                    "document": {
                        "format": "pdf",
                        "name": "business_card",
                        "source": {"bytes": file_bytes},
                    }
                },
                {"text": VISION_EXTRACTION_PROMPT},
            ]
        else:
            fmt = "jpeg"
            if "png" in content_type:
                fmt = "png"
            elif "webp" in content_type:
                fmt = "webp"
            elif "gif" in content_type:
                fmt = "gif"
            content = [
                {"image": {"format": fmt, "source": {"bytes": file_bytes}}},
                {"text": VISION_EXTRACTION_PROMPT},
            ]

        result = _call_claude(
            messages=[{"role": "user", "content": content}],
            max_tokens=1000,
            temperature=0.1,
        )
        if not result:
            return None
        data = _parse_json(result)
        if not data or not data.get("firstName"):
            return None
        return {k: v for k, v in data.items() if v not in (None, "null", "")}
    except Exception as e:
        print(f"Vision extraction error: {e}")
        return None


def extract_edit_request(text: str) -> Optional[dict]:
    result = _call_claude(
        messages=[{
            "role": "user",
            "content": [{"text": f"{EDIT_EXTRACTION_PROMPT}\n\nExtract from:\n\n{text}"}],
        }],
        max_tokens=200,
        temperature=0.1,
    )
    if not result:
        return None
    data = _parse_json(result)
    if not data:
        return None
    has_single = data.get("field") and data.get("value") is not None
    has_multi = data.get("fields") and isinstance(data["fields"], list) and len(data["fields"]) > 0
    return data if (has_single or has_multi) else None


def ask_claude_for_help(user_message: str, system_prompt: str) -> str:
    result = _call_claude(
        messages=[{"role": "user", "content": [{"text": user_message}]}],
        system=system_prompt,
        max_tokens=2000,
        temperature=0.7,
    )
    return result or "Sorry, I couldn't generate a response."
