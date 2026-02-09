# Skill: LLM Integration Expert

## Principles
1. **Non-Blocking:** Blender freezes if you call an API on the main thread.
2. **Threading:** Use `threading.Thread(target=my_func).start()`.
3. **Queues:** Use `queue.Queue` to pass messages back to the main thread updater.
4. **Context Safety:** NEVER access `bpy.context` inside a thread unless passing data explicitly. Use `bpy.app.timers.register()` to schedule UI updates from background threads.