'use strict';

const nodemailer = require('nodemailer');

// ─── RCA Engine ────────────────────────────────────────────────────────────────
/**
 * Generates a plain-English Root Cause Analysis string based on event type,
 * exit code, and the tail of the container logs.
 */
function buildRCA(eventType, exitCode, logs) {
  const logLower = (logs || '').toLowerCase();

  // Exit-code-based reasons
  const exitReasons = {
    0:   '✅ Graceful shutdown — the process exited normally with code 0.',
    1:   '⚠️  Application error — the process exited with code 1, indicating an unhandled exception or startup failure.',
    2:   '⚠️  Misuse of shell built-ins or incorrect usage (exit code 2).',
    125: '❌ Docker daemon error — the container could not be created or run.',
    126: '❌ Permission denied — the container command could not be invoked.',
    127: '❌ Command not found — the container entrypoint or CMD binary is missing.',
    130: '🛑 Terminated by SIGINT (Ctrl+C).',
    137: '💥 OOM Killed — the container was forcefully killed, most likely due to exceeding its memory limit (exit code 137 = SIGKILL).',
    139: '💥 Segmentation fault — the process crashed due to invalid memory access (SIGSEGV).',
    143: '🛑 Graceful termination via SIGTERM — the container was stopped by Docker or an orchestrator.',
  };

  let rcaLines = [];

  // Event-level reason
  if (eventType === 'destroy') {
    rcaLines.push('🗑️  The container was permanently removed (docker rm or equivalent).');
  } else if (eventType === 'restart') {
    rcaLines.push('🔄 The container restarted — this is typically triggered by a restart policy (e.g., always, on-failure).');
  } else if (eventType === 'die' || eventType === 'stop') {
    const reason = exitCode != null ? exitReasons[exitCode] : null;
    if (reason) {
      rcaLines.push(reason);
    } else if (exitCode != null) {
      rcaLines.push(`⚠️  Container exited with code ${exitCode}. This is a non-standard exit code — check the logs for details.`);
    } else {
      rcaLines.push('⚠️  Container stopped. Exit code not available.');
    }
  } else if (eventType === 'start') {
    rcaLines.push('▶️  Container started successfully.');
  }

  // Log-pattern analysis
  if (logLower.includes('out of memory') || logLower.includes('oomkilled') || logLower.includes('killed process')) {
    rcaLines.push('📋 Log Analysis: OOM pattern detected — phrases like "out of memory" or "killed process" were found in the logs.');
  }
  if (logLower.includes('panic') || logLower.includes('fatal')) {
    rcaLines.push('📋 Log Analysis: Application panic or FATAL error detected in logs.');
  }
  if (logLower.includes('segfault') || logLower.includes('segmentation fault')) {
    rcaLines.push('📋 Log Analysis: Segmentation fault detected in logs.');
  }
  if (logLower.includes('permission denied')) {
    rcaLines.push('📋 Log Analysis: "Permission denied" found in logs — check file/socket permissions.');
  }
  if (logLower.includes('address already in use') || logLower.includes('eaddrinuse')) {
    rcaLines.push('📋 Log Analysis: Port conflict detected — another process is already bound to the required port.');
  }
  if (logLower.includes('connection refused') || logLower.includes('econnrefused')) {
    rcaLines.push('📋 Log Analysis: Connection refused — a dependency service (DB, Redis, API) may not be ready.');
  }
  if (logLower.includes('no such file or directory')) {
    rcaLines.push('📋 Log Analysis: Missing file or directory detected — a required volume, config, or binary may not exist.');
  }
  if (logLower.includes('timeout') || logLower.includes('deadline exceeded')) {
    rcaLines.push('📋 Log Analysis: Timeout detected — the container or a dependency took too long to respond.');
  }

  return rcaLines.length > 0 ? rcaLines.join('\n') : 'No specific root cause identified. Please review the log snapshot below.';
}

// ─── Email Transport ───────────────────────────────────────────────────────────

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

// ─── Event Badge Colors ────────────────────────────────────────────────────────
const EVENT_META = {
  die:     { label: '🔴 Container Died',      color: '#e53e3e', bg: '#fff5f5' },
  stop:    { label: '🟠 Container Stopped',   color: '#dd6b20', bg: '#fffaf0' },
  destroy: { label: '🗑️  Container Deleted',  color: '#718096', bg: '#f7fafc' },
  restart: { label: '🔵 Container Restarted', color: '#3182ce', bg: '#ebf8ff' },
  start:   { label: '🟢 Container Started',   color: '#38a169', bg: '#f0fff4' },
};

