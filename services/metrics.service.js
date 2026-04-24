class MetricsService {
  calculateCPU(stats) {
    if (!stats || !stats.cpu_stats || !stats.precpu_stats) return 0;

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const onlineCPUs = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;

    if (systemDelta > 0 && cpuDelta > 0) {
      return ((cpuDelta / systemDelta) * onlineCPUs * 100).toFixed(2);
    }
    return 0;
  }

  calculateMemory(stats) {
    if (!stats || !stats.memory_stats) return { usage: 0, limit: 0, percent: 0 };

    const usage = stats.memory_stats.usage || 0;
    const limit = stats.memory_stats.limit || 0;
    const percent = limit > 0 ? ((usage / limit) * 100).toFixed(2) : 0;

    return {
      usage: (usage / (1024 * 1024)).toFixed(2), // MB
      limit: (limit / (1024 * 1024)).toFixed(2), // MB
      percent
    };
  }

  calculateNetwork(stats) {
    if (!stats || !stats.networks) return { rx: '0B', tx: '0B' };
    
    let rx = 0;
    let tx = 0;
    
    Object.values(stats.networks).forEach(net => {
      rx += net.rx_bytes || 0;
      tx += net.tx_bytes || 0;
    });

    return {
      rx: this.formatBytes(rx),
      tx: this.formatBytes(tx)
    };
  }

  calculateBlockIO(stats) {
    if (!stats || !stats.blkio_stats || !stats.blkio_stats.io_service_bytes_recursive) {
      return { read: '0B', write: '0B' };
    }

    let read = 0;
    let write = 0;

    stats.blkio_stats.io_service_bytes_recursive.forEach(io => {
      if (io.op === 'Read') read += io.value;
      if (io.op === 'Write') write += io.value;
    });

    return {
      read: this.formatBytes(read),
      write: this.formatBytes(write)
    };
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + sizes[i];
  }
}

module.exports = new MetricsService();
