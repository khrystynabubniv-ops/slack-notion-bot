import {
  DEFAULT_DEPARTMENT_KEY,
  getAllDepartments,
  getDepartment,
  getTaskTypeComplexityOptions,
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
    title: { type: 'plain_text', text: 'Новий запит' },
    submit: { type: 'plain_text', text: 'Далі' },
    close: { type: 'plain_text', text: 'Скасувати' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Куди летить запит?',
        },
      },
      {
        type: 'input',
        block_id: 'department_block',
        label: { type: 'plain_text', text: 'Команда' },
        element: {
          type: 'static_select',
          action_id: 'department',
          placeholder: { type: 'plain_text', text: 'Обери команду...' },
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
    title: { type: 'plain_text', text: `${department.emoji || '📋'} Новий запит` },
    submit: { type: 'plain_text', text: 'Далі' },
    close: { type: 'plain_text', text: 'Скасувати' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: department.key === DEFAULT_DEPARTMENT_KEY
            ? 'Обери тип запиту — далі побачиш потрібні поля для брифу.'
            : `Обери тип запиту для ${department.label} — далі побачиш потрібні поля для брифу.`,
        },
      },
      {
        type: 'input',
        block_id: 'task_type_block',
        label: { type: 'plain_text', text: 'Тип запиту' },
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

export function buildTaskComplexityPickerView({
  departmentKey = DEFAULT_DEPARTMENT_KEY,
  taskType,
  taskTypeLabel,
}) {
  const department = getDepartment(departmentKey)
  const complexityOptions = getTaskTypeComplexityOptions(department.key, taskType)

  return {
    type: 'modal',
    callback_id: 'select_task_complexity',
    private_metadata: JSON.stringify({ departmentKey: department.key, taskType, taskTypeLabel }),
    title: { type: 'plain_text', text: '🎪 Складність' },
    submit: { type: 'plain_text', text: 'Далі' },
    close: { type: 'plain_text', text: 'Скасувати' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `Обери рівень складності для *${taskTypeLabel}*.\n` +
            complexityOptions
              .map((option) => `*${option.label}* — ${option.description}`)
              .join('\n'),
        },
      },
      {
        type: 'input',
        block_id: 'complexity_block',
        label: { type: 'plain_text', text: 'Рівень складності' },
        element: {
          type: 'static_select',
          action_id: 'complexity',
          placeholder: { type: 'plain_text', text: 'Обери рівень...' },
          options: complexityOptions.map((option) => ({
            text: { type: 'plain_text', text: option.label },
            value: option.value,
          })),
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
