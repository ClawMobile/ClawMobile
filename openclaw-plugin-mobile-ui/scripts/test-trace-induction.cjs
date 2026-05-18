const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  createMockTraceDir,
  createMockTextInputTraceDir,
  createMockMenuThenTextInputTraceDir,
  createMockEmbeddedPreTextInputTraceDir,
  prepareTraceSummary,
  saveSkillCandidate,
} = require("../dist/trace_induction/summary.js");
const { promoteSkillCandidate } = require("../dist/trace_induction/promote.js");
const { generalizeSkill } = require("../dist/trace_induction/generalize.js");
const { updateSkillFromTrace } = require("../dist/trace_induction/evolve.js");
const { recordSkillFeedback } = require("../dist/trace_induction/feedback.js");
const { getSkillStatus } = require("../dist/trace_induction/status.js");
const { runSkillFastPath } = require("../dist/trace_induction/fastpath.js");
const { reflectFastPathFailure } = require("../dist/trace_induction/repair.js");
const { clawmobile_batch_execute } = require("../dist/tools/batch.js");

const dir = createMockTraceDir();
const prepared = prepareTraceSummary({ recording_dir_or_trace_path: dir });

assert.strictEqual(prepared.ok, true);
assert.strictEqual(prepared.trace_digest.trace_id, "mock_trace");
assert.ok(prepared.trace_digest.allowed_anchors.length > 0);
assert.ok(prepared.prompt.includes("recorded smartphone demonstration"));

const anchor = prepared.trace_digest.allowed_anchors[0];
const candidate = {
  schema_version: "clawmobile.skill_candidate.v1",
  source_trace_id: "mock_trace",
  task_summary: "Send a message in the example app.",
  app: { package: "com.example", activity: "com.example.MainActivity" },
  intent: {
    name: "send_example_message",
    description: "Send a parameterized message in the current example app screen.",
    parameters: {
      message: { type: "string", required: true },
    },
  },
  preconditions: ["The example app is open."],
  anchors: {
    message_input: {
      type: "coordinate_anchor",
      source_step_id: anchor.step_id,
      x_norm: anchor.x_norm,
      y_norm: anchor.y_norm,
      evidence: [anchor.id],
      confidence: 0.8,
    },
  },
  steps: [
    {
      action: "tap_anchor",
      target: "message_input",
      verify_after: "The target input should be focused.",
    },
  ],
  verification: ["Confirm the app remains visible."],
  fallback: ["Ask for a clearer demonstration if the anchor is missing."],
  warnings: [],
};

const saved = saveSkillCandidate({ recording_dir_or_trace_path: dir, candidate });

assert.strictEqual(saved.ok, true);
assert.strictEqual(saved.validation.rejected_anchor_count, 0);
assert.ok(fs.existsSync(path.join(dir, "skill_candidate.json")));
assert.ok(fs.existsSync(path.join(dir, "skill_summary.md")));

const savedCandidate = JSON.parse(fs.readFileSync(path.join(dir, "skill_candidate.json"), "utf8"));
assert.strictEqual(savedCandidate.schema_version, "clawmobile.skill_candidate.v1");
assert.strictEqual(savedCandidate.anchors.message_input.source_step_id, 1);

const shorthandDir = createMockTraceDir();
const shorthandCandidate = {
  ...candidate,
  anchors: {
    message_input: {
      coordinate_anchor: anchor.id,
      source_step_id: anchor.step_id,
      evidence: ["agent selected the recorded tap"],
      confidence: 0.75,
    },
  },
};
const shorthandSaved = saveSkillCandidate({
  recording_dir_or_trace_path: shorthandDir,
  candidate: shorthandCandidate,
});
const shorthandOutput = JSON.parse(fs.readFileSync(path.join(shorthandDir, "skill_candidate.json"), "utf8"));
assert.strictEqual(shorthandSaved.validation.rejected_anchor_count, 0);
assert.ok(shorthandSaved.validation.warnings.some((warning) => warning.includes("shorthand")));
assert.strictEqual(shorthandOutput.anchors.message_input.type, "coordinate_anchor");
assert.strictEqual(shorthandOutput.anchors.message_input.source_anchor_id, anchor.id);
assert.strictEqual(shorthandOutput.anchors.message_input.x_norm, anchor.x_norm);
assert.strictEqual(shorthandOutput.anchors.message_input.y_norm, anchor.y_norm);
assert.ok(fs.existsSync(path.join(shorthandDir, "trace_digest.json")));
assert.ok(fs.existsSync(path.join(shorthandDir, "trace_summary_prompt.md")));

const unsupportedDir = createMockTraceDir();
const unsupportedSaved = saveSkillCandidate({
  recording_dir_or_trace_path: unsupportedDir,
  candidate: {
    ...candidate,
    anchors: {
      message_input: {
        coordinate_anchor: "step_999_tap",
        confidence: 0.7,
      },
      semantic_only: {
        description: "not grounded",
      },
    },
  },
});
const unsupportedOutput = JSON.parse(fs.readFileSync(path.join(unsupportedDir, "skill_candidate.json"), "utf8"));
assert.strictEqual(unsupportedSaved.validation.rejected_anchor_count, 2);
assert.strictEqual(Object.keys(unsupportedOutput.anchors).length, 0);
assert.ok(unsupportedSaved.validation.warnings.some((warning) => warning.includes("missing numeric")));
assert.ok(unsupportedSaved.validation.warnings.some((warning) => warning.includes("unsupported anchor shape")));

