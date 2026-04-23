const logStreamManager = require('../services/logStreamManager');

module.exports = (io) => {
  // Global listener for log events from the manager
  logStreamManager.on('log', ({ containerId, data }) => {
    // Send log data only to the specific room for this container
    io.to(`container_${containerId}`).emit('log', data);
  });

  io.on('connection', (socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    socket.on('join-container', async (containerId) => {
      console.log(`Socket ${socket.id} joining container log room: ${containerId}`);
      
      try {
        // 1. Clean up any existing subscriptions for this specific socket
        logStreamManager.unsubscribeAll(socket.id);

        // 2. Leave any other container rooms this socket might be in
        for (const room of socket.rooms) {
          if (room !== socket.id) {
            socket.leave(room);
          }
        }

        // 3. Register interest in the manager (triggers stream creation if needed)
        // We use the ID provided by the client, but ensure it's handled consistently
        await logStreamManager.subscribe(containerId, socket.id);

        // 4. Join the socket.io room for broadcast
        socket.join(`container_${containerId}`);
        
      } catch (err) {
        console.error('Error in socket join-container:', err.message);
      }
    });

    socket.on('disconnect', () => {
      // Automatically clean up all subscriptions for this socket
      logStreamManager.unsubscribeAll(socket.id);
      console.log(`Socket client disconnected: ${socket.id}`);
    });
  });
};
