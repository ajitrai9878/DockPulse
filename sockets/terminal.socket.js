const dockerService = require('../services/docker.service');

module.exports = (io) => {
  io.on('connection', (socket) => {
    const user = socket.request.session?.user;
    
    socket.on('terminal:start', async ({ containerId }) => {
      if (!user || user.role !== 'admin') {
        socket.emit('terminal:data', '\r\n\x1b[31mError: Permission denied. Only admins can access the terminal.\x1b[0m\r\n');
        socket.disconnect();
        return;
      }

      try {
        const container = dockerService.getDockerInstance().getContainer(containerId);
        
        const exec = await container.exec({
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Cmd: ['/bin/sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi']
        });

        const stream = await exec.start({ stdin: true, hijack: true, isStream: true });
        
        socket.emit('terminal:ready');

        stream.on('data', (chunk) => {
          socket.emit('terminal:data', chunk.toString('utf8'));
        });

        socket.on('terminal:input', (data) => {
          stream.write(data);
        });

        socket.on('terminal:resize', async ({ cols, rows }) => {
          try {
            await exec.resize({ w: cols, h: rows });
          } catch (e) {
            // Ignore resize errors
          }
        });

        socket.on('disconnect', () => {
          try {
            stream.end();
          } catch (e) {}
        });

        stream.on('end', () => {
          socket.emit('terminal:data', '\r\n\x1b[33mTerminal session ended.\x1b[0m\r\n');
          socket.disconnect();
        });

      } catch (err) {
        console.error('Terminal error:', err);
        socket.emit('terminal:data', `\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
        socket.disconnect();
      }
    });
  });
};
