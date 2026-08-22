"""Validates transform() against the sample payload from the problem spec."""

from main import decode_payload, transform

PAYLOAD = (
    "ewoJImFkYXB0SW5wdXQiOiB7CgkJInVzZXIiOiB7CgkJCSJpZCI6ICJVNDIiLAoJCQkiZnVsbE5hbWUiOiAiSmFuZSBEb2Ui"
    "CgkJfSwKCQkiYWN0aW9uIjogIkNSRUFURSIsCgkJIm1ldGFkYXRhIjogewoJCQkicHJpb3JpdHkiOiAiSElHSCIKCQl9Cgl9Cn0="
)

EXPECTED = {
    "id": "U42",
    "name": "Jane Doe",
    "action": "create",
    "priority": 3,
}

decoded = decode_payload(PAYLOAD)
result = transform(decoded["adaptInput"])

if result == EXPECTED:
    print("[PASS] sample payload")
else:
    print("[FAIL] sample payload")
    print(f"  expected: {EXPECTED}")
    print(f"  got:      {result}")
