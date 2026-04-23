const Docker = require('dockerode');
const docker = new Docker({ socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock' });

class DockerService {
  async listContainers() {
    try {
      const containers = await docker.listContainers({ all: true });
      return containers;
    } catch (err) {
      console.error('Docker listContainers error:', err.message);
      return [];
    }
  }

  async getContainer(containerId) {
    try {
      return docker.getContainer(containerId);
    } catch (err) {
      console.error('Docker getContainer error:', err.message);
      return null;
    }
  }

  async getContainerByName(name) {
    try {
      const containers = await this.listContainers();
      const containerInfo = containers.find(c => 
        c.Names.some(n => n === `/${name}` || n === name)
      );
      if (containerInfo) {
        return docker.getContainer(containerInfo.Id);
      }
      return null;
    } catch (err) {
      console.error('Docker getContainerByName error:', err.message);
      return null;
    }
  }

  async getContainerDetails(containerId) {
    try {
      const container = docker.getContainer(containerId);
      const data = await container.inspect();
      return data;
    } catch (err) {
      console.error('Docker getContainerDetails error:', err.message);
      return null;
    }
  }

  async getContainerStats(containerId) {
    try {
      const container = docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });
      return stats;
    } catch (err) {
      console.error('Docker getContainerStats error:', err.message);
      return null;
    }
  }

  /**
   * Fetches historical logs for a container
   * @param {string} containerId 
   * @param {object} options { since, until, tail }
   */
  async getLogs(containerId, options = {}) {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execPromise = util.promisify(exec);
      
      let cmd = `docker logs --timestamps `;
      if (options.tail) cmd += `--tail ${options.tail} `;
      if (options.since) cmd += `--since "${options.since}" `;
      if (options.until) cmd += `--until "${options.until}" `;
      cmd += `"${containerId}" 2>&1`;
      
      const { stdout } = await execPromise(cmd);
      let logs = stdout;
      
      // If raw is requested, don't strip ANSI
      if (options.raw) return logs;

      return logs.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    } catch (err) {
      console.error('Docker getLogs error:', err.message);
      return '';
    }
  }

  getDockerInstance() {
    return docker;
  }
}

module.exports = new DockerService();
