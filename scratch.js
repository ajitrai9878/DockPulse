const http = require('http');
const Docker = require('dockerode');
const docker = new Docker({ socketPath: process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock' });

async function test() {
  const containerName = 'test-stopped';
  let cookie = '';

  try {
    // 1. Create and stop a container
    console.log('Creating container...');
    const container = await docker.createContainer({
      Image: 'alpine',
      name: containerName,
      Cmd: ['echo', 'Historical Log Content Here']
    });
    await container.start();
    await new Promise(r => setTimeout(r, 2000));
    console.log('Container stopped.');

    // 2. Login
    console.log('Logging in...');
    await new Promise((resolve, reject) => {
      const req = http.request('http://localhost:3000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }, (res) => {
        cookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0] : '';
        console.log('Login status:', res.statusCode);
        resolve();
      });
      req.on('error', reject);
      req.write('email=admin@admin.com&password=admin123'); // Use known default
      req.end();
    });

    // 3. GET Container Page
    console.log('Fetching container page...');
    await new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:3000/container/${containerName}`, {
        method: 'GET',
        headers: { 'Cookie': cookie }
      }, (res) => {
        console.log('Page fetch status (Should be 200):', res.statusCode);
        resolve();
      });
      req.on('error', reject);
      req.end();
    });

    // 4. GET Stream Logs
    console.log('Fetching stream...');
    await new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:3000/container/${containerName}/stream`, {
        method: 'GET',
        headers: { 'Cookie': cookie, 'Accept': 'text/event-stream' }
      }, (res) => {
        console.log('Stream status:', res.statusCode);
        let data = '';
        res.on('data', chunk => {
          data += chunk.toString();
          if (data.includes('Historical Log Content Here')) {
            console.log('✅ Successfully received historical logs from stopped container!');
            resolve();
          }
        });
        setTimeout(() => {
          console.log('Stream timeout. Data received:', data);
          resolve();
        }, 3000);
      });
      req.on('error', reject);
      req.end();
    });

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    // Cleanup
    try {
      console.log('Cleaning up container...');
      const container = docker.getContainer(containerName);
      await container.remove({ force: true });
    } catch (e) {}
  }
}

test();
