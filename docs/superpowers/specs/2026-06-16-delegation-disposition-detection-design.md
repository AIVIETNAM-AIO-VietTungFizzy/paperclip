# Delegation-Disposition Detection in Control-Plane Recovery Service

## Problem

When a parent issue delegates work to child issues (via `parentId`), the current `reconcileStrandedAssignedIssues` pass does not inspect the child-issue tree. If all children reach terminal status (done, cancelled, blocked, in_review) but the parent remains `in_progress` with no active run, the recovery service treats the parent as a stranded continuation candidate — repeatedly queueing recovery wakes that achieve nothing because the real work was in the children.

This creates unnecessary wake traffic and delays the human/manager intervention that is actually needed to close out the parent.

## Design

### Detection location

Insert a new guard in `reconcileStrandedAssignedIssues` at the point where we know:

1. The issue is `in_progress` (not a stranded-recovery issue itself)
2. No active execution path exists
3. Not under pause-hold
4. The "no latest run and no checkout" skip (line 2590-2593) did NOT apply (i.e., the issue was previously worked)

At this point, **before** the successful-run-handoff and continuation logic, query direct children.

### Detection rule

An issue has a **delegation-disposition gap** when:

- `status === "in_progress"`
- At least one direct child exists (`parentId = issue.id`)
- ALL direct children have terminal statuses: `done`, `cancelled`, `blocked`, or `in_review`
- No active execution path exists on the parent
- No active recovery action already exists for `missing_disposition` + `delegation_disposition_gap` on this issue

### Action taken

When detected, create (upsert) an `issue_recovery_actions` row with:

| Field | Value |
|-------|-------|
| `kind` | `missing_disposition` |
| `cause` | `delegation_disposition_gap` |
| `fingerprint` | `missing_disposition:delegation_disposition_gap:{sourceIssueId}` |
| `evidence` | `{ childCount, childIds, childStatuses }` |
| `nextAction` | `"Resolve parent issue disposition — children are complete"` |
| `ownerType` | `"board"` (the board/manager must decide) |

Then **skip** the normal continuation logic for this issue.

### What NOT to do

- Do NOT create a child recovery issue (no `ensureStrandedIssueRecoveryIssue` call)
- Do NOT change the parent issue's status
- Do NOT create a wake for the parent's agent
- Do NOT attempt to aggregate child results into the parent

### Relationship to successful-run-handoff

The existing `missing_disposition` path (handled in `successful-run-handoff.ts`) covers the case where a single run produces terminal output but no disposition. The new delegation-disposition detection covers the orthogonal case where the issue was never directly worked because work was delegated to children. Both create `missing_disposition` recovery actions but with different `cause` values.

## Files touched

1. **`server/src/services/recovery/service.ts`** — add `hasDelegationDispositionGap()` check inside `reconcileStrandedAssignedIssues()`, between the "no latest run" skip and the successful-run-handoff check
2. **`packages/shared/src/constants.ts`** — no changes needed (missing_disposition already exists)
3. **Tests** — add test coverage in the relevant test file for the new guard

## Acceptance criteria

1. Given a parent issue `in_progress` with 3 children all `done` and no active run → creates `missing_disposition` recovery action with cause `delegation_disposition_gap`, skips continuation
2. Given a parent issue `in_progress` with 1 child `todo` (not all terminal) → does NOT detect gap, proceeds to normal continuation logic
3. Given a parent issue `in_progress` with no children → does NOT detect gap
4. Given a parent issue `in_progress` with all children terminal but an active run → does NOT detect gap (hasActiveExecutionPath already skips earlier)
5. Given a parent issue that already has an active `missing_disposition` recovery action → does NOT create duplicate