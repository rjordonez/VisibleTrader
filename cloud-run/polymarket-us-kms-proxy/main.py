import base64
import hmac
import os

from flask import Flask, jsonify, request
from google.cloud import kms

app = Flask(__name__)

SHARED_SECRET = os.environ["PROXY_SHARED_SECRET"]
KEY_NAME = os.environ["KMS_KEY_NAME"]
client = kms.KeyManagementServiceClient()


def authorized() -> bool:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    # Constant-time comparison: this check is the only thing standing
    # between the public internet and calling a KMS-backed key.
    return hmac.compare_digest(auth[len("Bearer "):], SHARED_SECRET)


@app.post("/encrypt")
def encrypt():
    if not authorized():
        return jsonify(error="unauthorized"), 401
    plaintext = (request.get_json(silent=True) or {}).get("plaintext")
    if not isinstance(plaintext, str) or not plaintext:
        return jsonify(error="plaintext required"), 400
    result = client.encrypt(request={"name": KEY_NAME, "plaintext": plaintext.encode("utf-8")})
    return jsonify(ciphertext=base64.b64encode(result.ciphertext).decode("ascii"), name=result.name)


@app.post("/decrypt")
def decrypt():
    if not authorized():
        return jsonify(error="unauthorized"), 401
    ciphertext_b64 = (request.get_json(silent=True) or {}).get("ciphertext")
    if not isinstance(ciphertext_b64, str) or not ciphertext_b64:
        return jsonify(error="ciphertext required"), 400
    try:
        ciphertext = base64.b64decode(ciphertext_b64, validate=True)
    except Exception:
        return jsonify(error="invalid ciphertext"), 400
    result = client.decrypt(request={"name": KEY_NAME, "ciphertext": ciphertext})
    return jsonify(plaintext=result.plaintext.decode("utf-8"))


@app.get("/status")
def status():
    return jsonify(ok=True)
