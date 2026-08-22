"""
Adaptive API Gateway — bridges the legacy V1 request shape to the V2 shape.

POST /solve
Body: { "payload": "<base64-encoded JSON string>" }
The decoded JSON has an "adaptInput" object (V1 shape). We transform it into
an "adaptOutput" object (V2 shape) and return it.
"""

import base64
import binascii
import json

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

app = FastAPI()

# Priority word -> numeric level, highest number = most urgent.
# Only "HIGH" -> 3 is confirmed by the sample; the rest are inferred and easy
# to adjust once more examples/spec are available.
PRIORITY_MAP = {
    "LOW": 1,
    "MEDIUM": 2,
    "HIGH": 3,
    "CRITICAL": 4,
    "URGENT": 4,
}
DEFAULT_PRIORITY = 2  # fallback when priority is missing/unrecognized


def decode_payload(payload: str) -> dict:
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"payload is not valid base64: {exc}")

    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"decoded payload is not valid JSON: {exc}")


def transform(adapt_input: dict) -> dict:
    user = adapt_input.get("user", {})
    action = adapt_input.get("action", "")
    metadata = adapt_input.get("metadata", {})
    priority_word = str(metadata.get("priority", "")).upper()

    return {
        "id": user.get("id"),
        "name": user.get("fullName"),
        "action": action.lower(),
        "priority": PRIORITY_MAP.get(priority_word, DEFAULT_PRIORITY),
    }


@app.post("/solve")
async def solve(request: Request):
    body = await request.json()

    payload = body.get("payload")
    if not isinstance(payload, str):
        raise HTTPException(status_code=400, detail="'payload' field (base64 string) is required")

    decoded = decode_payload(payload)

    adapt_input = decoded.get("adaptInput")
    if not isinstance(adapt_input, dict):
        raise HTTPException(status_code=400, detail="decoded payload missing 'adaptInput' object")

    return JSONResponse(content={"adaptOutput": transform(adapt_input)})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