const textInputDir = createMockTextInputTraceDir();
const textPrepared = prepareTraceSummary({ recording_dir_or_trace_path: textInputDir });
const textCluster = textPrepared.trace_digest.derived_semantics.text_input_clusters[0];
const postTextAction = textPrepared.trace_digest.derived_semantics.post_text_input_action_candidates[0];
const keyAnchor = textPrepared.trace_digest.allowed_anchors.find((item) => item.id === "step_4_tap");
const sendAnchor = textPrepared.trace_digest.allowed_anchors.find((item) => item.id === "step_5_tap");
assert.deepStrictEqual(textCluster.source_step_ids, [3, 4]);
assert.strictEqual(keyAnchor.role, "soft_keyboard_key");
assert.strictEqual(keyAnchor.replay_allowed, false);
assert.strictEqual(sendAnchor.role, "possible_send_or_confirm");
assert.strictEqual(sendAnchor.replay_allowed, true);
assert.strictEqual(postTextAction.source_anchor_id, "step_5_tap");

const badKeyboardCandidate = {
  ...candidate,
  source_trace_id: "mock_text_input_trace",
  anchors: {
    send_button: {
      type: "coordinate_anchor",
      source_anchor_id: "step_4_tap",
      x_norm: keyAnchor.x_norm,
      y_norm: keyAnchor.y_norm,
      evidence: [keyAnchor.id],
      confidence: 0.8,
    },
  },
  steps: [
    {
      action: "tap_anchor",
      target: "send_button",
    },
  ],
};
const badKeyboardSaved = saveSkillCandidate({
  recording_dir_or_trace_path: textInputDir,
  candidate: badKeyboardCandidate,
});
const badKeyboardOutput = JSON.parse(fs.readFileSync(path.join(textInputDir, "skill_candidate.json"), "utf8"));
assert.strictEqual(badKeyboardSaved.validation.rejected_anchor_count, 1);
assert.strictEqual(Object.keys(badKeyboardOutput.anchors).length, 0);
assert.ok(badKeyboardSaved.validation.warnings.some((warning) => warning.includes("soft_keyboard_key")));
assert.ok(badKeyboardSaved.validation.warnings.some((warning) => warning.includes("missing or rejected anchor send_button")));

const goodSendDir = createMockTextInputTraceDir();
const goodSendCandidate = {
  ...candidate,
  source_trace_id: "mock_text_input_trace",
  anchors: {
    send_button: {
      type: "coordinate_anchor",
      source_anchor_id: "step_5_tap",
      x_norm: sendAnchor.x_norm,
      y_norm: sendAnchor.y_norm,
      evidence: [sendAnchor.id],
      confidence: 0.8,
    },
  },
  steps: [
    {
      action: "type_parameter",
      parameter: "message",
    },
    {
      action: "tap_anchor",
      target: "send_button",
    },
  ],
};
const goodSendSaved = saveSkillCandidate({
  recording_dir_or_trace_path: goodSendDir,
  candidate: goodSendCandidate,
});
const goodSendOutput = JSON.parse(fs.readFileSync(path.join(goodSendDir, "skill_candidate.json"), "utf8"));
assert.strictEqual(goodSendSaved.validation.rejected_anchor_count, 0);
assert.strictEqual(goodSendOutput.anchors.send_button.source_anchor_id, "step_5_tap");
assert.strictEqual(goodSendOutput.anchors.send_button.role, "possible_send_or_confirm");

const menuTextDir = createMockMenuThenTextInputTraceDir();
const menuTextPrepared = prepareTraceSummary({ recording_dir_or_trace_path: menuTextDir });
const preTextAction = menuTextPrepared.trace_digest.derived_semantics.pre_text_input_action_candidates[0];
const menuTextCluster = menuTextPrepared.trace_digest.derived_semantics.text_input_clusters[0];
const menuOptionAnchor = menuTextPrepared.trace_digest.allowed_anchors.find((item) => item.id === "step_2_tap");
const menuKeyAnchor = menuTextPrepared.trace_digest.allowed_anchors.find((item) => item.id === "step_3_tap");
assert.strictEqual(preTextAction.source_anchor_id, "step_2_tap");
assert.deepStrictEqual(menuTextCluster.source_step_ids, [3, 4, 5]);
assert.strictEqual(menuOptionAnchor.role, "text_input_focus_candidate");
assert.strictEqual(menuOptionAnchor.replay_allowed, true);
assert.strictEqual(menuKeyAnchor.role, "soft_keyboard_key");
assert.strictEqual(menuKeyAnchor.replay_allowed, false);
assert.ok(menuTextPrepared.grounding_rules.some((rule) => rule.includes("pre_text_input_action_candidates")));

