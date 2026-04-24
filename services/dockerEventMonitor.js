'use strict';

const Docker = require('dockerode');
const { pool } = require('../config/db');
const emailService = require('./email.service');
const dockerService = require('./docker.service');

const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const containerAlertTimestamps = new Map(); // containerName -> timestamp
const pendingStopEvents = new Map(); // containerName -> timeoutId

const docker = new Docker({
  socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock',
});

// Events we care about
const WATCHED_EVENTS = new Set(['die', 'stop', 'start', 'restart', 'destroy']);

/**
 * Fetch the last N log lines from a container (best-effort — may fail for destroyed containers).
 */
async function fetchLogs(containerId, tail = 50) {
  try {
    const raw = await dockerService.getLogs(containerId, { tail, raw: false });
    return raw ? raw.trim() : '';
  } catch (err) {
    return `[Logs unavailable: ${err.message}]`;
  }
}

/**
 * Fetch all alert emails that should be notified for a given container.
 * - All admins with alert_email set.
 * - All users assigned to this container with alert_email set.
 * Returns a deduplicated array of emails.
 */
async function getRecipients(containerDbId) {
  try {
    // Admin users
    const [adminRows] = await pool.query(
      `SELECT alert_email, slack_webhook, discord_webhook, custom_webhook FROM users WHERE role = 'admin' AND status = 'active'`
    );

    // User emails for assigned container
    let userRows = [];
    if (containerDbId) {
      [userRows] = await pool.query(
        `SELECT u.alert_email, u.slack_webhook, u.discord_webhook, u.custom_webhook FROM users u
         JOIN user_containers uc ON u.id = uc.user_id
         WHERE uc.container_id = ? AND u.status = 'active'`,
        [containerDbId]
      );
    }

    const allRows = [...adminRows, ...userRows];
    
    return {
      emails: [...new Set(allRows.map(r => r.alert_email).filter(e => e))],
      slack: [...new Set(allRows.map(r => r.slack_webhook).filter(e => e))],
      discord: [...new Set(allRows.map(r => r.discord_webhook).filter(e => e))],
      custom: [...new Set(allRows.map(r => r.custom_webhook).filter(e => e))]
    };
  } catch (err) {
    console.error('[EventMonitor] Failed to fetch recipients:', err.message);
    return { emails: [], slack: [], discord: [], custom: [] };
  }
}

/**
 * Resolve the DB id of a container from its name.
 */
