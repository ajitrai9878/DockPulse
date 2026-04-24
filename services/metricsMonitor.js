const { pool } = require('../config/db');
const dockerService = require('./docker.service');
const metricsService = require('./metrics.service');
const emailService = require('./email.service');

const MONITOR_INTERVAL = 60 * 1000; // 1 minute
const alertedContainers = new Map(); // userId_containerName -> timestamp

async function checkMetrics() {
  try {
    // 1. Fetch all active users with thresholds
    const [users] = await pool.query(
      'SELECT id, alert_email, slack_webhook, discord_webhook, custom_webhook, cpu_threshold, ram_threshold, role FROM users WHERE status = "active"'
    );

    if (users.length === 0) return;

    // 2. Fetch all containers from Docker
    const containers = await dockerService.listContainers();

    for (const user of users) {
      // 3. For each user, find their assigned containers (or all if admin)
      let monitoredContainers = [];
      if (user.role === 'admin') {
        monitoredContainers = containers;
      } else {
        const [assignments] = await pool.query(
          'SELECT c.name FROM containers c JOIN user_containers uc ON c.id = uc.container_id WHERE uc.user_id = ?',
          [user.id]
        );
        const assignedNames = assignments.map(a => a.name);
        monitoredContainers = containers.filter(c => 
          c.Names.some(n => assignedNames.includes(n.replace('/', '')))
        );
      }

      // 4. Check each container
      for (const c of monitoredContainers) {
        const name = c.Names[0].replace('/', '');
        const stats = await dockerService.getContainerStats(c.Id);
        if (!stats) continue;

        const cpu = parseFloat(metricsService.calculateCPU(stats));
        const ram = parseFloat(metricsService.calculateMemory(stats).percent);

        let alertType = null;
        let alertValue = 0;
        let threshold = 0;

        if (cpu > (user.cpu_threshold || 90)) {
          alertType = 'CPU';
          alertValue = cpu;
          threshold = user.cpu_threshold || 90;
        } else if (ram > (user.ram_threshold || 90)) {
          alertType = 'RAM';
          alertValue = ram;
          threshold = user.ram_threshold || 90;
        }

        if (alertType) {
          const alertKey = `${user.id}_${name}_${alertType}`;
          const lastAlert = alertedContainers.get(alertKey);
          
          // Cooldown: 15 minutes for threshold alerts
          if (!lastAlert || (Date.now() - lastAlert > 15 * 60 * 1000)) {
            console.log(`[MetricsMonitor] Alert: User ${user.id} container ${name} ${alertType} ${alertValue}% (threshold ${threshold}%)`);
            await triggerAlert(user, name, alertType, alertValue, threshold);
            alertedContainers.set(alertKey, Date.now());
          }
        } else {
          // Clear alerted state if back to normal
          alertedContainers.delete(`${user.id}_${name}_CPU`);
          alertedContainers.delete(`${user.id}_${name}_RAM`);
        }
      }
    }
  } catch (err) {
    console.error('[MetricsMonitor] Error:', err.message);
  }
}

async function triggerAlert(user, containerName, type, value, threshold) {
  const message = `🚨 *DockPulse Threshold Alert*\nContainer: \`${containerName}\`\nMetric: *${type}*\nValue: *${value}%*\nThreshold: *${threshold}%*`;
  
  const payload = {
    containerName,
    eventType: 'THRESHOLD_ALERT',
    metric: type,
    value,
    threshold,
    occurredAt: new Date()
  };

  // Dispatch Webhooks
  const dispatch = async (url, platform) => {
    try {
      let body;
      if (platform === 'slack') body = { text: message };
      else if (platform === 'discord') body = { content: message };
      else body = payload;

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {}
  };

  if (user.slack_webhook) await dispatch(user.slack_webhook, 'slack');
  if (user.discord_webhook) await dispatch(user.discord_webhook, 'discord');
  if (user.custom_webhook) await dispatch(user.custom_webhook, 'custom');

  // Email
  if (user.alert_email) {
    try {
      await emailService.sendAlertEmail({
        to: [user.alert_email],
        containerName,
        eventType: `High ${type} Usage`,
        image: 'N/A',
        occurredAt: new Date(),
        logs: `Current ${type} usage is ${value}%, exceeding threshold of ${threshold}%.`,
        rca: `The container ${containerName} is experiencing high ${type} utilization. Please investigate resource leaks or scale the container.`
      });
    } catch (e) {}
  }
}

function startMetricsMonitor() {
  console.log('[MetricsMonitor] 📊 Background metrics threshold monitor started.');
  setInterval(checkMetrics, MONITOR_INTERVAL);
}

module.exports = { startMetricsMonitor };
