import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const child = spawn('node', ['build/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

function sendRequest(method: string, params: any) {
  const req = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method,
    params
  };
  child.stdin.write(JSON.stringify(req) + '\n');
}

child.stdout.on('data', (data) => {
  const responses = data.toString().trim().split('\n');
  for (const resStr of responses) {
    if (!resStr) continue;
    try {
      const res = JSON.parse(resStr);
      console.log('--- Response ---');
      console.log(JSON.stringify(res, null, 2));
      
      if (res.result && res.result.content && res.result.content[0].text.includes('Task ID:')) {
         const match = res.result.content[0].text.match(/Task ID: ([a-z0-9-]+)/);
         if (match) {
            const taskId = match[1];
            console.log('Extracted Task ID:', taskId);
            
            setTimeout(() => {
               console.log('Checking status...');
               sendRequest('tools/call', { name: 'check_command_status', arguments: { taskId } });
            }, 1000);

            setTimeout(() => {
               console.log('Stopping...');
               sendRequest('tools/call', { name: 'stop_command', arguments: { taskId } });
            }, 2000);
            
            setTimeout(() => {
               console.log('Checking status again...');
               sendRequest('tools/call', { name: 'check_command_status', arguments: { taskId } });
            }, 3000);

            setTimeout(() => {
               child.kill();
            }, 4000);
         }
      }
    } catch (e) {
      console.error('Parse error:', e, 'Data:', resStr);
    }
  }
});

// Start a background command
sendRequest('tools/call', { name: 'start_background_command', arguments: { command: 'ping localhost -c 10' } });
