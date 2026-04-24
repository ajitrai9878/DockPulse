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
}

module.exports = new MetricsService();
