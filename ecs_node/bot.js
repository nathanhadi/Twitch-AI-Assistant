// Minimal Twitch IRC → DynamoDB bot in Node.js (no external IRC libs)
// Env vars required:
// - OAUTH          (Twitch oauth token, without 'oauth:' prefix is fine)
// - USER           (bot login, lowercase)
// - CHANNEL        (target channel login, lowercase, no '#')
// - AWS_REGION     (e.g., 'us-east-1')
// - CHAT_TABLE     (DynamoDB table name, e.g., 'twitch_chat_logs')

import tls from 'tls';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const CHAT_TABLE = process.env.CHAT_TABLE || 'twitch_chat_logs';
const SECRET_ID = process.env.SECRET_ID || 'twitch-ai';

let OAUTH_RAW = process.env.OAUTH || '';
let USER = (process.env.USER || '').toLowerCase();
let CHANNEL = (process.env.CHANNEL || '').toLowerCase();
let PASS = OAUTH_RAW.startsWith('oauth:') ? OAUTH_RAW : `oauth:${OAUTH_RAW}`;

// Attempt to load missing values from AWS Secrets Manager (expects twitch-ai JSON)
if (!OAUTH_RAW || !USER || !CHANNEL) {
  try {
    const sm = new SecretsManagerClient({ region: AWS_REGION });
    const res = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID, VersionStage: 'AWSCURRENT' }));
    const secretJson = JSON.parse(res.SecretString || '{}');
    // Map from existing secret keys if present
    if (!OAUTH_RAW) {
      const tok = secretJson.TWITCH_BOT_TOKEN || '';
      OAUTH_RAW = tok.startsWith('oauth:') ? tok.slice('oauth:'.length) : tok;
    }
    if (!USER) {
      USER = (secretJson.TWITCH_BOT_USERNAME || secretJson.TWITCH_CHANNEL || '').toLowerCase();
    }
    if (!CHANNEL) {
      CHANNEL = (secretJson.TWITCH_CHANNEL || '').toLowerCase();
    }
    PASS = OAUTH_RAW ? (OAUTH_RAW.startsWith('oauth:') ? OAUTH_RAW : `oauth:${OAUTH_RAW}`) : '';
  } catch (e) {
    console.error('[BOOT] Failed to load secrets:', e?.message || e);
  }
}

if (!OAUTH_RAW || !USER || !CHANNEL) {
  console.error('[BOOT] Missing OAUTH/USER/CHANNEL after secrets load. Set envs or store TWITCH_BOT_TOKEN, TWITCH_BOT_USERNAME/TWITCH_CHANNEL in secret:', SECRET_ID);
  process.exit(1);
}

const ddb = new DynamoDBClient({ region: AWS_REGION });

function nowIso() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(...args);
}

const host = 'irc.chat.twitch.tv';
const port = 6697; // TLS

log(`[BOOT] Connecting to ${host}:${port} as ${USER}, joining #${CHANNEL}`);

const socket = tls.connect(port, host, { servername: host }, () => {
  log('[OPEN] TLS connected');
  socket.write(`PASS ${PASS}\r\n`);
  socket.write(`NICK ${USER}\r\n`);
  socket.write(`JOIN #${CHANNEL}\r\n`);
  socket.write('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership\r\n');
  // Send a friendly greeting after join
  setTimeout(() => {
    try { socket.write(`PRIVMSG #${CHANNEL} :Hi ${USER} is here to help!\r\n`); } catch {}
  }, 1500);
});

socket.setEncoding('utf8');

let buffer = '';
socket.on('data', async (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\r\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line) continue;
    // Keepalive
    if (line.startsWith('PING')) {
      const payload = line.split('PING ')[1] || ':tmi.twitch.tv';
      socket.write(`PONG ${payload}\r\n`);
      continue;
    }

    // Example (tags + prefix):
    // color=...;display-name=theaicoderbot;... :theaicoderbot!theaicoderbot@... PRIVMSG #theaicoderbot :testing
    if (line.includes(' PRIVMSG #')) {
      try {
        let tags = '';
        let restLine = line;
        if (line.startsWith('@')) {
          const sp = line.indexOf(' ');
          tags = line.substring(1, sp); // drop leading '@'
          restLine = line.substring(sp + 1);
        }
        const m = restLine.match(/^:([^!]+)![^ ]+ PRIVMSG #(\w+) :(.*)$/);
        if (!m) continue;
        const nick = m[1];
        const channelName = m[2];
        const messageText = m[3] || '';

        let username = nick;
        const disp = /(?:^|;)display-name=([^;]*)/.exec(tags);
        if (disp && typeof disp[1] === 'string' && disp[1].length > 0) {
          username = disp[1];
        }

        const ts = nowIso();
        if (messageText.trim()) {
          await ddb.send(new PutItemCommand({
            TableName: CHAT_TABLE,
            Item: {
              channel: { S: channelName },
              timestamp: { S: ts },
              username: { S: username },
              message: { S: messageText },
            }
          }));
          log(`${ts} | ${username}: ${messageText}`);
        }
      } catch (err) {
        console.error('[DDB_ERROR]', err?.message || err);
      }
    }
  }
});

socket.on('error', (err) => {
  console.error('[ERROR]', err?.message || err);
});

socket.on('close', () => {
  console.error('[CLOSE] Connection closed');
});


