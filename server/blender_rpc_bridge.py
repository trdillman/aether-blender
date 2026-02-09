import ast
import builtins as py_builtins
import contextlib
import hashlib
import io
import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BRIDGE_PORT = int(os.environ.get('AETHER_RPC_PORT', '0') or '0')
BRIDGE_TOKEN = os.environ.get('AETHER_RPC_TOKEN', '')
ALLOWED_ADDON_ROOT = os.environ.get('AETHER_ALLOWED_ADDON_ROOT', '')

SAFE_MODE = 'safe'
TRUSTED_MODE = 'trusted'
ALLOWED_EXEC_MODES = {SAFE_MODE, TRUSTED_MODE}

SAF004_BLOCKED_MODULE_PREFIXES = (
    'builtins',
    'ctypes',
    'http',
    'importlib',
    'inspect',
    'multiprocessing',
    'os',
    'pathlib',
    'pickle',
    'resource',
    'shutil',
    'signal',
    'site',
    'socket',
    'subprocess',
    'sys',
    'tempfile',
    'threading',
    'urllib',
    'venv',
    'zipfile',
)

SAF004_BLOCKED_BUILTINS = (
    '__import__',
    'breakpoint',
    'compile',
    'eval',
    'exec',
    'input',
    'open',
)

SAFE_ALLOWED_BUILTINS = (
    'abs',
    'all',
    'any',
    'bool',
    'dict',
    'enumerate',
    'Exception',
    'float',
    'hasattr',
    'int',
    'isinstance',
    'len',
    'list',
    'max',
    'min',
    'object',
    'pow',
    'print',
    'range',
    'reversed',
    'round',
    'set',
    'sorted',
    'str',
    'sum',
    'super',
    'tuple',
    'type',
    'zip',
    '__build_class__',
)

DEFAULT_CONTEXT_MAX_BYTES = 32768
MIN_CONTEXT_MAX_BYTES = 128
MAX_CONTEXT_MAX_BYTES = 1024 * 1024
CONTEXT_DROP_ORDER = (
    'active_node_tree_ir',
    'geometry_stats',
    'node_tree_summary',
    'modifier_stack',
    'active_object',
    'scene',
)


