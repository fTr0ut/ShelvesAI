import { describe, it, expect } from '@jest/globals'
import {
  buildDebugUrl,
  stringifyDocument,
  validateTargetInput,
} from '../projectSettingsHelpers'

describe('projectSettingsHelpers', () => {
  it('builds debug URLs using the configured origin', () => {
    const origin = () => 'https://collector.example.com'
    expect(buildDebugUrl('', origin)).toBe('https://collector.example.com/__debug')
    expect(buildDebugUrl('https://api.local/', origin)).toBe('https://api.local/__debug')
  })

  it('stringifies endpoint documents safely', () => {
    const document = { endpoints: [{ method: 'GET', path: '/items' }] }
    const json = stringifyDocument(document)
    expect(json).toContain('"path": "/items"')
    expect(stringifyDocument(null)).toBe('')
  })

  it('validates publish target inputs', () => {
    expect(validateTargetInput('')).toBe('')
    expect(validateTargetInput('https://app.example.com')).toBe('')
    expect(validateTargetInput('./dist/output')).toBe('')
    expect(validateTargetInput('ftp://example.com')).toMatch(/Only HTTP/)
    expect(validateTargetInput('bad target')).toMatch(/cannot contain spaces/)
  })
})
