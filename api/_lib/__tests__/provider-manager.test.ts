import { describe, expect, it } from 'vitest'
import { circuitTransition, isRetryableProviderError, providerHealthStatus, retryDelay, selectProviderCandidates } from '../provider-manager.js'
import { ProviderRequestError } from '../providers/types.js'

describe('provider manager policies', () => {
  it('opens the circuit after repeated failures and closes it after recovery', () => {
    let state: { circuit_state: 'closed' | 'open' | 'half_open'; circuit_failures: number } = { circuit_state: 'closed', circuit_failures: 0 }
    for (let index = 0; index < 2; index += 1) {
      const next = circuitTransition(state, false)
      state = { circuit_state: next.state, circuit_failures: next.failures }
    }
    expect(circuitTransition(state, false).state).toBe('open')
    expect(circuitTransition({ circuit_state: 'half_open', circuit_failures: 3 }, true)).toMatchObject({ state: 'closed', failures: 0 })
  })

  it('allows a cooled down open circuit to become a candidate', () => {
    const providers = [{ id: 'a', model: 'x', models: ['x'], priority: 20, health_status: 'healthy' as const, circuit_state: 'open' as const, circuit_next_retry_at: new Date(Date.now() - 1).toISOString(), is_enabled: true }]
    expect(selectProviderCandidates(providers, 'x')).toHaveLength(1)
  })

  it('sorts healthy failover candidates by priority and model support', () => {
    const providers = [
      { id: 'slow', model: 'x', models: ['x'], priority: 50, health_status: 'degraded' as const, circuit_state: 'closed' as const, circuit_next_retry_at: null, is_enabled: true },
      { id: 'fast', model: 'x', models: ['x'], priority: 10, health_status: 'healthy' as const, circuit_state: 'closed' as const, circuit_next_retry_at: null, is_enabled: true },
      { id: 'other', model: 'y', models: ['y'], priority: 0, health_status: 'healthy' as const, circuit_state: 'closed' as const, circuit_next_retry_at: null, is_enabled: true },
    ]
    expect(selectProviderCandidates(providers, 'x').map((provider) => provider.id)).toEqual(['fast', 'slow'])
  })

  it('retries only transient upstream failures', () => {
    expect(isRetryableProviderError(new ProviderRequestError({ status: 503, message: 'unavailable' }))).toBe(true)
    expect(isRetryableProviderError(new ProviderRequestError({ status: 401, message: 'bad key' }))).toBe(false)
    expect(retryDelay(1)).toBeGreaterThan(0)
  })

  it('maps latency and failure category to actionable health state', () => {
    expect(providerHealthStatus({ success: true, latencyMs: 100 })).toBe('healthy')
    expect(providerHealthStatus({ success: true, latencyMs: 12_000 })).toBe('degraded')
    expect(providerHealthStatus({ success: false, latencyMs: 100, category: 'authentication' })).toBe('degraded')
    expect(providerHealthStatus({ success: false, latencyMs: 100, category: 'network' })).toBe('offline')
  })
})
