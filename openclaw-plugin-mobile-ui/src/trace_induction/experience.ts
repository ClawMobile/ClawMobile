function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function asObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compact(value: any) {
  const result: any = {};
  for (const [key, item] of Object.entries(asObject(value))) {
    if (typeof item === "undefined" || item === null || item === "") continue;
    if (Array.isArray(item) && item.length === 0) continue;
    result[key] = item;
  }
  return result;
}

function anchorReliability(anchor: any) {
  const success = Number(anchor.execution_success_count || 0);
  const failure = Number(anchor.execution_failure_count || 0);
  if (failure >= 2 && failure >= success) return "needs_attention";
  if (success >= 3 && failure === 0) return "proven_stable";
  if (success > 0 && failure > 0) return "mixed";
  if (success > 0) return "observed_success";
  if (failure > 0) return "observed_failure";
  return "unproven";
}

function guidanceForAnchor(name: string, anchor: any) {
  const success = Number(anchor.execution_success_count || 0);
  const failure = Number(anchor.execution_failure_count || 0);
  const reliability = anchorReliability(anchor);
  const base = { anchor: name, reliability, success_count: success, failure_count: failure };
  if (reliability === "proven_stable") {
    return compact({
      ...base,
      guidance: "This anchor has repeated successful executions and no recorded failures; prefer the recorded/merged policy when the current state matches.",
    });
  }
  if (reliability === "needs_attention") {
    return compact({
      ...base,
      guidance: "This anchor has repeated recorded failures; inspect current state and consider regrounding before relying on the recorded coordinate.",
      last_failure: anchor.last_failure,
    });
  }
  if (reliability === "mixed") {
    return compact({
      ...base,
      guidance: "This anchor has both successes and failures; use normal verification and be ready to reground if the first attempt fails.",
      last_failure: anchor.last_failure,
    });
  }
  if (reliability === "observed_success") {
    return compact({
      ...base,
      guidance: "This anchor has at least one successful execution; treat it as helpful evidence, not a guarantee.",
    });
  }
  if (reliability === "observed_failure") {
    return compact({
      ...base,
      guidance: "This anchor has a recorded failure; use it as diagnostic evidence during normal skill-guided execution. If it came from a generated fast path and the repair is clearly bounded, one fast-path reflection may be useful.",
      last_failure: anchor.last_failure,
    });
  }
  return compact({
    ...base,
    guidance: "No execution feedback has proven this anchor yet; follow the original grounding policy.",
  });
}

function timestampMs(value: any) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestRepairTime(repairs: any[]) {
  return repairs.reduce((latest, item) => Math.max(latest, timestampMs(asObject(item).recorded_at)), 0);
}

function latestSuccessfulExecutionTime(history: any[]) {
  return history.reduce((latest, item) => {
    const record = asObject(item);
    if (record.outcome !== "success") return latest;
    return Math.max(latest, timestampMs(record.recorded_at));
  }, 0);
}

function latestFailurePattern(failurePatterns: any[]) {
  let latest: any = null;
  let latestSeen = 0;
  for (const pattern of failurePatterns) {
    const item = asObject(pattern);
    const seen = timestampMs(item.last_seen_at || item.first_seen_at);
    if (!latest || seen >= latestSeen) {
      latest = item;
      latestSeen = seen;
    }
  }
  return latest;
}

function fastPathSelfRepairGuidance(generalized: any, failurePatterns: any[]) {
  const fastPath = asObject(generalized.fast_path);
  const evolution = asObject(generalized.evolution);
  const repairs = asArray(evolution.fast_path_repair_history);
  const latestFailure = latestFailurePattern(failurePatterns);
  if (fastPath.eligible !== true || !latestFailure) {
    return {
      recommended: false,
      reason: fastPath.eligible === true ? "no_failure_pattern" : "fast_path_not_eligible",
    };
  }

  const failureSeenAt = timestampMs(latestFailure.last_seen_at || latestFailure.first_seen_at);
  const successAfterFailure =
    latestSuccessfulExecutionTime(asArray(evolution.execution_history)) >= failureSeenAt && failureSeenAt > 0;
  if (successAfterFailure) {
    return {
      recommended: false,
      reason: "latest_failure_followed_by_success",
      retry_tool: "clawmobile_skill_run_fast_path",
    };
  }

  const repairedAfterFailure = latestRepairTime(repairs) >= failureSeenAt && failureSeenAt > 0;
  if (repairedAfterFailure) {
    return {
      recommended: false,
      reason: "latest_failure_already_has_repair_history",
      retry_tool: "clawmobile_skill_run_fast_path",
    };
  }

  return compact({
    recommended: true,
    reason: "generated_fast_path_has_unrepaired_failure_pattern",
    tool: "clawmobile_skill_reflect_fast_path_failure",
    retry_tool: "clawmobile_skill_run_fast_path",
    retry_limit: 1,
    failed_step: latestFailure.failed_step,
    failed_anchor: latestFailure.failed_anchor,
    failure_summary: latestFailure.last_summary || latestFailure.observations,
    repair_hint: latestFailure.repair_hint,
    instruction:
      "Use the failure as diagnostic context during normal skill-guided execution. If the issue is a clearly bounded entry-state, text-query, or verifier mismatch, reflect once and retry the fast path at most once.",
  });
}

export function deriveExecutionGuidance(generalized: any) {
  const evolution = asObject(generalized.evolution);
  const anchors = asObject(generalized.anchors);
  const anchorGuidance = Object.entries(anchors)
    .map(([name, anchor]) => guidanceForAnchor(name, asObject(anchor)))
    .filter((item: any) => item.reliability !== "unproven");

  const verifiedContexts = asArray(evolution.verified_contexts);
  const failurePatterns = asArray(evolution.failure_patterns);
  const fastPathSelfRepair = fastPathSelfRepairGuidance(generalized, failurePatterns);
  const hints: string[] = [];

  if (verifiedContexts.length > 0) {
    hints.push("Prior successful contexts exist; prefer matching those app/state/anchor conditions when applicable.");
  }
  if (failurePatterns.length > 0) {
    if (fastPathSelfRepair.recommended === true) {
      hints.push("Known generated fast-path failure patterns exist; prefer normal skill-guided execution, and use one bounded fast-path reflection only when the failure is safely repairable.");
    } else {
      hints.push("Known failure patterns exist; check them before repeating a failed anchor or step.");
    }
  }
  if (anchorGuidance.some((item: any) => item.reliability === "needs_attention")) {
    hints.push("One or more anchors need attention based on repeated failures.");
  }
  if (anchorGuidance.some((item: any) => item.reliability === "proven_stable")) {
    hints.push("One or more anchors have repeated successful executions and no recorded failures.");
  }

  return {
    status_check: "Call clawmobile_skill_status when prior execution experience may affect this run or when the skill has failures/patterns.",
    use_as: "Execution experience is evidence for grounding and fallback decisions; it should not skip normal verification.",
    hints,
    fast_path_self_repair: fastPathSelfRepair,
    anchor_guidance: anchorGuidance,
    latest_verified_contexts: verifiedContexts.slice(-3),
    latest_failure_patterns: failurePatterns.slice(-3),
  };
}

export function refreshExecutionExperience(generalized: any) {
  generalized.evolution = asObject(generalized.evolution);
  const anchors = asObject(generalized.anchors);
  for (const [name, value] of Object.entries(anchors)) {
    const anchor = asObject(value);
    anchor.runtime_reliability = anchorReliability(anchor);
    generalized.anchors[name] = anchor;
  }
  generalized.evolution.execution_guidance = deriveExecutionGuidance(generalized);
  return generalized.evolution.execution_guidance;
}