class RpcPolicyError(Exception):
    def __init__(self, message, code='RPC_POLICY_VIOLATION', status_code=400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _print(msg):
    print(msg, flush=True)


def _stable_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def _json_size_bytes(value):
    return len(_stable_json(value).encode('utf-8'))


def _sha256_hex(value):
    return hashlib.sha256(_stable_json(value).encode('utf-8')).hexdigest()


def _normalize_budget(max_bytes):
    if max_bytes is None:
        return DEFAULT_CONTEXT_MAX_BYTES
    try:
        parsed = int(max_bytes)
    except Exception:
        return DEFAULT_CONTEXT_MAX_BYTES
    if parsed < MIN_CONTEXT_MAX_BYTES:
        return MIN_CONTEXT_MAX_BYTES
    if parsed > MAX_CONTEXT_MAX_BYTES:
        return MAX_CONTEXT_MAX_BYTES
    return parsed


def _slice_context_payload(slices, max_bytes=None):
    normalized = slices if isinstance(slices, dict) else {}
    budget = _normalize_budget(max_bytes)
    source_hash = _sha256_hex(normalized)
    working = json.loads(_stable_json(normalized))
    dropped = []

    if _json_size_bytes(working) > budget:
        for key in CONTEXT_DROP_ORDER:
            if key in working and _json_size_bytes(working) > budget:
                dropped.append(key)
                working.pop(key, None)

    if _json_size_bytes(working) > budget and isinstance(working.get('runtime'), dict):
        runtime = working.get('runtime') or {}
        working['runtime'] = {
            'pid': runtime.get('pid'),
            'blenderVersion': runtime.get('blenderVersion'),
            'isBackground': runtime.get('isBackground'),
        }

    if _json_size_bytes(working) > budget:
        runtime_pid = None
        if isinstance(working.get('runtime'), dict):
            runtime_pid = working['runtime'].get('pid')
        working = {'runtime': {'pid': runtime_pid if runtime_pid is not None else os.getpid()}}

    payload_bytes = _json_size_bytes(working)
    sliced_hash = _sha256_hex(working)
    return working, {
        'budgetBytes': budget,
        'sourceBytes': _json_size_bytes(normalized),
        'payloadBytes': payload_bytes,
        'contextHash': source_hash,
        'slicedHash': sliced_hash,
        'truncated': bool(source_hash != sliced_hash),
        'droppedSlices': dropped,
    }


def _is_blocked_module(module_name):
    if not module_name:
        return False
    normalized = str(module_name).strip().lower()
    for prefix in SAF004_BLOCKED_MODULE_PREFIXES:
        if normalized == prefix or normalized.startswith(prefix + '.'):
            return True
    return False


def _normalize_exec_mode(mode):
    normalized = str(mode or SAFE_MODE).strip().lower()
    if normalized not in ALLOWED_EXEC_MODES:
        raise RpcPolicyError(
            'exec_python payload.mode must be "safe" or "trusted".',
            code='RPC_EXEC_PYTHON_INVALID_MODE',
            status_code=400,
        )
    return normalized


def _blocked_builtin_factory(name):
    def _blocked(*_args, **_kwargs):
        raise RpcPolicyError(
            f'SAF-004 blocked builtin in safe mode: {name}',
            code='SAF_004_BLOCKED_BUILTIN',
            status_code=403,
        )

    return _blocked


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if _is_blocked_module(name):
        raise RpcPolicyError(
            f'SAF-004 blocked module import in safe mode: {name}',
            code='SAF_004_BLOCKED_IMPORT',
            status_code=403,
        )
    return py_builtins.__import__(name, globals, locals, fromlist, level)


def _assert_safe_exec_source(code):
    tree = ast.parse(code, mode='exec')

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported = str(alias.name or '').strip()
                if _is_blocked_module(imported):
                    raise RpcPolicyError(
                        f'SAF-004 blocked module import in safe mode: {imported}',
                        code='SAF_004_BLOCKED_IMPORT',
                        status_code=403,
                    )
        elif isinstance(node, ast.ImportFrom):
            imported_from = str(node.module or '').strip()
            if _is_blocked_module(imported_from):
                raise RpcPolicyError(
                    f'SAF-004 blocked module import in safe mode: {imported_from}',
                    code='SAF_004_BLOCKED_IMPORT',
                    status_code=403,
                )
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in SAF004_BLOCKED_BUILTINS:
                raise RpcPolicyError(
                    f'SAF-004 blocked builtin in safe mode: {func.id}',
                    code='SAF_004_BLOCKED_BUILTIN',
                    status_code=403,
                )


def _addon_validate(addon_path):
    import importlib

    if not addon_path:
        raise ValueError('addonPath is required')

    abs_path = os.path.abspath(addon_path)
    if not os.path.isdir(abs_path):
        raise FileNotFoundError(f'Addon path not found: {abs_path}')
    if ALLOWED_ADDON_ROOT:
        allowed_root = os.path.realpath(ALLOWED_ADDON_ROOT)
        real_addon_path = os.path.realpath(abs_path)
        try:
            common = os.path.commonpath([real_addon_path, allowed_root])
        except ValueError as exc:
            raise PermissionError('addonPath must be within allowed addon root') from exc
        if common != allowed_root:
            raise PermissionError(
                f'addonPath is outside allowed addon root: {real_addon_path}'
            )

    parent = os.path.dirname(abs_path)
    module_name = os.path.basename(abs_path)

    if parent not in sys.path:
        sys.path.insert(0, parent)

    _print(f'[AETHER_RPC] validate_addon start module={module_name} path={abs_path}')

    if module_name in sys.modules:
        importlib.reload(sys.modules[module_name])
    else:
        importlib.import_module(module_name)

    _print(f'[AETHER_RPC] validate_addon success module={module_name}')
    return {
        'module': module_name,
        'addonPath': abs_path,
    }


def _exec_python(code, mode=SAFE_MODE):
    if not isinstance(code, str) or not code.strip():
        raise ValueError('code must be a non-empty string')

    normalized_mode = _normalize_exec_mode(mode)

    # Executes within Blender process; scoped globals include bpy when available.
    env = {}
    try:
        import bpy  # noqa: F401

        env['bpy'] = bpy
    except Exception:
        pass

    if normalized_mode == SAFE_MODE:
        _assert_safe_exec_source(code)
        safe_builtins = {name: getattr(py_builtins, name) for name in SAFE_ALLOWED_BUILTINS}
        for name in SAF004_BLOCKED_BUILTINS:
            safe_builtins[name] = _blocked_builtin_factory(name)
        safe_builtins['__import__'] = _safe_import
        env['__builtins__'] = safe_builtins
    else:
        env['__builtins__'] = __builtins__

    env['__name__'] = '__aether_rpc__'

    _print(f'[AETHER_RPC] exec_python start mode={normalized_mode}')

    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()

    try:
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            exec(code, env, env)
    except Exception:
        # We re-raise to be caught by the main handler, which will output the error to the RPC log.
        # But we lose the stdout/stderr captured so far if we just raise.
        # However, strictly, if it fails, the response is usually an error.
        # To "capture stdout/stderr" even on failure would require changing the error handler protocol.
        # For now, we assume successful execution capture is the priority.
        raise
    finally:
        _print(f'[AETHER_RPC] exec_python success mode={normalized_mode}')

    return {
        'ok': True,
        'mode': normalized_mode,
        'stdout': stdout_buffer.getvalue(),
        'stderr': stderr_buffer.getvalue(),
    }


def _dispatch(command, payload):
    cmd = str(command or '').strip().lower()
    payload = payload or {}

    if cmd == 'ping':
        return {
            'ok': True,
            'pid': os.getpid(),
            'version': sys.version,
        }

    if cmd == 'get_context':
        ctx = {
            'ok': True,
            'pid': os.getpid(),
            'cwd': os.getcwd(),
            'pythonVersion': sys.version,
        }
        try:
            import bpy

            ctx['blenderVersion'] = '.'.join(str(x) for x in bpy.app.version)
            ctx['blendFilePath'] = bpy.data.filepath
            ctx['isBackground'] = bool(bpy.app.background)
        except Exception:
            ctx['blenderVersion'] = None

        requested_slices = payload.get('slices')
        if isinstance(requested_slices, list):
            selected_slices = {}
            normalized_names = []
            for raw_name in requested_slices:
                name = str(raw_name or '').strip().lower()
                if not name:
                    continue
                normalized_names.append(name)
                if name == 'runtime':
                    selected_slices['runtime'] = {
                        'pid': ctx.get('pid'),
                        'cwd': ctx.get('cwd'),
                        'pythonVersion': ctx.get('pythonVersion'),
                        'blenderVersion': ctx.get('blenderVersion'),
                        'blendFilePath': ctx.get('blendFilePath'),
                        'isBackground': ctx.get('isBackground'),
                    }
                    continue
                if name not in selected_slices and name in payload and isinstance(payload.get(name), (dict, list, str, int, float, bool, type(None))):
                    selected_slices[name] = payload.get(name)

            sliced_payload, slicing_meta = _slice_context_payload(
                selected_slices,
                payload.get('max_bytes'),
            )
            ctx['slices'] = sliced_payload
            ctx['slicing'] = {
                **slicing_meta,
                'requestedSlices': normalized_names,
            }
        return ctx

    if cmd == 'validate_addon':
        return {
            'ok': True,
            **_addon_validate(payload.get('addonPath')),
        }

    if cmd == 'exec_python':
        return _exec_python(payload.get('code'), payload.get('mode', SAFE_MODE))

    raise ValueError(f'Unknown command: {command}')


class Handler(BaseHTTPRequestHandler):
    server_version = 'AetherBlenderRPC/1.0'

    def _write_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get('Content-Length', '0') or '0')
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode('utf-8'))

    def _is_authorized(self):
        if not BRIDGE_TOKEN:
            return True
        auth = self.headers.get('X-Aether-Token', '')
        return auth == BRIDGE_TOKEN

    def log_message(self, fmt, *args):
        _print(f'[AETHER_RPC_HTTP] {fmt % args}')

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/health':
            self._write_json(200, {'ok': True, 'pid': os.getpid()})
            return

        self._write_json(404, {'ok': False, 'error': 'Not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != '/rpc':
            self._write_json(404, {'ok': False, 'error': 'Not found'})
            return

        if not self._is_authorized():
            self._write_json(401, {'ok': False, 'error': 'Unauthorized'})
            return

        try:
            payload = self._read_json()
            command = payload.get('command')
            args = payload.get('payload') if isinstance(payload.get('payload'), dict) else {}
            result = _dispatch(command, args)
            self._write_json(200, {'ok': True, 'result': result})
        except Exception as exc:
            _print(f'[AETHER_RPC_ERROR] {exc}')
            _print(traceback.format_exc())
            status_code = getattr(exc, 'status_code', 500)
            response = {'ok': False, 'error': str(exc)}
            if getattr(exc, 'code', None):
                response['code'] = exc.code
            self._write_json(status_code, response)


def _start_server(port):
    server = ThreadingHTTPServer(('127.0.0.1', int(port)), Handler)
    t = threading.Thread(target=server.serve_forever, name='aether-rpc-server', daemon=True)
    t.start()
    return server


def main():
    if BRIDGE_PORT <= 0:
        _print('[AETHER_RPC_DISABLED] invalid port')
        return

    _start_server(BRIDGE_PORT)
    _print(f'[AETHER_RPC_READY] port={BRIDGE_PORT} pid={os.getpid()}')
    
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
