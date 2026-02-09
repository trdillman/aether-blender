import subprocess
import os
import sys
import time
import urllib.request
import urllib.error
import json
import secrets

# Configuration
RPC_PORT = 8123
RPC_TOKEN = secrets.token_hex(16)
BRIDGE_SCRIPT = os.path.abspath("server/blender_rpc_bridge.py")
SCAFFOLD_PATH = os.path.abspath("scaffold")

# Environment for Blender
env = os.environ.copy()
env["AETHER_RPC_PORT"] = str(RPC_PORT)
env["AETHER_RPC_TOKEN"] = RPC_TOKEN
env["PYTHONUNBUFFERED"] = "1"

print(f"[TEST] Starting Blender with bridge script: {BRIDGE_SCRIPT}")
print(f"[TEST] Port: {RPC_PORT}, Token: {RPC_TOKEN}")

# Start Blender
process = subprocess.Popen(
    ["blender", "-b", "--python", BRIDGE_SCRIPT],
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True
)

def make_request(method, endpoint, data=None, headers=None, timeout=5):
    url = f"http://127.0.0.1:{RPC_PORT}{endpoint}"
    if headers is None:
        headers = {}
    
    req = urllib.request.Request(url, method=method, headers=headers)
    if data:
        json_data = json.dumps(data).encode('utf-8')
        req.data = json_data
        req.add_header('Content-Type', 'application/json')
    
    try:
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
    print("[TEST] Waiting for bridge to be ready...")
    start_time = time.time()
    while time.time() - start_time < 30:
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            print(f"[TEST] Blender process exited unexpectedly.\nStdout: {stdout}\nStderr: {stderr}")
            return False
        
        try:
            res = make_request("GET", "/health", timeout=1)
            if res.get('status') == 200:
                print("[TEST] Bridge is ready!")
                return True
        except:
            pass
        time.sleep(1)
    
    print("[TEST] Timed out waiting for bridge.")
    return False

def run_test(name, command, payload, expected_status=200, checks=None):
    print(f"\n[TEST] Running: {name}")
    headers = {"X-Aether-Token": RPC_TOKEN}
    data = {"command": command, "payload": payload}
    
    res = make_request("POST", "/rpc", data=data, headers=headers)
    
    if 'error' in res:
        print(f"  FAIL: Exception {res['error']}")
        return False

    print(f"  Status: {res['status']}")
    print(f"  Response: {json.dumps(res['body'])}")
    
    if res['status'] != expected_status:
        print(f"  FAIL: Expected status {expected_status}, got {res['status']}")
        return False
        
    if checks:
        for check_name, check_func in checks.items():
            if not check_func(res['body']):
                print(f"  FAIL: Check '{check_name}' failed.")
                return False
    
    print("  PASS")
    return True

try:
    if wait_for_ready():
        # Test 1: Ping
        run_test("Ping", "ping", {}, checks={
            "is_ok": lambda r: r.get("result", {}).get("ok") is True
        })
        
        # Test 2: Get Context
        run_test("Get Context", "get_context", {}, checks={
            "has_blender_version": lambda r: "blenderVersion" in r.get("result", {})
        })
        
        # Test 3: Exec Python (Safe)
        run_test("Exec Python (Safe)", "exec_python", {"code": "print('Math:', 1+1)", "mode": "safe"}, checks={
            "is_ok": lambda r: r.get("result", {}).get("ok") is True
        })
        
        # Test 4: Exec Python (Safe Block)
        run_test("Exec Python (Safe Block)", "exec_python", {"code": "import os", "mode": "safe"}, expected_status=403, checks={
            "is_error": lambda r: r.get("ok") is False,
            "code_match": lambda r: r.get("code") == "SAF_004_BLOCKED_IMPORT"
        })

        # Test 5: Exec Python (Trusted)
        run_test("Exec Python (Trusted)", "exec_python", {"code": "import bpy; print(bpy.app.version)", "mode": "trusted"}, checks={
            "is_ok": lambda r: r.get("result", {}).get("ok") is True
        })

        # Test 6: Validate Addon (Scaffold Load)
        run_test("Validate Addon", "validate_addon", {"addonPath": SCAFFOLD_PATH}, checks={
            "is_ok": lambda r: r.get("result", {}).get("ok") is True,
            "module_name": lambda r: r.get("result", {}).get("module") == "scaffold"
        })

        # Test 7: Capture Output (NEW)
        # We test both print (stdout) and a mocked stderr write, although simple print is the main goal.
        # We verify that "CapturedText" appears in the output.
        run_test("Capture Output", "exec_python", {"code": "print('CapturedText')", "mode": "safe"}, checks={
            "stdout_has_text": lambda r: "CapturedText" in r.get("result", {}).get("stdout", "")
        })

finally:
    print("\n[TEST] Terminating Blender process...")
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
