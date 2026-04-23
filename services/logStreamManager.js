const EventEmitter = require('events');
const dockerService = require('./docker.service');
const { spawn } = require('child_process');
const stream = require('stream');

class LogStreamManager extends EventEmitter {
  constructor() {
    super();
    this.streams = new Map(); // containerId -> { stream, watchers, buffer, rawBuffer, history, timer, isTty }
    this.FLUSH_INTERVAL = 300; // ms
    this.MAX_BUFFER_SIZE = 2000; // Total lines (history + buffer)
    this.HISTORY_SIZE = 300; // Initial burst size
  }

  /**
   * Subscribe a client to a container's log stream
   */
  async subscribe(containerId, socketId) {
    if (!this.streams.has(containerId)) {
      await this._createStream(containerId);
    }

    const entry = this.streams.get(containerId);
    if (entry) {
      entry.watchers.add(socketId);
      console.log(`[LogStreamManager] Socket ${socketId} subscribed to ${containerId}. Watchers: ${entry.watchers.size}`);
    }
  }

  getHistory(containerId) {
    const entry = this.streams.get(containerId);
    if (!entry) return '';
    return entry.history.join('');
  }

  /**
   * Unsubscribe a client from a container's log stream
   */
  unsubscribe(containerId, socketId) {
    const entry = this.streams.get(containerId);
    if (!entry) return;

    entry.watchers.delete(socketId);
    console.log(`LogStreamManager: Socket ${socketId} unsubscribed from ${containerId}. Total watchers: ${entry.watchers.size}`);

    if (entry.watchers.size === 0) {
      this._destroyStream(containerId);
    }
  }

  /**
   * Clean up all subscriptions for a socket (used on disconnect)
   */
  unsubscribeAll(socketId) {
    for (const [containerId, entry] of this.streams.entries()) {
      if (entry.watchers.has(socketId)) {
        this.unsubscribe(containerId, socketId);
      }
    }
  }

  async _createStream(containerId) {
    try {
      const container = await dockerService.getContainer(containerId);
      if (!container) return;

      // 1. Inspect container to detect TTY setting
      const details = await dockerService.getContainerDetails(containerId);
      const isTty = details?.Config?.Tty || false;

      console.log(`LogStreamManager: Creating new Docker stream for ${containerId} (Tty: ${isTty})`);

      const entry = {
        stream: null,
        watchers: new Set(),
        buffer: [],
        history: [], // Ring buffer for the initial burst
        partialLine: '', // Buffer for fragmented lines
        rawBuffer: Buffer.alloc(0), 
        timer: null,
        isTty
      };

      // 2. SEED HISTORY FIRST (Fast fetch)
      console.log(`[LogStreamManager] Seeding history for ${containerId}...`);
      const historicalLogs = await dockerService.getLogs(containerId, { tail: 300, raw: true });
      if (historicalLogs) {
        this._processContent(containerId, historicalLogs);
        console.log(`[LogStreamManager] Seeded ${entry.history.length} lines for ${containerId}`);
      }

      // 3. Decide: Use API stream or Fallback to CLI?
      this._createApiStream(containerId, entry);

      this.streams.set(containerId, entry);

      // 4. Start the flush timer
      entry.timer = setInterval(() => {
        this._flushBuffer(containerId);
      }, this.FLUSH_INTERVAL);

    } catch (err) {
      console.error(`LogStreamManager failed to create stream for ${containerId}:`, err.message);
    }
  }