// ─── HTML Email Builder ────────────────────────────────────────────────────────
function buildHtml({ containerName, image, eventType, exitCode, occurredAt, logs, rca }) {
  const meta   = EVENT_META[eventType] || { label: eventType, color: '#4a5568', bg: '#fff' };
  const logHtml = (logs || 'No logs available.')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const rcaHtml = (rca || '')
    .split('\n')
    .map(l => `<p style="margin:4px 0;">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`)
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>DockPulse Alert</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d;">
        
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1f2e 0%,#0d1117 100%);padding:28px 32px;border-bottom:1px solid #30363d;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;color:#58a6ff;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">🐳 DockPulse</p>
                  <h1 style="margin:8px 0 0;color:#e6edf3;font-size:22px;font-weight:700;">${meta.label}</h1>
                </td>
                <td align="right">
                  <span style="background:${meta.color};color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:.5px;">${eventType.toUpperCase()}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Container Info -->
        <tr>
          <td style="padding:24px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;border-radius:8px;border:1px solid #30363d;overflow:hidden;">
              <tr style="border-bottom:1px solid #21262d;">
                <td style="padding:12px 16px;color:#8b949e;font-size:12px;font-weight:600;text-transform:uppercase;width:140px;">Container</td>
                <td style="padding:12px 16px;color:#e6edf3;font-size:14px;font-weight:600;font-family:monospace;">${containerName}</td>
              </tr>
              <tr style="border-bottom:1px solid #21262d;">
                <td style="padding:12px 16px;color:#8b949e;font-size:12px;font-weight:600;text-transform:uppercase;">Image</td>
                <td style="padding:12px 16px;color:#e6edf3;font-size:14px;font-family:monospace;">${image || 'N/A'}</td>
              </tr>
              <tr style="border-bottom:1px solid #21262d;">
                <td style="padding:12px 16px;color:#8b949e;font-size:12px;font-weight:600;text-transform:uppercase;">Event</td>
                <td style="padding:12px 16px;color:#e6edf3;font-size:14px;">${meta.label}</td>
              </tr>
              <tr style="border-bottom:1px solid #21262d;">
                <td style="padding:12px 16px;color:#8b949e;font-size:12px;font-weight:600;text-transform:uppercase;">Time</td>
                <td style="padding:12px 16px;color:#e6edf3;font-size:14px;">${new Date(occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td>
              </tr>
              ${exitCode != null ? `
              <tr>
                <td style="padding:12px 16px;color:#8b949e;font-size:12px;font-weight:600;text-transform:uppercase;">Exit Code</td>
                <td style="padding:12px 16px;color:${exitCode === 0 ? '#3fb950' : '#f85149'};font-size:14px;font-weight:700;font-family:monospace;">${exitCode}</td>
              </tr>` : ''}
            </table>
          </td>
        </tr>

        <!-- RCA Section -->
        <tr>
          <td style="padding:20px 32px 0;">
            <div style="background:#161b22;border:1px solid ${meta.color}40;border-left:3px solid ${meta.color};border-radius:8px;padding:16px 20px;">
              <p style="margin:0 0 10px;color:${meta.color};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">🔍 Root Cause Analysis</p>
              <div style="color:#c9d1d9;font-size:14px;line-height:1.7;">
                ${rcaHtml}
              </div>
            </div>
          </td>
        </tr>

        <!-- Log Snapshot -->
        <tr>
          <td style="padding:20px 32px 0;">
            <p style="margin:0 0 8px;color:#8b949e;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">📄 Log Snapshot (last 50 lines)</p>
            <div style="background:#010409;border:1px solid #30363d;border-radius:8px;padding:16px;overflow:auto;max-height:360px;">
              <pre style="margin:0;color:#79c0ff;font-size:11px;font-family:'Courier New',monospace;white-space:pre-wrap;word-break:break-all;line-height:1.6;">${logHtml}</pre>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px;border-top:1px solid #21262d;margin-top:20px;">
            <p style="margin:0;color:#484f58;font-size:12px;text-align:center;">
              This alert was sent by <strong style="color:#8b949e;">DockPulse</strong> — Docker Container Monitoring.<br>
              You are receiving this because you have alert email notifications enabled.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {string|string[]} opts.to     - Recipient email(s)
 * @param {string} opts.containerName
 * @param {string} [opts.image]
 * @param {string} opts.eventType       - die | stop | restart | destroy | start
 * @param {number|null} [opts.exitCode]
 * @param {Date|string} opts.occurredAt
 * @param {string} [opts.logs]
 * @param {string} [opts.rca]           - Pre-built RCA (or computed from buildRCA)
 */
async function sendAlertEmail(opts) {
  const { to, containerName, image, eventType, exitCode, occurredAt, logs } = opts;
  const rca  = opts.rca || buildRCA(eventType, exitCode, logs);
  const html = buildHtml({ containerName, image, eventType, exitCode, occurredAt, logs, rca });
  const meta = EVENT_META[eventType] || { label: eventType };

  const from = process.env.SMTP_FROM || `"DockPulse Alerts" <${process.env.SMTP_USER}>`;
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);

  if (!recipients.length) {
    console.log('[Email] No recipients — skipping send.');
    return;
  }

  const transport = getTransporter();

  const info = await transport.sendMail({
    from,
    to: recipients.join(', '),
    subject: `[DockPulse] ${meta.label}: ${containerName}`,
    html,
    text: `DockPulse Alert\n\nContainer: ${containerName}\nEvent: ${eventType}\nTime: ${occurredAt}\nExit Code: ${exitCode ?? 'N/A'}\n\nRCA:\n${rca}\n\nLogs:\n${logs || 'N/A'}`,
  });

  console.log(`[Email] Alert sent to [${recipients.join(', ')}] — MessageId: ${info.messageId}`);
}

module.exports = { sendAlertEmail, buildRCA };
