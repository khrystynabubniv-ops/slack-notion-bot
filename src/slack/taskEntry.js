import {
  DEFAULT_DEPARTMENT_KEY,
  getAllDepartments,
  getDepartment,
  getTaskTypeGroups,
} from '../config/departments.js'

export function shouldShowDepartmentPicker() {
  return getAllDepartments().length > 1
}

export function buildDepartmentPickerView() {
  const departments = getAllDepartments()

  return {
    type: 'modal',
    callback_id: 'select_department',
    private_metadata: JSON.stringify({}),
    title: { type: 'plain_text', text: 'Нова задача' },
    submit: { type: 'plain_text', text: 'Далі' },
    close: { type: 'plain_text', text: 'Скасувати' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'В який відділ запит?',
        },
      },
      {
        type: 'input',
        block_id: 'department_block',
        label: { type: 'plain_text', text: 'Відділ' },
        element: {
          type: 'static_select',
          action_id: 'department',
          placeholder: { type: 'plain_text', text: 'Обери відділ...' },
          options: departments.map((department) => ({
            text: {
              type: 'plain_text',
              text: `${department.emoji || ''} ${department.label}`.trim(),
            },
            value: department.key,
          })),
        },
      },
    ],
  }
}

export function buildTaskTypePickerView(departmentKey = DEFAULT_DEPARTMENT_KEY) {
  const department = getDepartment(departmentKey)

  return {
    type: 'modal',
    callback_id: 'select_task_type',
    private_metadata: JSON.stringify({ departmentKey: department.key }),
    title: { type: 'plain_text', text: `${department.emoji || '📋'} Нова задача` },
    submit: { type: 'plain_text', text: 'Далі' },
    close: { type: 'plain_text', text: 'Скасувати' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: department.key === DEFAULT_DEPARTMENT_KEY
            ? 'Обери тип задачі — далі побачиш потрібні поля для брифу.'
            : `Обери тип задачі для ${department.label} — далі побачиш потрібні поля для брифу.`,
        },
      },
      {
        type: 'input',
        block_id: 'task_type_block',
        label: { type: 'plain_text', text: 'Тип задачі' },
        element: {
          type: 'static_select',
          action_id: 'task_type',
          placeholder: { type: 'plain_text', text: 'Вибери тип...' },
          option_groups: getTaskTypeGroups(department.key),
        },
      },
    ],
  }
}

export function buildInitialTaskEntryView() {
  return shouldShowDepartmentPicker()
    ? buildDepartmentPickerView()
    : buildTaskTypePickerView(DEFAULT_DEPARTMENT_KEY)
}
