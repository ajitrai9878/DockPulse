const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class HostService {
  async getMetrics() {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    // Load Average (1 min)
    const load = os.loadavg()[0].toFixed(2);

    let disk = { total: 'N/A', used: 'N/A', percent: 0 };
    try {
      if (process.platform !== 'win32') {
        const { stdout } = await execPromise("df -h");
        const lines = stdout.trim().split('\n');
        
        // Skip header
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(/\s+/);
          if (parts.length >= 6) {
            const fs = parts[0];
            const size = parts[1];
            const used = parts[2];
            const percent = parts[4];
            const mount = parts[5];

            // If we find C:\ or a common host mount point, prefer it
            if (fs.includes('C:\\') || fs === 'C:' || mount === '/app') {
              disk = { 
                total: size, 
                used: used, 
                percent: parseInt(percent.replace('%', '')) 
              };
              break; 
            }
            
            // Fallback to / if nothing better found yet
            if (mount === '/' && disk.total === 'N/A') {
              disk = { 
                total: size, 
                used: used, 
                percent: parseInt(percent.replace('%', '')) 
              };
            }
          }
        }
      }
    } catch (e) {
      console.error('Host disk metrics error:', e.message);
    }

    return {
      cpu: { count: cpus.length, load, model: cpus[0].model },
      memory: { 
        total: (totalMem / (1024 ** 3)).toFixed(1) + 'GB',
        used: (usedMem / (1024 ** 3)).toFixed(1) + 'GB', freeMem,
        percent: memPercent
      },
      disk,
      platform: os.platform(),
      uptime: this.formatUptime(os.uptime())
    };
  }

  formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }
}

module.exports = new HostService();