async function resolveDbContainerId(containerName) {
  try {
    const [rows] = await pool.query(
      'SELECT id FROM containers WHERE name = ? LIMIT 1',
      [containerName]
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a container event to the DB for audit purposes.
 */
async function logEventToDB({ containerName, containerId, eventType, exitCode, rca, logs }) {
  try {
    await pool.query(
      `INSERT INTO container_events
         (container_name, container_id, event_type, exit_code, rca, logs_snapshot, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [containerName, containerId, eventType, exitCode ?? null, rca, (logs || '').substring(0, 8000)]
    );
  } catch (err) {
    console.error('[EventMonitor] Failed to log event to DB:', err.message);
  }
}

/**
 * Main handler for a single Docker event.
 */
async function handleEvent(event) {
  if (!event || event.Type !== 'container') return;
  if (!WATCHED_EVENTS.has(event.Action)) return;

  const eventType     = event.Action;
  const containerId   = event.id || event.Actor?.ID;
  const attrs         = event.Actor?.Attributes || {};
  const containerName = attrs.name || containerId;

  // --- Aggregation logic for die/stop ---
  if (eventType === 'die') {
    // Delay 'die' alert by 2 seconds to see if a 'stop' follows
    if (pendingStopEvents.has(containerName)) {
      clearTimeout(pendingStopEvents.get(containerName));
    }
    const timeout = setTimeout(() => {
      pendingStopEvents.delete(containerName);
      processEvent({...event});
    }, 2000);
    pendingStopEvents.set(containerName, timeout);
    return;
  }
  
  if (eventType === 'stop') {
    // If we received a 'stop', cancel the pending 'die' alert (if any)
    if (pendingStopEvents.has(containerName)) {
      clearTimeout(pendingStopEvents.get(containerName));
      pendingStopEvents.delete(containerName);
    }
  }

  await processEvent(event);
}

async function processEvent(event) {
  const eventType     = event.Action;        // die | stop | start | restart | destroy
  const containerId   = event.id || event.Actor?.ID; // short/full container ID
  const attrs         = event.Actor?.Attributes || {};
  const containerName = attrs.name || containerId;
  const image         = attrs.image || 'unknown';
  const exitCode      = attrs.exitCode != null ? parseInt(attrs.exitCode, 10) : null;
  const occurredAt    = new Date((event.time || (Date.now()/1000)) * 1000);

  console.log(`[EventMonitor] ${eventType.toUpperCase()} → ${containerName} (exit: ${exitCode ?? '-'})`);

  // Fetch logs (best-effort)
  const logs = await fetchLogs(containerId);

  // Build RCA
  const rca = emailService.buildRCA ? emailService.buildRCA(eventType, exitCode, logs) : '';

  // Resolve DB container id for user mapping
  const dbContainerId = await resolveDbContainerId(containerName);

  // Persist to DB
  await logEventToDB({ containerName, containerId, eventType, exitCode, rca, logs });

  // Debounce email logic (5 min cooldown)
  const lastAlert = containerAlertTimestamps.get(containerName) || 0;
  const now = Date.now();
  if (now - lastAlert < ALERT_COOLDOWN_MS) {
    console.log(`[EventMonitor] Suppressing email alert for ${containerName} due to cooldown.`);
    return;
  }
  
  // Update last alert timestamp
  containerAlertTimestamps.set(containerName, now);

  // Get recipients
  const recipients = await getRecipients(dbContainerId);
  const totalRecipients = recipients.emails.length + recipients.slack.length + recipients.discord.length + recipients.custom.length;
  
  if (totalRecipients === 0) {
    console.log(`[EventMonitor] No alerts configured — skipping notification for ${containerName}.`);
    return;
  }

  const payload = {
    containerName,
    image,
    eventType,
    exitCode,
    occurredAt,
    logs,
    rca,
  };

  const dispatchWebhook = async (url, type) => {
    try {
      let body;
      const shortLogs = logs.split('\n').slice(-10).join('\n'); // keep it short for chat
      if (type === 'slack') {
        body = { text: `🚨 *DockPulse Alert*\nContainer: \`${containerName}\`\nEvent: *${eventType}*\nRCA: ${rca || 'None'}\nLogs:\n\`\`\`\n${shortLogs}\n\`\`\`` };
      } else if (type === 'discord') {
        body = { content: `🚨 **DockPulse Alert**\nContainer: \`${containerName}\`\nEvent: **${eventType}**\nRCA: ${rca || 'None'}\nLogs:\n\`\`\`\n${shortLogs}\n\`\`\`` };
      } else {
        body = payload;
      }
      
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch(err) {
      console.error(`[EventMonitor] Failed webhook ${type} to ${url.substring(0,20)}...`);
    }
  };

  for (const url of recipients.slack) await dispatchWebhook(url, 'slack');
  for (const url of recipients.discord) await dispatchWebhook(url, 'discord');
  for (const url of recipients.custom) await dispatchWebhook(url, 'custom');

  // Send email
  if (recipients.emails.length > 0) {
    try {
      await emailService.sendAlertEmail({
        ...payload,
        to: recipients.emails
      });
    } catch (err) {
      console.error(`[EventMonitor] Email send failed for ${containerName}:`, err.message);
    }
  }
}

// ─── Stream Lifecycle ──────────────────────────────────────────────────────────

let isRunning = false;

async function startMonitor() {
  if (isRunning) return;
  isRunning = true;
  console.log('[EventMonitor] 🚀 Starting Docker event stream monitor...');

  const connect = async () => {
    try {
      const stream = await docker.getEvents({ filters: JSON.stringify({ type: ['container'] }) });

      stream.on('data', (chunk) => {
        try {
          const events = chunk.toString('utf-8').trim().split('\n');
          for (const raw of events) {
            if (!raw) continue;
            const event = JSON.parse(raw);
            handleEvent(event).catch(err =>
              console.error('[EventMonitor] handleEvent error:', err.message)
            );
          }
        } catch (parseErr) {
          // Ignore malformed chunks
        }
      });

      stream.on('error', (err) => {
        console.error('[EventMonitor] Stream error:', err.message, '— reconnecting in 5s');
        isRunning = false;
        setTimeout(() => { isRunning = false; startMonitor(); }, 5000);
      });

      stream.on('end', () => {
        console.warn('[EventMonitor] Stream ended — reconnecting in 5s');
        isRunning = false;
        setTimeout(() => { isRunning = false; startMonitor(); }, 5000);
      });

      console.log('[EventMonitor] ✅ Listening for container events...');
    } catch (err) {
      console.error('[EventMonitor] Failed to connect to Docker daemon:', err.message, '— retrying in 10s');
      isRunning = false;
      setTimeout(() => startMonitor(), 10000);
    }
  };

  await connect();
}

module.exports = { startMonitor };