const embeddedPreTextDir = createMockEmbeddedPreTextInputTraceDir();
const embeddedPreTextPrepared = prepareTraceSummary({ recording_dir_or_trace_path: embeddedPreTextDir });
const embeddedPreActions = embeddedPreTextPrepared.trace_digest.derived_semantics.pre_text_input_action_candidates;
const embeddedTextCluster = embeddedPreTextPrepared.trace_digest.derived_semantics.text_input_clusters[0];
assert.deepStrictEqual(
  embeddedPreActions.map((item) => item.source_anchor_id),
  ["step_2_tap", "step_9_tap", "step_3_tap"]
);
assert.deepStrictEqual(embeddedTextCluster.source_step_ids, [4, 5, 6]);
assert.strictEqual(embeddedPreTextPrepared.trace_digest.app.package, "com.google.android.keep");
assert.strictEqual(embeddedPreActions[0].replay_allowed, true);
assert.strictEqual(embeddedPreActions[0].suggested_replay_action, "tap_anchor_then_ground_text_entry_option");
assert.strictEqual(embeddedPreActions[1].replay_allowed, false);
assert.strictEqual(embeddedPreActions[1].suggested_replay_action, "tap_text_or_reground_then_type_parameter");
assert.strictEqual(embeddedPreActions[2].replay_allowed, false);
assert.strictEqual(embeddedPreActions[2].suggested_replay_action, "tap_text_or_reground_then_type_parameter");
for (const id of ["step_2_tap"]) {
  const preserved = embeddedPreTextPrepared.trace_digest.allowed_anchors.find((item) => item.id === id);
  assert.strictEqual(preserved.role, "text_input_focus_candidate");
  assert.strictEqual(preserved.replay_allowed, true);
}
for (const id of ["step_9_tap", "step_3_tap"]) {
  const blocked = embeddedPreTextPrepared.trace_digest.allowed_anchors.find((item) => item.id === id);
  assert.strictEqual(blocked.role, "text_input_focus_candidate");
  assert.strictEqual(blocked.replay_allowed, false);
  assert.strictEqual(blocked.suggested_replay_action, "tap_text_or_reground_then_type_parameter");
}

const promotedDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawmobile-promoted-skill-"));
const promoted = promoteSkillCandidate({
  recording_dir: goodSendDir,
  output_dir: promotedDir,
  install: false,
});
assert.strictEqual(promoted.ok, true);
assert.ok(promoted.skill_name.startsWith("clawmobile-generated-"));
assert.ok(fs.existsSync(promoted.local_skill_path));
assert.ok(fs.existsSync(promoted.local_fixed_skill_path));
assert.ok(fs.existsSync(promoted.local_generalized_skill_path));
assert.ok(fs.existsSync(promoted.local_generalized_skill_markdown_path));
assert.ok(fs.existsSync(path.join(promoted.local_skill_dir, "manifest.json")));
assert.ok(fs.existsSync(path.join(promoted.local_skill_dir, "skill_candidate.json")));
assert.ok(fs.existsSync(path.join(promoted.local_skill_dir, "source_trace.json")));
const generatedSkill = fs.readFileSync(promoted.local_skill_path, "utf8");
const fixedSkill = fs.readFileSync(promoted.local_fixed_skill_path, "utf8");
assert.ok(generatedSkill.includes("android_tap"));
assert.ok(generatedSkill.includes("android_type"));
assert.ok(generatedSkill.includes("send_button"));
assert.ok(generatedSkill.includes("applicable_with_regrounding"));
assert.ok(fixedSkill.includes("fixed") || fixedSkill.includes("Generated ClawMobile skill from a recorded demonstration"));

const invalidPromotionDir = createMockTextInputTraceDir();
saveSkillCandidate({
  recording_dir_or_trace_path: invalidPromotionDir,
  candidate: badKeyboardCandidate,
});
const invalidPromotion = promoteSkillCandidate({
  recording_dir: invalidPromotionDir,
  output_dir: promotedDir,
  install: false,
});
assert.strictEqual(invalidPromotion.ok, false);
assert.ok(invalidPromotion.errors.some((error) => error.includes("rejected anchors")));

const emptySourceStepCandidate = JSON.parse(JSON.stringify(goodSendOutput));
emptySourceStepCandidate.anchors.send_button.source_step_id = "";
fs.writeFileSync(path.join(invalidPromotionDir, "skill_candidate.json"), `${JSON.stringify(emptySourceStepCandidate, null, 2)}\n`);
const emptySourceStepPromotion = promoteSkillCandidate({
  recording_dir: invalidPromotionDir,
  output_dir: promotedDir,
  install: false,
});
assert.strictEqual(emptySourceStepPromotion.ok, false);
assert.ok(emptySourceStepPromotion.errors.some((error) => error.includes("source_step_id is required")));

