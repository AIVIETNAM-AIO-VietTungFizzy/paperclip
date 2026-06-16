# Delegation-Disposition Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when an `in_progress` issue has all children terminal and no active run, then create a `missing_disposition` recovery action instead of queueing continuation wakes.

**Architecture:** Insert a new guard early in the `reconcileStrandedAssignedIssues` loop, after the "no active execution path" check but before the successful-run-handoff and continuation tiers. Query direct children via `parentId`. If all are terminal (done/cancelled/blocked/in_review) and no active recovery action exists, upsert a `missing_disposition` recovery action with cause `delegation_disposition_gap` and skip normal processing.

**Tech Stack:** TypeScript, PostgreSQL (drizzle-orm), Paperclip shared types

---

### Task 1: Add delegation-disposition detection in recovery service

**Files:**
- Modify: `server/src/services/recovery/service.ts` (around line 2500-2520, in `reconcileStrandedAssignedIssues`)

**Logic insertion point:**

In `reconcileStrandedAssignedIssues`, after the pause-hold guard (line ~2503) and the stranded-recovery-issue escalation (line ~2518), and after the `todo` branch (line ~2588), but BEFORE the "no latest run" skip (line ~2590):

The key insertion point is right after the `todo` status branch (line 2588 `continue`), just before `// if (!latestRun && !issue.checkoutRunId && !issue.executionRunId)` on ~line 2590.

At this point, we know:
- Issue is `in_progress` (not `todo`)
- Not a stranded-recovery issue (or escalation already handled)
- No active execution path
- Not under pause-hold
- Has an invokable agent

We add:

```typescript
// --- DELEGATION DISPOSITION GAP DETECTION ---
const delegationGap = await detectDelegationDispositionGap(issue.companyId, issue.id);
if (delegationGap) {
  await recoveryActionSvc.upsertSourceScoped({
    companyId: issue.companyId,
    sourceIssueId: issue.id,
    kind: "missing_disposition",
    cause: "delegation_disposition_gap",
    fingerprint: `missing_disposition:delegation_disposition_gap:${issue.id}`,
    ownerType: "board",
    evidence: delegationGap.evidence,
    nextAction: "Resolve parent issue disposition \u2014 children are complete",
  });
  result.skipped += 1;
  continue;
}
// --- END DELEGATION DISPOSITION GAP DETECTION ---
```

And add the helper function inside the `recoveryService` closure (e.g., right before `reconcileStrandedAssignedIssues`):

```typescript
async function detectDelegationDispositionGap(companyId: string, issueId: string) {
  const TERMINAL_CHILD_STATUSES: readonly string[] = ["done", "cancelled", "blocked", "in_review"];
  
  const children = await db
    .select({ id: issues.id, status: issues.status })
    .from(issues)
    .where(and(
      eq(issues.parentId, issueId),
      eq(issues.companyId, companyId),
    ));
  
  if (children.length === 0) return null;
  
  for (const child of children) {
    if (!TERMINAL_CHILD_STATUSES.includes(child.status)) return null;
  }
  
  const existingAction = await recoveryActionSvc.getActiveForIssue(companyId, issueId);
  if (existingAction && existingAction.kind === "missing_disposition" && existingAction.cause === "delegation_disposition_gap") {
    return null;
  }
  
  return {
    evidence: {
      childCount: children.length,
      childIds: children.map(c => c.id),
      childStatuses: Object.fromEntries(children.map(c => [c.id, c.status])),
    },
  };
}
```

- [ ] **Step 1: Read the exact insertion context in `reconcileStrandedAssignedIssues`**

Read lines 2585-2620 to confirm the exact anchor for insertion.

- [ ] **Step 2: Add `detectDelegationDispositionGap` helper function**

Insert the function right before `reconcileStrandedAssignedIssues` (around line 2456). Use the `recoveryActionSvc` reference already available in the closure scope. Add imports if needed — check that `issueRecoveryActionService` is already imported (it is, line 36).

- [ ] **Step 3: Add the guard call in the `in_progress` branch**

Insert the detection + recovery action upsert + skip before line 2590. Verify indentation matches surrounding code.

- [ ] **Step 4: Add `recoveryActionSvc` to internal service reference if not already available**

Check: the recovery service receives `deps` but `recoveryActionSvc` may be accessed directly from the outer scope. Look for how other code in this file calls it. The file already imports `issueRecoveryActionService` (line 36) and likely calls it through a reference. If not, ensure it's callable.

- [ ] **Step 5: Verify TypeScript compilation**

Run: `npx tsc --noEmit --project server/tsconfig.json` (or the project's typecheck command)

Expected: No type errors.

### Task 2: Write tests

**Files:**
- Modify: `server/src/__tests__/heartbeat-process-recovery.test.ts`

- [ ] **Step 1: Find existing test patterns for `reconcileStrandedAssignedIssues`**

Grep for test cases that call `reconcileStrandedAssignedIssues` or test the `in_progress` path with child issues. Look at the test setup to understand how issues, runs, and children are created.

- [ ] **Step 2: Add test case: parent with all children done → detects delegation gap**

Create test with:
- Parent issue `in_progress`, assigned to an agent, no active run
- 3 child issues all `done`
- Assert that a `missing_disposition` recovery action is created with cause `delegation_disposition_gap`
- Assert the parent is NOT queued for continuation

- [ ] **Step 3: Add test case: parent with non-terminal child → skips delegation detection**

Same setup but one child is `todo` or `in_progress`.
- Assert no recovery action created
- Assert normal continuation path is taken

- [ ] **Step 4: Add test case: parent with no children → skips delegation detection**

Parent `in_progress` with no children.
- Assert normal continuation behavior unchanged

- [ ] **Step 5: Add test case: existing delegation gap recovery action → no duplicate**

Parent with all children done, but a `missing_disposition` recovery action already exists.
- Assert no new recovery action is created
- Assert the issue is skipped (not double-processed)

- [ ] **Step 6: Run tests**

Run: `npx vitest run server/src/__tests__/heartbeat-process-recovery.test.ts` (or equivalent)

Expected: All tests pass, including both new and existing tests.

### Task 3: Verify full build

- [ ] **Step 1: Typecheck**

Run the project's typecheck command to ensure no type errors.

- [ ] **Step 2: Full test suite for recovery**

Run all recovery-related tests.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/recovery/service.ts server/src/__tests__/heartbeat-process-recovery.test.ts
git commit -m "feat: add delegation-disposition detection to stranded-work recovery"
```