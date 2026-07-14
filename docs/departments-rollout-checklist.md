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
- [ ] Configure `NOTION_ACTIVITIES_DATABASE_ID` or `NOTION_SMM_DATABASE_ID`.
- [ ] Confirm `NOTION_SMM_STATUS_PROPERTY=SMM статус`, `NOTION_SMM_INITIAL_STATUS=To do`.
- [ ] Confirm `NOTION_SMM_COMPLETED_STATUSES=Published,Canceled,Cancelled`.
- [ ] Confirm `NOTION_SMM_QUALITY_SURVEY_STATUSES=Published`.
- [ ] Confirm `NOTION_SMM_HUB_URL` opens the SMM Hub page.
- [ ] Set `NOTION_SMM_TASK_TEMPLATE_ID` / `NOTION_SMM_TEMPLATE_ID` after the SMM task template id is known.
- [ ] Confirm SMM writes to Activities with `Team=SMM`.
- [ ] Keep `SMM_CHANNEL_ID` / `SLACK_SMM_NOTIFY_CHANNEL` empty unless a separate SMM channel notification is explicitly needed.
- [ ] Verify department picker shows `Design / SMM`.
- [ ] For every SMM subtype, submit one `[ТЕСТ]` task against the live Activities database.
- [ ] For Reels, verify hero availability is captured with date + `from` time + `to` time.
- [ ] Verify task links from Slack open the created task inside SMM Hub, not Brand Design Hub.
- [ ] Verify the Notion `Description` property says only that the brief is below, and the readable brief appears in the page body under base/specific sections.
- [ ] Verify multi-select platforms are preserved in the brief and written to `Platforms` if the schema has it; otherwise first selected platform goes to `Platform`.
- [ ] Verify minLeadDays warning:
  - choose a too-close date
  - confirm the modal mentions the deadline policy and offers `late` or date change
  - submit once as late
  - verify Notion checkbox `Late` is checked and no late note is added to `Description`
  - submit once after changing the date
- [ ] Verify requester receives DM-thread confirmation and SMM status polling uses `SMM статус`.
- [ ] Verify status casing changes like `To do` -> `to do` do not produce a Slack status notification.
- [ ] Verify SMM `Ready` updates the thread but does not show Design revision/acceptance buttons and does not stop polling.
- [ ] Verify SMM `Published` sends the quality survey and writes submitted feedback to database `025dce2c634e4a079ee7600ea8c63253`.
- [ ] Verify SMM `Canceled` stops polling without sending a quality survey.
- [ ] Filter Activities by `Name contains [ТЕСТ]` and `Team=SMM`; delete test tasks manually.
- [ ] Deploy only after SMM path is green in the test workspace.

## Phase 3: Event cutover by "live out"

- [ ] Provide the old Event-bot repository as read-only reference and replace the TODO Event forms with exact old forms.
- [ ] Enable sandbox route with `EVENT_DEPARTMENT_ENABLED=true`.
- [ ] Configure `NOTION_EVENT_DATABASE_ID` or `NOTION_ACTIVITIES_DATABASE_ID`.
- [ ] Configure `EVENT_CHANNEL_ID`.
- [ ] Set `TEST_TASK_PREFIX=[ТЕСТ]` for sandbox testing.
- [ ] Verify Event appears in the test Slack picker only after the sandbox flag or `NOTION_EVENT_DATABASE_ID` is set.
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
- [ ] Confirm `users:read.email` is approved and the Slack app is reinstalled after the scope change.
- [ ] Confirm production `TEST_TASK_PREFIX` is empty.
- [ ] Confirm production `REDIS_KEY_PREFIX` is empty or intentionally set.
- [ ] Keep `departments` ready for future `pr` and `employer_brand` additions.
