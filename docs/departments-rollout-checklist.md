# Departments rollout checklist

## Phase 1: behavior-preserving Design refactor

- [ ] Create a branch from `main`.
- [ ] Configure only Design env values:
  - `NOTION_DESIGN_DATABASE_ID` or legacy `NOTION_DATABASE_ID`
  - `NOTION_DESIGN_STATUS_PROPERTY=Design Status`
  - `DESIGN_CHANNEL_ID`
  - existing Slack app tokens
- [ ] Keep `REDIS_KEY_PREFIX` empty in production.
- [ ] Verify existing in-flight Redis records without `departmentKey` are read as `design`.
- [ ] Test `/new-task` -> existing Design task type picker -> one low-risk design task.
- [ ] Test a Notion status change and confirm the Slack thread updates.
- [ ] Test one round of feedback/sub-item creation.
- [ ] Test quality survey on `Ready`.
- [ ] Test `/notion/design-task-launch` webhook.
- [ ] Merge only after Design behavior matches production.

### Phase 1 sandbox notes

- Test deploy: `design-tasks-bot-phase1-test` on Railway, deployed from `codex/departments-design-phase1` without merging to `main`.
- Test Slack app/workspace used the same live Design Notion database with `TEST_TASK_PREFIX=[ТЕСТ]` and isolated Redis prefix.
- Verified `/new-task` opens the existing Design task type picker directly, without a department picker.
- Verified Design task creation, status polling, Slack thread -> Notion comment sync, and Notion -> Slack comment sync.
- Fixed and re-tested the mirror-loop case where a Slack-originated Notion comment could be sent back to Slack by polling.
- Sandbox designer mentions can look blank when a production Slack user ID is rendered in the test workspace; verify by checking the underlying Notion relation and Redis `lastDesignerName`.
- Delete all test tasks from Notion with `Name contains [ТЕСТ]` before merging.

## Phase 2: SMM greenfield

- [ ] Configure test Slack app/workspace tokens.
- [ ] Set `REDIS_KEY_PREFIX=test:`.
- [ ] Set `TEST_TASK_PREFIX=[ТЕСТ]`.
- [ ] Configure `NOTION_SMM_DATABASE_ID`.
- [ ] Configure `SMM_CHANNEL_ID` or `SLACK_SMM_NOTIFY_CHANNEL`.
- [ ] Invite the test bot to the SMM notification channel.
- [ ] Verify department picker shows `Design / Event / SMM`.
- [ ] For every SMM subtype, submit one `[ТЕСТ]` task against the live SMM database.
- [ ] Verify multi-select platforms are written to Notion where the schema supports it.
- [ ] Verify minLeadDays warning:
  - choose a too-close date
  - confirm the modal asks for Urgent or date change
  - submit once as Urgent
  - submit once after changing the date
- [ ] Verify notification in the SMM channel.
- [ ] Filter SMM DB by `Name contains [ТЕСТ]` and delete test tasks manually.
- [ ] Deploy only after SMM path is green in the test workspace.

## Phase 3: Event cutover by "live out"

- [ ] Provide the old Event-bot repository as read-only reference and replace the TODO Event forms with exact old forms.
- [ ] Configure `NOTION_EVENT_DATABASE_ID` or `NOTION_ACTIVITIES_DATABASE_ID`.
- [ ] Configure `EVENT_CHANNEL_ID`.
- [ ] Set `TEST_TASK_PREFIX=[ТЕСТ]` for sandbox testing.
- [ ] Create the minimum needed Event `[ТЕСТ]` tasks in the live Activities database.
- [ ] Verify `$ EB Budget`, `Event date`, and `EB Activity Type` write correctly where those properties exist.
- [ ] Delete Event `[ТЕСТ]` tasks immediately after validation.
- [ ] Announce that new Event requests move to this bot.
- [ ] Stop routing new requests into the old Event-bot.
- [ ] Keep the old Event-bot running until its existing in-flight tasks finish polling.
- [ ] Turn off the old Event-bot only after it is empty.

## Phase 4: cleanup

- [ ] Remove or hide legacy Design task types that duplicate the new SMM department.
- [ ] Rename Slack app display name to a neutral name.
- [ ] Confirm no new OAuth scopes were added.
- [ ] Confirm production `TEST_TASK_PREFIX` is empty.
- [ ] Confirm production `REDIS_KEY_PREFIX` is empty or intentionally set.
- [ ] Keep `departments` ready for future `pr` and `employer_brand` additions.
