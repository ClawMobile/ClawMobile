## Troubleshooting: keyboard stuck on DroidRun IME

### Symptom
- After an automation step, the phone keyboard becomes "DroidRun IME"
- You cannot type normally
- This often happens when the agent pauses to ask for confirmation

### Why it happens
DroidRun switches IME to ensure reliable input.  
If the flow is interrupted (e.g., user confirmation required), IME restoration may not run.

### Fix (ADB)
1. List available IMEs:
   adb shell ime list -s

2. Set your preferred IME (example):
   adb shell ime set com.sohu.inputmethod.sogou.xiaomi/.SogouIME

### Prevention / best practice
- Prefer `android_ui_type` / `android_ui_type_find` when possible
- After a long or interrupted task, consider restoring IME explicitly

## Why completion signals are needed

On Android, chat notifications may be delayed or suppressed due to:
- Battery optimization
- App background restrictions
- Foreground app state

Therefore, task completion should not rely solely on chat notifications.