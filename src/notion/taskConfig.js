import {
  DEFAULT_DESIGN_OWNER_ID,
  DEFAULT_DESIGN_TEAM,
  DEFAULT_STATUS,
  LEGACY_STATUS_PROPERTY,
  getDepartment,
  getTaskTypeRelationId as getConfiguredTaskTypeRelationId,
} from '../config/departments.js'

export const DEFAULT_TEAM = DEFAULT_DESIGN_TEAM
export const DEFAULT_OWNER_ID = DEFAULT_DESIGN_OWNER_ID
export { DEFAULT_STATUS, LEGACY_STATUS_PROPERTY }
export const DEFAULT_STATUS_PROPERTY = 'Design Status'

const PLATFORM_MAP = {
  Meta: 'Meta',
}

export function getTaskTypeRelationId(taskType, departmentKey = 'design') {
  return getConfiguredTaskTypeRelationId(departmentKey, taskType)
}

export function resolvePlatform(platform) {
  if (!platform || platform === 'Other') return null
  return PLATFORM_MAP[platform] || platform
}

export function getStatusPropertyNames(departmentKey = 'design') {
  const department = getDepartment(departmentKey)
  const configuredStatusProperty = department.statusProperty || process.env.NOTION_STATUS_PROPERTY?.trim()
  const fallbackStatusPropertyNames = department.key === 'design'
    ? [DEFAULT_STATUS_PROPERTY, LEGACY_STATUS_PROPERTY]
    : [LEGACY_STATUS_PROPERTY, DEFAULT_STATUS_PROPERTY]
  const preferredStatusPropertyNames = [
    configuredStatusProperty,
    ...fallbackStatusPropertyNames,
  ]

  return preferredStatusPropertyNames.filter((propertyName, index, propertyNames) => {
    return propertyName && propertyNames.indexOf(propertyName) === index
  })
}

export function resolveStatusPropertyName(databaseProperties = {}, departmentKey = 'design') {
  const department = getDepartment(departmentKey)

  return getStatusPropertyNames(department.key).find((propertyName) => {
    return ['status', 'select'].includes(databaseProperties[propertyName]?.type)
  }) || department.statusProperty || DEFAULT_STATUS_PROPERTY
}
