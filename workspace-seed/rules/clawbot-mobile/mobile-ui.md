# Mobile UI automation rules (DroidRun)

When interacting with Android UI:

1. Prefer accessibility-based actions over coordinates.
   - Use android_ui_find / android_ui_tap / android_ui_type whenever possible.
   - Only use android_tap(x,y) when no reliable accessibility node exists.

2. Always locate before acting:
   - Use android_ui_find with resourceIdContains first if known, then textContains/descContains.
   - If multiple candidates match, refine the query (add classContains, enabledOnly, clickableOnly).
   - Prefer clickable nodes when tapping.

3. Recommended patterns:
   - Tap by text: android_ui_tap_find({textContains:"..."})
   - Type into a field: android_ui_type_find({resourceIdContains:"...", text:"...", clear:true})
   - For icons: use descContains (content description).

4. Safety and stability:
   - Avoid repeated rapid actions. If a step likely triggers navigation, wait and re-check UI.
   - If a tap fails or UI doesn’t change, re-run android_ui_find and try the next candidate.

5. Debug strategy:
   - If the model is uncertain, call android_ui_dump({onlyClickable:true}) to inspect candidates.