const generalizedDir = createMockTextInputTraceDir();
const generalizedCandidate = {
  schema_version: "clawmobile.skill_candidate.v1",
  source_trace_id: "mock_text_input_trace",
  task_summary: "Send a message in the current WeChat chat.",
  app: { package: "com.tencent.mm", activity: "com.tencent.mm.ui.LauncherUI" },
  intent: {
    name: "send_current_chat_message",
    description: "Send a parameterized message in the current chat composer.",
    parameters: {
      message_text: { type: "string", required: true },
    },
  },
  preconditions: ["The target chat is already open and its composer is visible."],
  entry_state_checks: {
    initial_app_state: {
      package: "com.tencent.mm",
      activity: "com.tencent.mm.ui.LauncherUI",
      ui_text_any: ["聊天", "微信"],
    },
  },
  anchors: {
    message_input: {
      type: "coordinate_anchor",
      source_anchor_id: "step_2_tap",
      source_step_id: 2,
      x_norm: 0.4831,
      y_norm: 0.936507,
      evidence: ["step_2_tap"],
      confidence: 0.78,
    },
    send_button: {
      type: "coordinate_anchor",
      source_anchor_id: "step_5_tap",
      source_step_id: 5,
      x_norm: sendAnchor.x_norm,
      y_norm: sendAnchor.y_norm,
      evidence: ["post_text_action_1", "step_5_tap"],
      confidence: 0.7,
    },
  },
  steps: [
    { action: "tap_anchor", target: "message_input", verify_after: "The composer is focused." },
    { action: "type_parameter", parameter: "message_text", verify_after: "The composer contains message_text." },
    { action: "tap_anchor", target: "send_button", verify_after: "The message is sent." },
  ],
  verification: ["Verify the composer clears or a new outgoing message appears."],
  fallback: ["If anchors moved, reground instead of replaying keyboard taps."],
  warnings: [],
};
saveSkillCandidate({ recording_dir_or_trace_path: generalizedDir, candidate: generalizedCandidate });
const generalized = generalizeSkill({ recording_dir: generalizedDir });
assert.strictEqual(generalized.ok, true);
assert.ok(fs.existsSync(generalized.generalized_skill_path));
assert.ok(fs.existsSync(generalized.generalized_skill_markdown_path));
assert.ok(fs.existsSync(generalized.primary_skill_path));
assert.ok(generalized.generalized_skill.intent.parameters.message_text);
assert.ok(!generalized.generalized_skill.intent.parameters.contact);
assert.ok(generalized.generalized_skill.intent.not_covered_parameters.contact);
assert.strictEqual(generalized.generalized_skill.anchors.message_input.stability, "semi_static");
assert.strictEqual(generalized.generalized_skill.anchors.send_button.stability, "semi_static");
assert.strictEqual(generalized.generalized_skill.anchors.message_input.replay_priority, "recorded_anchor_first");
assert.strictEqual(generalized.generalized_skill.anchors.send_button.replay_priority, "recorded_anchor_first");
assert.strictEqual(generalized.generalized_skill.anchors.message_input.anchor_role, "text_input");
assert.strictEqual(generalized.generalized_skill.anchors.message_input.domain, "messaging");
assert.strictEqual(generalized.generalized_skill.anchors.message_input.domain_role, "message_input");
assert.strictEqual(generalized.generalized_skill.anchors.send_button.anchor_role, "post_text_action");
assert.strictEqual(generalized.generalized_skill.anchors.send_button.domain, "messaging");
assert.strictEqual(generalized.generalized_skill.anchors.send_button.domain_role, "send_button");
assert.ok(
  generalized.generalized_skill.anchors.send_button.grounding_policy.includes(
    "do_not_replace_with_visual_guess_before_first_tap"
  )
);
assert.ok(generalized.generalized_skill.anchors.send_button.reground_only_after.includes("recorded post-text action tap fails"));
assert.ok(generalized.generalized_skill.applicability.decision_modes.includes("applicable_with_regrounding"));
assert.ok(generalized.generalized_skill.evolution.open_uncertainties.length > 0);
assert.ok(generalized.generalized_skill.procedure.some((step) => step.action === "type_parameter" && step.parameter === "message_text"));
assert.ok(
  generalized.generalized_skill.procedure.some(
    (step) =>
      step.anchor === "send_button" &&
      step.grounding_policy.includes("Do not substitute a visually guessed coordinate before this first tap")
  )
);
const generalizedMarkdown = fs.readFileSync(generalized.generalized_skill_markdown_path, "utf8");
assert.ok(generalizedMarkdown.includes("applicable_with_regrounding"));
assert.ok(generalizedMarkdown.includes("Not Covered Parameters"));
assert.ok(generalizedMarkdown.includes("Anchor Replay Discipline"));
assert.ok(generalizedMarkdown.includes("clawmobile_generated: true"));
assert.ok(generalizedMarkdown.includes("status_tool: clawmobile_skill_status"));
assert.ok(generalizedMarkdown.includes("Skill Review"));
assert.ok(generalizedMarkdown.includes("record another demonstration of the same task"));
assert.ok(generalizedMarkdown.includes("Prior Execution Experience"));
assert.ok(generalizedMarkdown.includes("tap the recorded action coordinate first"));
assert.ok(generalizedMarkdown.includes("Fast Path Batch"));
assert.strictEqual(generalized.generalized_skill.metadata.clawmobile_generated, true);
assert.strictEqual(generalized.generalized_skill.metadata.status_tool, "clawmobile_skill_status");
assert.strictEqual(generalized.generalized_skill.lifecycle.schema_version, "clawmobile.skill_lifecycle.v1");
assert.strictEqual(generalized.generalized_skill.lifecycle.improvement.preferred_update_tool, "clawmobile_skill_update_from_trace");
assert.strictEqual(generalized.generalized_skill.fast_path.execution_tool, "clawmobile_batch_execute");
assert.strictEqual(generalized.generalized_skill.fast_path.runner_tool, "clawmobile_skill_run_fast_path");
assert.strictEqual(generalized.generalized_skill.fast_path.eligible, true);
assert.strictEqual(generalized.generalized_skill.fast_path.steps[0].action, "assert_app_state");
assert.strictEqual(generalized.generalized_skill.fast_path.steps[0].package, "com.tencent.mm");
assert.ok(generalized.generalized_skill.fast_path.steps[0].ui_text_any.includes("微信"));
const primaryGeneralizedMarkdown = fs.readFileSync(generalized.primary_skill_path, "utf8");
assert.strictEqual(primaryGeneralizedMarkdown, generalizedMarkdown);

const keepCandidateDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawmobile-keep-candidate-"));
const keepCandidate = {
  schema_version: "clawmobile.skill_candidate.v1",
  source_trace_id: "mock_keep_trace",
  task_summary: "Open Google Keep, create a plain text note, enter a title and body, and return to the notes list.",
  app: { package: "com.google.android.keep", activity: "com.google.android.keep.activities.BrowseActivity" },
  intent: {
    name: "create_keep_note",
    description: "Create a new Google Keep text note with a parameterized title and body.",
    parameters: {
      title_text: { type: "string", required: true },
      body_text: { type: "string", required: true },
    },
  },
  entry_state_checks: {
    after_app_open: {
      package: "com.google.android.keep",
      activity: "com.google.android.keep.activities.BrowseActivity",
      ui_text_any: ["Search your notes", "Notes"],
    },
  },
  anchors: {
    new_text_note_button: {
      type: "coordinate_anchor",
      source_anchor_id: "step_2_tap",
      source_step_id: 2,
      x_norm: 0.84,
      y_norm: 0.89,
      x: 906,
      y: 2164,
      role: "text_input_focus_candidate",
      evidence: ["after screenshot transitions to a text input state with keyboard for note entry"],
      confidence: 0.78,
    },
    title_field: {
      type: "coordinate_anchor",
      source_anchor_id: "step_20_tap",
      source_step_id: 20,
      x_norm: 0.065,
      y_norm: 0.178,
      x: 70,
      y: 430,
      evidence: ["tap near top of note editor; follows text input for note title"],
      confidence: 0.76,
    },
    keyboard_hide_or_back: {
      type: "coordinate_anchor",
      source_anchor_id: "step_25_tap",
      source_step_id: 25,
      x_norm: 0.155,
      y_norm: 0.97,
      x: 168,
      y: 2350,
      evidence: ["tap in bottom navigation/keyboard area after title text entry"],
      confidence: 0.55,
    },
    keep_toolbar_back: {
      type: "coordinate_anchor",
      source_anchor_id: "step_26_tap",
      source_step_id: 26,
      x_norm: 0.067,
      y_norm: 0.101,
      x: 72,
      y: 246,
      evidence: ["top-left toolbar/back area after note content entry; returns to Keep notes grid"],
      confidence: 0.82,
    },
  },
  steps: [
    { action: "open_app", package: "com.google.android.keep", verify_after: "Google Keep should open to the notes list." },
    { action: "tap_anchor", target: "new_text_note_button", verify_after: "A new Google Keep note editor should open." },
    { action: "tap_text", text: "Text", verify_after: "The plain text note editor should open." },
    { action: "type_parameter", parameter: "body_text", verify_after: "The note body field contains body_text." },
    { action: "tap_anchor", target: "title_field", verify_after: "The title field is focused." },
    { action: "type_parameter", parameter: "title_text", verify_after: "The title field contains title_text." },
    { action: "tap_anchor", target: "keyboard_hide_or_back", verify_after: "The keyboard is hidden or toolbar is accessible." },
    { action: "tap_anchor", target: "keep_toolbar_back", verify_after: "Google Keep returns to the notes list/grid." },
  ],
  verification: ["Confirm the foreground package is com.google.android.keep."],
  fallback: [
    "If the create-note button anchor is stale, use UI/OCR grounding for the visible Google Keep plus/create control.",
    "If the Text option anchor is stale, use OCR or UI text to tap the visible option labeled Text.",
  ],
  warnings: [],
};
fs.writeFileSync(path.join(keepCandidateDir, "skill_candidate.json"), `${JSON.stringify(keepCandidate, null, 2)}\n`);
const keepGeneralized = generalizeSkill({ recording_dir: keepCandidateDir, skill_name: "keep-create-note" });
assert.strictEqual(keepGeneralized.ok, true);
const keepMarkdown = fs.readFileSync(keepGeneralized.generalized_skill_markdown_path, "utf8");
const keepJsonText = JSON.stringify(keepGeneralized.generalized_skill);
for (const forbidden of [
  "chat_or_composer_visible",
  "conversation_entry_visible",
  "message_input",
  "compatible message composer",
  "compatible chat/composer",
  "composer contains",
  "send/confirm anchors",
]) {
  assert.ok(!keepMarkdown.includes(forbidden), `Keep markdown should not include ${forbidden}`);
  assert.ok(!keepJsonText.includes(forbidden), `Keep JSON should not include ${forbidden}`);
}
assert.ok(keepGeneralized.generalized_skill.entry_states.some((state) => state.name === "text_entry_screen_visible"));
assert.strictEqual(keepGeneralized.generalized_skill.anchors.new_text_note_button.anchor_role, "text_input_trigger");
assert.strictEqual(keepGeneralized.generalized_skill.anchors.new_text_note_button.domain_role, "new_text_note_action");
assert.ok(keepGeneralized.generalized_skill.anchors.new_text_note_button.valid_when.includes("text entry"));
assert.ok(keepGeneralized.generalized_skill.anchors.title_field.reground_only_after.includes("expected field/control"));
assert.ok(keepGeneralized.generalized_skill.anchors.keyboard_hide_or_back.valid_when.includes("navigation"));
assert.ok(
  keepGeneralized.generalized_skill.anchors.keyboard_hide_or_back.grounding_policy.includes(
    "prefer_keyevent_if_equivalent_and_safer"
  )
);
assert.strictEqual(keepGeneralized.generalized_skill.fast_path.eligible, true);
const keepTextEntryStep = keepGeneralized.generalized_skill.fast_path.steps.find(
  (step) => step.action === "tap_anchor" && step.anchor === "new_text_note_button"
);
assert.ok(keepTextEntryStep);
assert.strictEqual(keepTextEntryStep.x, 906);
assert.strictEqual(keepTextEntryStep.y, 2164);
assert.ok(
  keepGeneralized.generalized_skill.fast_path.steps.some(
    (step) => step.action === "open_app" && step.package === "com.google.android.keep"
  )
);
assert.ok(
  keepGeneralized.generalized_skill.fast_path.steps.some(
    (step) => step.action === "assert_app_state" && step.package === "com.google.android.keep"
  )
);
assert.ok(!keepGeneralized.generalized_skill.fast_path.unsupported.some((item) => item.includes("open_app")));