  _createApiStream(containerId, entry) {
    if (entry.stream) {
      if (typeof entry.stream.destroy === 'function') entry.stream.destroy();
    }

    dockerService.getContainer(containerId).then(container => {
      if (!container) return;

      container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: 300
      }, (err, logStream) => {
        if (err) {
          console.error(`LogStreamManager API error for ${containerId}:`, err.message);
          this._fallbackToCli(containerId, entry);
          return;
        }

        entry.stream = logStream;

        // SILENT STREAM DETECTION
        // If we get no data within 2 seconds, the API stream might be "stuck" or unsupported.
        let dataReceived = false;
        const silentTimer = setTimeout(() => {
          if (!dataReceived && this.streams.has(containerId)) {
            console.warn(`[LogStreamManager] API stream for ${containerId} is silent. Triggering CLI fallback...`);
            this._fallbackToCli(containerId, entry);
          }
        }, 2000);

        if (entry.isTty) {
          logStream.on('data', (chunk) => {
            dataReceived = true;
            clearTimeout(silentTimer);
            this._processContent(containerId, chunk.toString('utf-8'));
          });
        } else {
          // Use a custom pass-through for demuxing
          const stdout = new stream.PassThrough();
          const stderr = new stream.PassThrough();

          const onData = (chunk) => {
            dataReceived = true;
            clearTimeout(silentTimer);
            this._processContent(containerId, chunk.toString('utf-8'));
          };

          stdout.on('data', onData);
          stderr.on('data', onData);

          // Dockerode modem demuxStream
          const docker = dockerService.getDockerInstance();
          docker.modem.demuxStream(logStream, stdout, stderr);
        }

        logStream.on('error', (err) => {
          console.error(`LogStreamManager API stream error for ${containerId}:`, err.message);
          this._fallbackToCli(containerId, entry);
        });

        logStream.on('end', () => {
          console.log(`LogStreamManager API stream ended for ${containerId}`);
        });
      });
    });
  }

  _fallbackToCli(containerId, entry) {
    console.log(`LogStreamManager: Falling back to CLI 'docker logs' for ${containerId}`);
    
    if (entry.stream && typeof entry.stream.destroy === 'function') {
      entry.stream.destroy();
    }

    const child = spawn('docker', ['logs', '-f', '--tail', '300', containerId]);
    entry.stream = child;

    child.stdout.on('data', (data) => {
      this._processContent(containerId, data.toString('utf-8'));
    });

    child.stderr.on('data', (data) => {
      this._processContent(containerId, data.toString('utf-8'));
    });

    child.on('error', (err) => {
      console.error(`LogStreamManager CLI error for ${containerId}:`, err.message);
    });

    child.on('exit', (code) => {
      console.log(`LogStreamManager CLI process for ${containerId} exited with code ${code}`);
    });
  }

  /**
   * Helper to strip ANSI codes and add to display buffer
   */
  _processContent(containerId, content) {
    const entry = this.streams.get(containerId);
    if (!entry || !content) return;

    // 1. Append to partial line buffer
    entry.partialLine += content;

    // 2. If no newline found, wait for more data (fragment)
    if (!entry.partialLine.includes('\n')) return;

    // 3. Extract complete lines
    const lines = entry.partialLine.split('\n');
    
    // The last element is either empty (if it ended exactly on \n) 
    // or a fragment of the next line.
    entry.partialLine = lines.pop();

    for (const line of lines) {
      // Strip ANSI codes and ensure we have a clean line
      const cleanLine = this._stripAnsi(line) + '\n';
      
      entry.buffer.push(cleanLine);
      entry.history.push(cleanLine);
      
      // Protection against memory leak in active buffer
      if (entry.buffer.length > this.MAX_BUFFER_SIZE) {
        entry.buffer.shift();
      }

      // Maintain specific history size for initial burst
      if (entry.history.length > this.HISTORY_SIZE) {
        entry.history.shift();
      }
    }
  }

  _stripAnsi(text) {
    return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  }

  _flushBuffer(containerId) {
    const entry = this.streams.get(containerId);
    if (!entry || entry.buffer.length === 0) return;

    // Join the buffer directly
    const data = entry.buffer.join('');
    entry.buffer = [];

    // Broadcast specifically to listeners of this container
    this.emit(`log:${containerId}`, data);
  }

  _destroyStream(containerId) {
    const entry = this.streams.get(containerId);
    if (!entry) return;

    console.log(`LogStreamManager: Destroying stream for ${containerId}`);

    if (entry.timer) clearInterval(entry.timer);
    
    // Handle both stream objects and ChildProcess objects
    if (entry.stream) {
      if (typeof entry.stream.destroy === 'function') {
        entry.stream.destroy();
      } else if (typeof entry.stream.kill === 'function') {
        entry.stream.kill();
      }
    }

    this.streams.delete(containerId);
  }
}

module.exports = new LogStreamManager();
