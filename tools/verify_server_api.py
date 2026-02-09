import subprocess
import os
import sys
import time
import urllib.request
import urllib.error
import json

SERVER_PORT = 8787
SERVER_DIR = os.path.abspath("server")

print(f"[TEST] Starting Node.js Server in {SERVER_DIR}")

# Start Server
process = subprocess.Popen(
    ["node", "index.js"],
    cwd=SERVER_DIR,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    env={**os.environ, "PORT": str(SERVER_PORT)}
)

def make_request(method, endpoint, timeout=5):
    url = f"http://127.0.0.1:{SERVER_PORT}{endpoint}"
    try:
        req = urllib.request.Request(url, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return {
                'status': response.status,
                'body': json.loads(response.read().decode('utf-8'))
            }
    except urllib.error.HTTPError as e:
        return {
            'status': e.code,
            'body': json.loads(e.read().decode('utf-8'))
        }
    except Exception as e:
        return {'error': str(e)}

def wait_for_ready():
    print("[TEST] Waiting for server to be ready...")
    start_time = time.time()
    while time.time() - start_time < 30:
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            print(f"[TEST] Server process exited unexpectedly.\nStdout: {stdout}\nStderr: {stderr}")
            return False
        
        try:
            res = make_request("GET", "/api/metrics")
            if res.get('status') == 200:
                print("[TEST] Server is ready!")
                return True
        except:
            pass
        time.sleep(1)
    
    print("[TEST] Timed out waiting for server.")
    return False

try:
    if wait_for_ready():
        print("PASS: Server started and responded to metrics check.")
        
        # Check Settings (Public info)
        res = make_request("GET", "/api/settings")
        print(f"Settings Response: {json.dumps(res['body'])}")
        if res.get('status') == 200:
             print("PASS: /api/settings")
        else:
             print("FAIL: /api/settings")

finally:
    print("[TEST] Terminating Server process...")
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