async function runAsyncChecks() {
  const dryRunBatch = await clawmobile_batch_execute({
    label: "mock-generated-fast-path",
    dry_run: true,
    anchors: generalized.generalized_skill.anchors,
    parameters: { message_text: "hello" },
    steps: generalized.generalized_skill.fast_path.steps,
  });
  assert.strictEqual(dryRunBatch.ok, true);
  assert.strictEqual(dryRunBatch.dry_run, true);
  assert.strictEqual(dryRunBatch.executed_count, generalized.generalized_skill.fast_path.steps.length);

  const keepFastPathDryRun = await runSkillFastPath({
    skill_dir: keepCandidateDir,
    dry_run: true,
    parameters: {
      title_text: "A title",
      body_text: "A body",
    },
  });
  assert.strictEqual(keepFastPathDryRun.ok, true);
  assert.strictEqual(keepFastPathDryRun.dry_run, true);
  assert.strictEqual(keepFastPathDryRun.fast_path.eligible, true);
  assert.ok(keepFastPathDryRun.batch.results.some((item) => item.action === "tap_anchor" && item.id.includes("new_text_note_button")));
}

const looseCandidateDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawmobile-loose-candidate-"));
const looseCandidate = {
  ...generalizedCandidate,
  source_trace_id: "mock_text_input_trace_loose_actions",
  steps: [
    { action: "tap", target: "message_input", verify_after: "The composer is focused." },
    { action: "input_text", parameter: "message_text", verify_after: "The composer contains message_text." },
    { action: "tap", target: "send_button", verify_after: "The message is sent." },
    { action: "press_key", key: "BACK", verify_after: "The app returns to the previous screen." },
  ],
};
fs.writeFileSync(path.join(looseCandidateDir, "skill_candidate.json"), `${JSON.stringify(looseCandidate, null, 2)}\n`);
const looseGeneralized = generalizeSkill({
  candidate_path: path.join(looseCandidateDir, "skill_candidate.json"),
  output_dir: looseCandidateDir,
  skill_name: "loose-action-skill",
});
assert.deepStrictEqual(
  looseGeneralized.generalized_skill.procedure.map((step) => step.action),
  ["tap_anchor", "type_parameter", "tap_anchor", "key_event"]
);
assert.strictEqual(looseGeneralized.generalized_skill.procedure[0].source_action, "tap");
assert.strictEqual(looseGeneralized.generalized_skill.procedure[1].source_action, "input_text");
assert.strictEqual(looseGeneralized.generalized_skill.procedure[3].key, "BACK");
const looseMarkdown = fs.readFileSync(looseGeneralized.primary_skill_path, "utf8");
assert.ok(!looseMarkdown.includes("Use recorded evidence only; require explicit validation before execution."));
assert.ok(looseMarkdown.includes("Tool: use `adb_keyevent` with key `BACK`."));

const secondCandidateDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawmobile-second-candidate-"));
const secondCandidate = {
  ...generalizedCandidate,
  source_trace_id: "mock_text_input_trace_2",
  anchors: {
    message_input: {
      ...generalizedCandidate.anchors.message_input,
      x_norm: 0.485,
      y_norm: 0.937,
      x: 524,
      y: 2271,
      evidence: ["second_trace_step_2_tap"],
    },
    send_button: {
      ...generalizedCandidate.anchors.send_button,
      x_norm: 0.934,
      y_norm: 0.559,
      x: 1009,
      y: 1355,
      evidence: ["second_trace_post_text_action_1", "second_trace_step_5_tap"],
    },
  },
};
fs.writeFileSync(path.join(secondCandidateDir, "skill_candidate.json"), `${JSON.stringify(secondCandidate, null, 2)}\n`);

const evolved = updateSkillFromTrace({
  existing_skill_dir: generalizedDir,
  new_recording_dir_or_candidate_path: secondCandidateDir,
});
assert.strictEqual(evolved.ok, true);
assert.strictEqual(evolved.source_traces.length, 2);
assert.ok(evolved.source_traces.includes("mock_text_input_trace"));
assert.ok(evolved.source_traces.includes("mock_text_input_trace_2"));
assert.strictEqual(evolved.generalized_skill.evolution.supporting_trace_count, 2);
assert.strictEqual(evolved.generalized_skill.anchors.send_button.observation_count, 2);
assert.strictEqual(evolved.generalized_skill.anchors.send_button.stability, "stable_multi_trace");
assert.strictEqual(evolved.generalized_skill.anchors.send_button.replay_priority, "recorded_anchor_first");
assert.ok(evolved.generalized_skill.evolution.anchor_updates.some((item) => item.anchor === "send_button"));
assert.ok(fs.existsSync(evolved.evidence_dir));
assert.ok(fs.existsSync(path.join(evolved.evidence_dir, "skill_candidate.json")));
const evolvedMarkdown = fs.readFileSync(evolved.primary_skill_path, "utf8");
assert.ok(evolvedMarkdown.includes("supporting_trace_count") || evolvedMarkdown.includes("Success count"));
assert.ok(evolvedMarkdown.includes("Recorded coordinate"));
assert.ok(evolvedMarkdown.includes("Execution Feedback"));

