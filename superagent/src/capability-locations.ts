import { CoreError } from './model.js'
import type { LocalPermission } from './local-environment.js'

export type CapabilityId = 'browser' | 'mcp' | 'office'
export type CapabilityLocation = 'host' | 'environment'
export type CapabilityRole = 'router' | 'worker'
export type CapabilitySupport = 'available' | 'conditional' | 'unavailable'
export type CapabilityCredentialScope = 'host' | 'environment' | 'none'
export type CapabilityPrivacyScope = 'host' | 'environment'

export interface HostCapabilities {
  browser?: boolean
  mcp?: boolean
}

export interface CapabilityLocalDeclaration {
  support: CapabilitySupport
  requirements: string[]
  permissions: LocalPermission[]
  credentials: CapabilityCredentialScope
  privacy: CapabilityPrivacyScope
}

export interface CapabilityRemoteDeclaration {
  support: 'unavailable'
  gaps: string[]
}

/** A product capability's declared execution world and the conditions that keep it there. */
export interface CapabilityLocationView {
  id: CapabilityId
  label: string
  location: CapabilityLocation
  roles: CapabilityRole[]
  local: CapabilityLocalDeclaration
  remote: CapabilityRemoteDeclaration
}

export interface CapabilityResolutionView {
  id: CapabilityId
  label: string
  location: CapabilityLocation
  status: 'available' | 'blocked'
  environmentId?: string
  reasons: string[]
  requirements: string[]
  credentials: CapabilityCredentialScope
  privacy: CapabilityPrivacyScope
  gaps: string[]
}

export interface CapabilityPlanView {
  required: CapabilityId[]
  status: 'none' | 'pending' | 'available' | 'blocked'
  items: CapabilityResolutionView[]
}

export const capabilityIds: readonly CapabilityId[] = ['browser', 'mcp', 'office']

export function validateRequiredCapabilities(value: unknown): CapabilityId[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > capabilityIds.length || value.some(id => !capabilityIds.includes(id))
    || new Set(value).size !== value.length) {
    throw new CoreError('INVALID_INPUT', 'Required capabilities are browser, mcp and office, at most once each.')
  }
  return [...value] as CapabilityId[]
}

export function validateHostCapabilities(value: HostCapabilities | undefined): HostCapabilities {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'browser' && key !== 'mcp')
    || Object.values(value).some(enabled => enabled !== undefined && typeof enabled !== 'boolean')) {
    throw new CoreError('INVALID_CONFIG', 'Host capabilities accept browser and mcp booleans only.')
  }
  return { ...(value.browser === true ? { browser: true } : {}), ...(value.mcp === true ? { mcp: true } : {}) }
}

export function capabilityLocations(host: HostCapabilities = {}): CapabilityLocationView[] {
  return [
    {
      id: 'browser', label: 'Browser', location: 'host', roles: ['worker'],
      local: { support: host.browser === true ? 'available' : 'unavailable',
        requirements: ['Host desktop browser bridge'], permissions: [], credentials: 'host', privacy: 'host' },
      remote: { support: 'unavailable', gaps: ['remote-browser-contract-unverified'] },
    },
    {
      id: 'mcp', label: 'MCP', location: 'host', roles: ['worker'],
      local: { support: host.mcp === true ? 'available' : 'unavailable',
        requirements: ['Host MCP client configuration'], permissions: [], credentials: 'host', privacy: 'host' },
      remote: { support: 'unavailable', gaps: ['remote-mcp-contract-unverified'] },
    },
    {
      id: 'office', label: 'Office', location: 'environment', roles: ['worker'],
      local: { support: 'conditional',
        requirements: ['skills provider', 'configured office command', 'command permission'],
        permissions: ['read', 'command'], credentials: 'environment', privacy: 'environment' },
      remote: { support: 'unavailable', gaps: ['remote-office-contract-unverified'] },
    },
  ]
}
