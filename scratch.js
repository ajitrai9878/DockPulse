const dockerService = require('./services/docker.service');

async function test() {
  const containerId = process.argv[2];
  const logs = await dockerService.getLogs(containerId, { tail: 50 });
  console.log("CLEAN LOG LENGTH:", logs.length);
  console.log("FIRST 50 CHARS:", JSON.stringify(logs.substring(0, 50)));
}

test();
