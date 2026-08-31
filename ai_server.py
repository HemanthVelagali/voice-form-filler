from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, Optional
import json
import requests

app = FastAPI(title="Local AI Form Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "qwen2.5:3b"


class AIRequest(BaseModel):
    utterance: str
    form_snapshot: Dict[str, Any]
    active_field: Optional[Dict[str, Any]] = None


def build_prompt(
    utterance: str,
    form_snapshot: Dict[str, Any],
    active_field: Optional[Dict[str, Any]],
) -> str:

    compact_forms = []

    for form in form_snapshot.get("forms", []):
        fields = []

        for field in form.get("fields", []):
            fields.append({
                "id": field.get("id"),
                "name": field.get("name"),
                "type": field.get("type"),
                "label": field.get("label"),
                "placeholder": field.get("placeholder"),
                "semantic_field": field.get("semantic_field"),
                "confidence": field.get("confidence"),
                "required": field.get("required"),
                "options": field.get("options", []),
            })

        compact_forms.append({
            "form_id": form.get("form_id"),
            "fields": fields,
            "actions": form.get("actions", []),
        })

    context = {
        "forms": compact_forms,
        "active_field": active_field,
    }

    return f"""
You are the AI reasoning engine for a universal web form filling system.

Understand the user's instruction using the supplied form context.

Return ONLY valid JSON.
Do not use markdown.
Do not explain your reasoning.

Allowed actions:

FILL_VALUE
SELECT_OPTION
SET_RADIO
TOGGLE_CHECKBOX
NAVIGATE_TO_FIELD
NEXT_FIELD
PREVIOUS_FIELD
CLEAR_FIELD
SUBMIT_FORM
NOOP

User instruction:
{utterance}

Form context:
{json.dumps(context, ensure_ascii=False)}

Return exactly:

{{
  "action": "ACTION_NAME",
  "targetFieldId": "field id or null",
  "value": "value or null",
  "confidence": 0.0,
  "reason": "short reason"
}}

Rules:

- Never invent a field.
- Only target fields that exist in the supplied form.
- Never invent a select/radio/checkbox option.
- Prefer semantic_field over raw HTML names.
- Prefer labels over ids and names.
- Preserve the user's requested value.
- If the request is ambiguous, return NOOP.
"""


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL,
        "ollama": OLLAMA_URL,
    }


@app.post("/ai/decide")
def decide(request: AIRequest):

    prompt = build_prompt(
        request.utterance,
        request.form_snapshot,
        request.active_field,
    )

    response = requests.post(
        OLLAMA_URL,
        json={
            "model": MODEL,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0,
                "num_ctx": 2048,
            },
        },
        timeout=120,
    )

    response.raise_for_status()

    data = response.json()

    raw = data.get("response", "").strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")

        if start == -1 or end == -1:
            return {
                "action": "NOOP",
                "targetFieldId": None,
                "value": None,
                "confidence": 0,
                "reason": "AI returned invalid JSON",
            }

        result = json.loads(raw[start:end + 1])

    return result