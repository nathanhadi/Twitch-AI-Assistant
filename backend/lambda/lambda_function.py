import os
import json
import boto3
import requests
import openai
import google.generativeai as genai

DDB = boto3.client("dynamodb")
TABLE = os.environ.get("CHAT_TABLE", "twitch_chat_logs")
CORS_HEADERS = {
    "Access-Control-Allow-Origin": os.environ.get("CORS_ALLOW_ORIGIN", "*"),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
}

# --- Secrets Manager loading ---
def get_secret():
    secret_name = "twitch-ai"
    region_name = "us-east-1"
    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)
    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
    except Exception as e:
        return None
    secret = get_secret_value_response['SecretString']
    return json.loads(secret)

_secrets = get_secret() or {}
OPENAI_API_KEY = _secrets.get("OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
# Support both GOOGLE_GEMINI_KEY and GEMINI_API_KEY
GEMINI_API_KEY = _secrets.get("GEMINI_API_KEY") or _secrets.get("GOOGLE_GEMINI_KEY") or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_GEMINI_KEY")
TWITCH_CLIENT_ID = _secrets.get("TWITCH_CLIENT_ID") or os.environ.get("TWITCH_CLIENT_ID")
TWITCH_CLIENT_SECRET = _secrets.get("TWITCH_CLIENT_SECRET") or os.environ.get("TWITCH_CLIENT_SECRET")
# ---

# Use Gemini if set, default to true
USE_GEMINI = os.environ.get("USE_GEMINI")
if USE_GEMINI is None or USE_GEMINI.strip() == "":
    USE_GEMINI = True
else:
    USE_GEMINI = USE_GEMINI.lower() == "true"

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
# Only configure Gemini if API key is present
if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
    except Exception as e:
        print(f"[WARN] Failed to configure Gemini: {e}")
        GEMINI_API_KEY = None  # Clear invalid key

import openai
if OPENAI_API_KEY:
    openai.api_key = OPENAI_API_KEY

def get_app_token():
    url = f"https://id.twitch.tv/oauth2/token"
    params = {
        "client_id": TWITCH_CLIENT_ID,
        "client_secret": TWITCH_CLIENT_SECRET,
        "grant_type": "client_credentials",
    }
    r = requests.post(url, params=params)
    r.raise_for_status()
    return r.json()["access_token"]

def get_stream_started_at(channel):
    app_token = get_app_token()
    res = requests.get(
        f"https://api.twitch.tv/helix/streams?user_login={channel}",
        headers={
            "Client-Id": TWITCH_CLIENT_ID,
            "Authorization": f"Bearer {app_token}"
        })
    if res.status_code != 200:
        raise Exception("Twitch Helix error: " + res.text)
    data = res.json().get("data", [])
    return data[0]["started_at"] if data else None

def scan_session_messages(channel, started_at, max_items=3000):
    items = []
    last = None
    while len(items) < max_items:
        scan_params = {
            "TableName": TABLE,
            "Limit": max_items - len(items),
            "FilterExpression": "#c = :c and #ts >= :since",
            "ExpressionAttributeNames": {"#c": "channel", "#ts": "timestamp"},
            "ExpressionAttributeValues": {":c": {"S": channel}, ":since": {"S": started_at}},
        }
        # Only include ExclusiveStartKey if last is not None
        if last is not None:
            scan_params["ExclusiveStartKey"] = last
        
        res = DDB.scan(**scan_params)
        for i in res.get("Items", []):
            items.append({
                "u": i["username"]["S"],
                "m": i["message"]["S"],
                "t": i["timestamp"]["S"]
            })
        last = res.get("LastEvaluatedKey")
        if not last:
            break
    items.sort(key=lambda x: x["t"])
    return items

def call_openai(prompt):
    completion = openai.ChatCompletion.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        messages=prompt,
        max_tokens=500,
        temperature=0.3,
    )
    return completion["choices"][0]["message"]["content"]

