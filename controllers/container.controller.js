const { pool } = require('../config/db');
const dockerService = require('../services/docker.service');
const metricsService = require('../services/metrics.service');
const logStreamManager = require('../services/logStreamManager');
const hostService = require('../services/host.service');

/**
 * Resolves a container instance by ID or Name
 */
async function resolveContainer(idOrName) {
  // 1. Try by ID
  let container = await dockerService.getContainer(idOrName);
  try {
    await container.inspect();
    return container;
  } catch (err) {
    // 2. Fallback to Name
    const byName = await dockerService.getContainerByName(idOrName);
    if (byName) return byName;
    throw new Error('Container not found');
  }
}

exports.getDashboard = async (req, res) => {
  const userId = req.session.user.id;
  const role = req.session.user.role;

  try {
    let containers;
    if (role === 'admin') {
      // Admins see all containers
      const dockerContainers = await dockerService.listContainers();
      containers = dockerContainers.map(c => ({
        container_id: c.Names[0].replace('/', ''),
        name: c.Names[0].replace('/', ''),
        image: c.Image,
        status: c.Status
      }));
    } else {
      // Users see only assigned containers
      const [rows] = await pool.query(`
        SELECT c.* FROM containers c
        JOIN user_containers uc ON c.id = uc.container_id
        WHERE uc.user_id = ?
      `, [userId]);
      
      const dockerContainers = await dockerService.listContainers();
      const assignedIds = new Set(rows.map(r => r.container_id));
      const assignedNames = new Set(rows.map(r => `/${r.name}`));

      const userDockerContainers = dockerContainers.filter(c => 
        assignedIds.has(c.Id) || c.Names.some(n => assignedNames.has(n))
      );

      containers = userDockerContainers.map(c => ({
        container_id: c.Names[0].replace('/', ''),
        name: c.Names[0].replace('/', ''),
        image: c.Image,
        status: c.Status
      }));
    }

    const [userRow] = await pool.query('SELECT alert_email, slack_webhook, discord_webhook, custom_webhook FROM users WHERE id = ?', [userId]);
    const notifications = userRow[0] || {};

    const hostMetrics = await hostService.getMetrics();

    res.render('dashboard', { containers, notifications, role, hostMetrics });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Internal Server Error');
  }
};

exports.getContainerDetail = async (req, res) => {
  const containerId = req.params.id; // This is the docker container ID or DB ID? 
  // Let's assume it's the docker container ID (long string)

  try {
    const container = await resolveContainer(containerId);
    const details = await container.inspect();
    const realId = details.Id;

    const stats = await container.stats({ stream: false });
    const cpu = metricsService.calculateCPU(stats);
    const ram = metricsService.calculateMemory(stats);
    const network = metricsService.calculateNetwork(stats);
    const blockIo = metricsService.calculateBlockIO(stats);

    res.render('container', { 
      container: {
        id: containerId,
        stable_name: containerId,
        name: details.Name.replace('/', ''),
        image: details.Config.Image,
        status: details.State.Status,
        created: details.Created,
        env: details.Config.Env || [],
        mounts: details.Mounts || [],
        networks: Object.keys(details.NetworkSettings.Networks || {}),
        ports: details.NetworkSettings.Ports || {}
      },
      metrics: { cpu, ram, network, blockIo }
    });
  } catch (err) {
    console.error('Container detail error:', err);
    res.status(500).send('Internal Server Error');
  }
};

exports.getHistoricalLogs = async (req, res) => {
  const containerId = req.params.id;
  const { since, until } = req.query;

  try {
    const container = await resolveContainer(containerId);
    const details = await container.inspect();
    const realId = details.Id;
    
    // Using dockerService.getLogs to properly parse multiplexed streams and prevent internal server errors
    let logs = await dockerService.getLogs(realId, { 
      since, 
      until, 
      raw: false 
    });
    
    res.json({ logs });
  } catch (err) {
    console.error('Historical logs error:', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};

exports.streamLogs = async (req, res) => {
  const containerId = req.params.id;
  const clientIp = req.socket.remoteAddress;

  console.log(`[SSE] New connection request: Container=${containerId}, IP=${clientIp}`);

  // 1. Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); 

  // 2. Immediate feedback
  res.write('retry: 5000\n');
  res.write('data: [System] Connected to log stream\n\n');

  // 3. Define the log broadcaster
  const onLog = (data) => {
    // Wrap in JSON to handle multi-line and special chars safely
    res.write(`data: ${JSON.stringify({ log: data })}\n\n`);
  };

  try {
    const container = await resolveContainer(containerId);
    const details = await container.inspect();
    const stableId = details.Id; // The current real ID

    // 4. Register interest (starts stream if needed)
    await logStreamManager.subscribe(stableId, clientIp);
    
    // 5. Send Initial Burst (History)
    const history = logStreamManager.getHistory(stableId);
    if (history) {
      console.log(`[SSE] Sending initial history burst (${history.length} chars) to ${clientIp}`);
      res.write(`data: ${JSON.stringify({ log: history })}\n\n`);
    }

    // 6. Attach listener to specific container event
    logStreamManager.on(`log:${stableId}`, onLog);

    // 7. Keep-alive heartbeat
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': heartbeat\n\n');
      }
    }, 20000);

    // 8. Cleanup on client disconnect
    req.on('close', () => {
      console.log(`[SSE] Client disconnected: ${clientIp}`);
      clearInterval(heartbeat);
      logStreamManager.off(`log:${stableId}`, onLog);
      logStreamManager.unsubscribe(stableId, clientIp);
      res.end();
    });

  } catch (err) {
    console.error(`[SSE] Error for ${containerId}:`, err.message);
    res.write(`data: [Error] ${err.message}\n\n`);
    res.end();
  }
};

exports.containerAction = async (req, res) => {
  const containerId = req.params.id;
  const action = req.params.action;

  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Permission denied. Admins only.' });
  }

  try {
    const container = await resolveContainer(containerId);
    const details = await container.inspect();
    const realId = details.Id;

    if (action === 'start') {
      await dockerService.startContainer(realId);
    } else if (action === 'stop') {
      await dockerService.stopContainer(realId);
    } else if (action === 'restart') {
      await dockerService.restartContainer(realId);
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    res.json({ success: true, action, container: details.Name.replace('/', '') });
  } catch (err) {
    console.error(`Container action ${action} error:`, err);
    res.status(500).json({ error: `Failed to ${action} container: ${err.message}` });
  }
};
