"""
Monday.com API service — Python port of MondayClient.ts
"""
import json
import httpx

MONDAY_API_URL = "https://api.monday.com/v2"

SENIOR_TITLES = {
    "ceo", "cto", "cfo", "coo", "president", "vp",
    "director", "partner", "owner", "founder",
}


def _escape(s: str) -> str:
    return (
        s.replace("\\", "\\\\")
         .replace('"', '\\"')
         .replace("\n", "\\n")
         .replace("\r", "\\r")
         .replace("\t", "\\t")
    )


def send_to_monday(contact: dict, api_token: str, board_id: str) -> str:
    full_name = (
        " ".join(filter(None, [contact.get("firstName"), contact.get("lastName")]))
        or "New Contact"
    )

    col: dict = {}

    if contact.get("firstName"):
        col["first_name__1"] = contact["firstName"]
    if contact.get("lastName"):
        col["last_name__1"] = contact["lastName"]
    if contact.get("company"):
        col["company_name__1"] = contact["company"]

    # Lead status based on job title seniority
    status_label = "Lead"
    if contact.get("title"):
        title_lower = contact["title"].lower()
        title_words = set(title_lower.split())
        if title_words & SENIOR_TITLES or "vice president" in title_lower:
            status_label = "Qualified Lead"
    col["status"] = {"label": status_label}

    if contact.get("priority"):
        col["status5"] = {"label": contact["priority"]}

    notes_parts: list[str] = []

    # Phone validation (7–15 digits)
    if contact.get("phone"):
        clean_phone = "".join(c for c in contact["phone"] if c.isdigit())
        if 7 <= len(clean_phone) <= 15:
            col["contact_phone"] = {"phone": clean_phone, "countryShortName": "US"}
        else:
            notes_parts.append(f"Phone (invalid format): {contact['phone']}")

    if contact.get("email"):
        col["contact_email"] = {"email": contact["email"], "text": contact["email"]}

    if contact.get("title"):
        notes_parts.append(f"Title: {contact['title']}")
    if contact.get("additionalPhones"):
        notes_parts.append(f"Additional phones: {contact['additionalPhones']}")
    if contact.get("notes"):
        notes_parts.append(contact["notes"])

    if notes_parts:
        col["long_text4"] = "\n\n".join(notes_parts)

    mutation = (
        f'mutation {{ create_item ('
        f'board_id: {board_id}, '
        f'item_name: "{_escape(full_name)}", '
        f'column_values: {json.dumps(json.dumps(col))}'
        f') {{ id name board {{ id name }} }} }}'
    )

    with httpx.Client(timeout=30) as client:
        response = client.post(
            MONDAY_API_URL,
            json={"query": mutation},
            headers={
                "Authorization": api_token,
                "Content-Type": "application/json",
                "API-Version": "2024-10",
            },
        )
        data = response.json()

    if data.get("errors"):
        err = data["errors"][0].get("message", str(data["errors"]))
        if "authentication" in err or "token" in err:
            raise Exception("Monday.com authentication failed. Check your API token.")
        if "board" in err:
            raise Exception(f"Board not found. Check board ID: {board_id}")
        raise Exception(f"Monday.com error: {err}")

    item_id = data.get("data", {}).get("create_item", {}).get("id")
    if not item_id:
        raise Exception("No item ID returned from Monday.com")

    return item_id