def call_gemini(prompt):
    # prompt: a list of dicts, flatten into a single prompt string
    text = "\n\n".join([m["content"] for m in prompt])
    # Try the configured model, with fallback to common model names
    model_names_to_try = [GEMINI_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-1.5-flash-latest", "gemini-1.5-flash"]
    last_error = None
    for model_name in model_names_to_try:
        try:
            model = genai.GenerativeModel(model_name)
            res = model.generate_content(text)
            return res.text
        except Exception as e:
            last_error = e
            print(f"[WARN] Failed to use model '{model_name}': {e}")
            continue
    # If all models failed, raise the last error
    raise Exception(f"All Gemini models failed. Last error: {last_error}")

def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}
    try:
        # Parse body - handle both string and already-parsed JSON
        body_raw = event.get("body") or "{}"
        if isinstance(body_raw, str):
            try:
                body = json.loads(body_raw)
            except json.JSONDecodeError as e:
                print(f"[ERROR] Failed to parse body as JSON: {body_raw}, error: {e}")
                return {
                    "statusCode": 400, "headers": CORS_HEADERS,
                    "body": json.dumps({"error": f"Invalid JSON in request body: {str(e)}"})
                }
        else:
            body = body_raw
        
        # Debug: log what we received
        print(f"[DEBUG] Event body type: {type(body_raw)}, body: {body}")
        
        question = body.get("question", "").strip() if isinstance(body, dict) else ""
        channel = body.get("channel", "").strip() if isinstance(body, dict) else ""
        max_items = max(200, min(int(body.get("maxMessagesPerChunk", 2000)), 6000)) if isinstance(body, dict) else 2000

        if not question or not channel:
            print(f"[ERROR] Missing question or channel. Question: '{question}', Channel: '{channel}', Body: {body}")
            return {
                "statusCode": 400, "headers": CORS_HEADERS,
                "body": json.dumps({"error": f"Missing question or channel. Received body: {body}"})
            }
        started_at = get_stream_started_at(channel)
        if started_at:
            messages = scan_session_messages(channel, started_at, max_items)
        else:
            res = DDB.scan(TableName=TABLE, Limit=max_items)
            messages = [
                {"u": i["username"]["S"], "m": i["message"]["S"], "t": i["timestamp"]["S"]}
                for i in res.get("Items", [])
                if i["channel"]["S"] == channel
            ]
            messages.sort(key=lambda x: x["t"])
        # Build prompt - AI can answer general questions but use chat context when question is chat-related
        prompt = [
            {"role": "system", "content":
             "You are a helpful AI assistant for a Twitch streamer. You can answer general questions on any topic. You also have access to the streamer's chat logs from their current streaming session. Only use the chat context when the question is specifically about chat, messages, viewers, or stream activity. For general questions (coding, advice, explanations, etc.), answer directly without referencing chat. Always provide concise, helpful answers."},
            {"role": "user", "content":
             f"Chat context from current streaming session (only use if the question is about chat):\n{json.dumps({'channel': channel, 'startedAt': started_at, 'messages': messages, 'messageCount': len(messages)}, indent=2)}"},
            {"role": "user", "content": f"Question: {question}"},
        ]
        # Use Gemini only if enabled AND API key is present, otherwise fall back to OpenAI
        if USE_GEMINI and GEMINI_API_KEY:
            answer = call_gemini(prompt)
        elif OPENAI_API_KEY:
            answer = call_openai(prompt)
        else:
            return {
                "statusCode": 500, "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
                "body": json.dumps({"error": "No AI API key configured. Set GEMINI_API_KEY or OPENAI_API_KEY in Secrets Manager."}),
            }

        return {
            "statusCode": 200, "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
            "body": json.dumps({"answer": answer}),
        }
    except Exception as e:
        return {
            "statusCode": 500, "headers": {**CORS_HEADERS, "Content-Type": "application/json"},
            "body": json.dumps({"error": str(e)}),
        }