const successFeedback = recordSkillFeedback({
  skill_dir: evolved.updated_skill_dir,
  outcome: "success",
  execution_summary: "Mock execution completed and final verification passed.",
  parameters: { message_text: "hello" },
  used_anchors: ["message_input", "send_button"],
  observations: { final: "composer cleared" },
  final_state: { package: "com.tencent.mm", activity: "com.tencent.mm.ui.LauncherUI" },
});
assert.strictEqual(successFeedback.ok, true);
assert.strictEqual(successFeedback.success_count, 1);
assert.strictEqual(successFeedback.failure_count, 0);
assert.strictEqual(successFeedback.verified_context_count, 1);
assert.ok(fs.existsSync(successFeedback.feedback_log_path));
assert.strictEqual(successFeedback.generalized_skill.anchors.send_button.execution_success_count, 1);
assert.strictEqual(successFeedback.generalized_skill.evolution.verified_contexts.length, 1);
assert.ok(successFeedback.generalized_skill.evolution.verified_contexts[0].used_anchors.includes("send_button"));
assert.ok(successFeedback.generalized_skill.evolution.verified_contexts[0].parameter_keys.includes("message_text"));
assert.ok(successFeedback.next_steps.some((step) => step.includes("skill completed successfully")));

const failureFeedback = recordSkillFeedback({
  skill_dir: evolved.updated_skill_dir,
  outcome: "failure",
  execution_summary: "Send verification failed after tapping the recorded send button.",
  failed_step: "tap send_button",
  failed_anchor: "send_button",
  observations: { final: "message still in composer" },
  repair_hint: "send_button may need regrounding in this layout",
});
assert.strictEqual(failureFeedback.ok, true);
assert.strictEqual(failureFeedback.success_count, 1);
assert.strictEqual(failureFeedback.failure_count, 1);
assert.strictEqual(failureFeedback.verified_context_count, 1);
assert.strictEqual(failureFeedback.failure_pattern_count, 1);
assert.strictEqual(failureFeedback.generalized_skill.anchors.send_button.execution_failure_count, 1);
assert.ok(failureFeedback.generalized_skill.anchors.send_button.last_failure.execution_summary.includes("Send verification failed"));
assert.strictEqual(failureFeedback.generalized_skill.evolution.failure_patterns.length, 1);
assert.strictEqual(failureFeedback.generalized_skill.evolution.failure_patterns[0].failed_anchor, "send_button");
assert.ok(failureFeedback.generalized_skill.evolution.execution_guidance.hints.length > 0);
assert.ok(
  failureFeedback.generalized_skill.evolution.execution_guidance.anchor_guidance.some((item) => item.anchor === "send_button")
);
assert.strictEqual(failureFeedback.generalized_skill.evolution.execution_guidance.fast_path_self_repair.recommended, true);
assert.strictEqual(failureFeedback.generalized_skill.evolution.execution_guidance.fast_path_self_repair.tool, "clawmobile_skill_reflect_fast_path_failure");
assert.ok(
  failureFeedback.generalized_skill.evolution.open_uncertainties.some((item) =>
    String(item).includes("Execution failure recorded")
  )
);
assert.ok(failureFeedback.next_steps.some((step) => step.includes("correction demo")));
const feedbackMarkdown = fs.readFileSync(failureFeedback.primary_skill_path, "utf8");
assert.ok(feedbackMarkdown.includes("Verified Contexts"));
assert.ok(feedbackMarkdown.includes("Failure Patterns"));
assert.ok(feedbackMarkdown.includes("Correction demo hint"));
const feedbackLines = fs.readFileSync(failureFeedback.feedback_log_path, "utf8").trim().split(/\n/);
assert.strictEqual(feedbackLines.length, 2);
const status = getSkillStatus({
  skill_dir: evolved.updated_skill_dir,
  include_anchor_details: true,
  include_history: true,
  max_history: 2,
});
assert.strictEqual(status.ok, true);
assert.strictEqual(status.generated.clawmobile_generated, true);
assert.strictEqual(status.generated.feedback_tool, "clawmobile_skill_record_feedback");
assert.strictEqual(status.generated.status_tool, "clawmobile_skill_status");
assert.strictEqual(status.stats.success_count, 1);
assert.strictEqual(status.stats.failure_count, 1);
assert.strictEqual(status.stats.verified_context_count, 1);
assert.strictEqual(status.stats.failure_pattern_count, 1);
assert.ok(status.anchors.send_button.execution_success_count >= 1);
assert.ok(status.verified_contexts[0].used_anchors.includes("send_button"));
assert.ok(status.execution_guidance.hints.length > 0);
assert.ok(status.execution_guidance.anchor_guidance.some((item) => item.anchor === "send_button"));
assert.strictEqual(status.recommended_next_action.tool, "clawmobile_skill_reflect_fast_path_failure");
assert.strictEqual(status.recommended_next_action.retry_tool, "clawmobile_skill_run_fast_path");
assert.strictEqual(status.recent_execution_history.length, 2);
const compactStatus = getSkillStatus({ skill_dir: evolved.updated_skill_dir });
assert.strictEqual(compactStatus.ok, true);
assert.strictEqual(compactStatus.anchors, undefined);
assert.strictEqual(compactStatus.recent_execution_history.length, 0);
assert.ok(compactStatus.anchor_stats.execution_success_count >= 1);
assert.throws(() => getSkillStatus({ skill_name: "../outside" }), /skill_name must be an identifier/);
assert.throws(() => recordSkillFeedback({ skill_name: "../outside", outcome: "success" }), /skill_name must be an identifier/);
assert.throws(() => reflectFastPathFailure({ skill_name: "../outside" }), /skill_name must be an identifier/);

const repairSkillDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "clawmobile-fastpath-repair-"));
const repairGeneralized = {
  schema_version: "clawmobile.skill.v2",
  source_traces: ["mock_repair_trace"],
  status: "draft_generalized",
  intent: {
    name: "mock_repair_task",
    description: "Mock repair task.",
    parameters: {},
    not_covered_parameters: {},
  },
  app: { package: "com.example", activity: "com.example.MainActivity" },
  entry_state_checks: {
    after_app_open: {
      package: "com.example",
      activity: "com.example.MainActivity",
      ui_text_any: ["Old Home"],
    },
  },
  entry_states: [{ name: "mock", confidence: 0.5 }],
  procedure: [],
  fast_path: {
    schema_version: "clawmobile.fast_path.v1",
    runner_tool: "clawmobile_skill_run_fast_path",
    execution_tool: "clawmobile_batch_execute",
    eligible: true,
    mode: "recorded_anchor_batch",
    app_state_check: {
      package: "com.example",
      activity: "com.example.MainActivity",
      ui_text_any: ["Old Home"],
    },
    steps: [
      {
        id: "step_1_assert_app_state_after_launcher",
        action: "assert_app_state",
        package: "com.example",
        activity: "com.example.MainActivity",
        ui_text_any: ["Old Home"],
      },
      {
        id: "step_2_tap_text_create",
        action: "tap_text",
        anchor: "create_button",
        texts: ["Create"],
      },
    ],
    unsupported: [],
  },
  anchors: {
    create_button: {
      type: "coordinate_anchor",
      x_norm: 0.8,
      y_norm: 0.9,
      x: 864,
      y: 2182,
      stability: "semi_static",
      confidence: 0.8,
      valid_when: "mock app is visible",
    },
  },
  applicability: {
    decision_modes: ["applicable", "applicable_with_regrounding", "not_applicable"],
    rules: [],
  },
  grounding_policy: {},
  validation_policy: {},
  verification: [],
  evolution: {
    can_update_from_future_traces: true,
    open_uncertainties: [],
    verified_contexts: [],
    failure_patterns: [],
    success_count: 0,
    failure_count: 0,
  },
  warnings: [],
};
fs.writeFileSync(path.join(repairSkillDir, "generalized_skill.json"), `${JSON.stringify(repairGeneralized, null, 2)}\n`);
fs.writeFileSync(path.join(repairSkillDir, "SKILL.md"), "---\nname: mock-repair-skill\n---\n");

const repaired = reflectFastPathFailure({
  skill_dir: repairSkillDir,
  failed_step: "step_1_assert_app_state_after_launcher",
  failed_anchor: "launcher",
  failure_summary: "Package/activity matched but entry text changed.",
  diagnosis: "The fast path reached the target app, but the entry text check was too brittle.",
  repair_goal: "Let package/activity be the hard entry gate and preserve text as evidence.",
  relax_entry_ui_text_checks: true,
  add_entry_ui_text_any: ["Search Example"],
  tap_text_repairs: [
    {
      step_id: "step_2_tap_text_create",
      texts: ["Create item"],
    },
  ],
});
assert.strictEqual(repaired.ok, true);
assert.strictEqual(repaired.repair_applied, true);
assert.ok(repaired.applied_changes.some((item) => item.includes("relaxed")));
const repairedJson = JSON.parse(fs.readFileSync(path.join(repairSkillDir, "generalized_skill.json"), "utf8"));
assert.strictEqual(repairedJson.fast_path.app_state_check.ui_text_required, false);
assert.strictEqual(repairedJson.fast_path.app_state_check.ui_text_any, undefined);
assert.ok(repairedJson.fast_path.app_state_check.ui_text_evidence.includes("Old Home"));
assert.ok(repairedJson.fast_path.app_state_check.ui_text_evidence.includes("Search Example"));
assert.strictEqual(repairedJson.fast_path.steps[0].ui_text_required, false);
assert.strictEqual(repairedJson.fast_path.steps[0].ui_text_any, undefined);
assert.ok(repairedJson.fast_path.steps[1].texts.includes("Create item"));
assert.strictEqual(repairedJson.evolution.fast_path_repair_history.length, 1);
assert.ok(fs.readFileSync(path.join(repairSkillDir, "SKILL.md"), "utf8").includes("clawmobile_skill_reflect_fast_path_failure"));

runAsyncChecks()
  .then(() => {
    console.log(`trace induction test passed: ${dir}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
