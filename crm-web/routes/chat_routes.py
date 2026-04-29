import json
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from database import get_db
from models import User, PendingContact, ChatMessage, DirectEdit
from auth import get_current_user_id
from services.bedrock_service import (
    extract_contact_info,
    extract_contact_from_image,
    extract_edit_request,
    ask_claude_for_help,
    get_last_bedrock_error,
    get_bedrock_runtime_config,
)
from services.monday_service import send_to_monday

router = APIRouter()

# ── Pending contact helpers ───────────────────────────────────────────────────

def _get_pending(user_id: int, db: Session):
    row = db.query(PendingContact).filter(PendingContact.user_id == user_id).first()
    return json.loads(row.contact_data) if row else None


def _save_pending(user_id: int, contact: dict, db: Session):
    row = db.query(PendingContact).filter(PendingContact.user_id == user_id).first()
    if row:
        row.contact_data = json.dumps(contact)
    else:
        db.add(PendingContact(user_id=user_id, contact_data=json.dumps(contact)))
    db.commit()


def _delete_pending(user_id: int, db: Session):
    db.query(PendingContact).filter(PendingContact.user_id == user_id).delete()
    db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/message")
def chat_message(
    body: ChatMessage,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    msg = body.message.strip()
    msg_lower = msg.lower()
    pending = _get_pending(user_id, db)

    # ── Has pending contact ───────────────────────────────────────────────────
    if pending:
        # Approve
        if re.fullmatch(r"yes|y|approve|approved|send|ok|looks good", msg_lower):
            if not user.monday_api_token or not user.monday_board_id:
                return {
                    "type": "error",
                    "message": (
                        "Monday.com is not configured for your account yet. "
                        "You can still extract contacts with AI, but to save contacts, "
                        "add your Monday API token and board ID."
                    ),
                }
            try:
                item_id = send_to_monday(pending, user.monday_api_token, user.monday_board_id)
                _delete_pending(user_id, db)
                full_name = " ".join(filter(None, [pending.get("firstName"), pending.get("lastName")])) or "Contact"
                return {
                    "type": "success",
                    "message": f"**{full_name}** added to Monday.com! (Item #{item_id})",
                }
            except Exception as e:
                return {"type": "error", "message": f"Monday.com error: {e}"}

        # Reject
        if re.fullmatch(r"no|n|reject|cancel|delete|discard", msg_lower):
            _delete_pending(user_id, db)
            return {"type": "assistant", "message": "Contact discarded. Send me new contact info anytime!"}

        # Edit via natural language
        if re.match(r"^(edit|change|update|modify)\b", msg_lower):
            edit = extract_edit_request(msg)
            if edit:
                if edit.get("field") and edit.get("value") is not None:
                    pending[edit["field"]] = edit["value"]
                    _save_pending(user_id, pending, db)
                    return {
                        "type": "contact_preview",
                        "contact": pending,
                        "message": f"Updated **{edit['field']}** → {edit['value']}",
                    }
                if edit.get("fields"):
                    for f in edit["fields"]:
                        pending[f["field"]] = f["value"]
                    _save_pending(user_id, pending, db)
                    summary = ", ".join(f"**{f['field']}** → {f['value']}" for f in edit["fields"])
                    return {
                        "type": "contact_preview",
                        "contact": pending,
                        "message": f"Updated: {summary}",
                    }
            return {
                "type": "assistant",
                "message": (
                    "To edit, specify the field and new value:\n"
                    "• `edit email to john@example.com`\n"
                    "• `edit name to Jane Smith`\n"
                    "• `change company to TechCorp`\n\n"
                    "Or type **yes** to approve, **no** to discard."
                ),
            }

        # Unrecognized — ask Claude to clarify
        ai_reply = ask_claude_for_help(
            f'The user has a pending contact awaiting approval. They said: "{msg}". '
            "Briefly remind them: yes=approve, no=discard, or edit <field> to <value>.",
            "You are a friendly CRM assistant. Be concise.",
        )
        return {"type": "assistant", "message": ai_reply}

    # ── No pending contact — extract from message ─────────────────────────────
    contact = None
    if len(msg) > 5:
        contact = extract_contact_info(msg)

    if contact and contact.get("firstName"):
        _save_pending(user_id, contact, db)
        return {
            "type": "contact_preview",
            "contact": contact,
            "message": "I found the following contact. Does this look right?",
        }

    bedrock_error = get_last_bedrock_error()
    if bedrock_error:
        cfg = get_bedrock_runtime_config()
        return {
            "type": "error",
            "message": (
                "Bedrock is not reachable from this app right now. "
                "Check AWS CLI/profile, region, and model access. "
                f"Target: {cfg['target_model_id']} in {cfg['region']}. "
                f"Details: {bedrock_error}"
            ),
        }

    ai_reply = ask_claude_for_help(
        f'User message: "{msg}"\n\nNo contact information was found. Respond helpfully.',
        (
            "You are a CRM Contact Manager assistant. Help users share contact details "
            "(name, email, phone, company) or upload a business card image. Be brief and friendly."
        ),
    )
    return {"type": "assistant", "message": ai_reply}


@router.post("/image")
def chat_image(
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    content_type = file.content_type or "image/jpeg"
    file_bytes = file.file.read()

    contact = extract_contact_from_image(file_bytes, content_type)

    if contact and contact.get("firstName"):
        _save_pending(user_id, contact, db)
        return {
            "type": "contact_preview",
            "contact": contact,
            "message": "I analyzed the image and found this contact. Does this look right?",
        }

    bedrock_error = get_last_bedrock_error()
    if bedrock_error:
        cfg = get_bedrock_runtime_config()
        return {
            "type": "error",
            "message": (
                "Bedrock image extraction failed. Check AWS profile, region, and model access. "
                f"Target: {cfg['target_model_id']} in {cfg['region']}. "
                f"Details: {bedrock_error}"
            ),
        }

    return {
        "type": "assistant",
        "message": (
            "I couldn't extract contact information from that image. "
            "Please make sure it's a clear business card or contact sheet."
        ),
    }


@router.post("/edit-contact")
def edit_contact(
    body: DirectEdit,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    pending = _get_pending(user_id, db)
    if not pending:
        raise HTTPException(status_code=404, detail="No pending contact to edit")

    pending.update(body.updates)
    _save_pending(user_id, pending, db)
    return {"type": "contact_preview", "contact": pending, "message": "Contact updated!"}
