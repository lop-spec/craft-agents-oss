import { afterEach, describe, expect, it } from 'bun:test'
import { loadWebModelRoutes, registerWebModels, resetWebModelRoutesForTests, WEB_MODELS_API } from './web-models.ts'

const model = (id: string) => ({ id, name: id, reasoning: true, input: ['text'] as Array<'text' | 'image'>, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 8_000 })

function fakeProject(calls: Array<{ provider: string; model: { id: string; provider?: string; api?: string } }>) {
  const stream = (provider: string) => (m: { id: string; provider?: string; api?: string }) => {
    calls.push({ provider, model: m })
    return { provider } as never
  }
  return async () => ({
    register: async (pi: { registerProvider: (name: string, config: unknown) => void }) => {
      pi.registerProvider('pi-site-a', { api: 'pi-site-a', baseUrl: 'http://127.0.0.1:1', streamSimple: stream('pi-site-a'), models: [model('a-1'), model('shared')] })
      pi.registerProvider('pi-site-b', { api: 'pi-site-b', streamSimple: stream('pi-site-b'), models: [model('b-1'), model('shared')] })
    },
  })
}

afterEach(() => resetWebModelRoutesForTests())

describe('web models', () => {
  it('maps every model to the provider that registered it (first one wins)', async () => {
    const routes = await loadWebModelRoutes('C:/fake/project', fakeProject([]))
    expect([...routes.keys()]).toEqual(['a-1', 'shared', 'b-1'])
    expect(routes.get('b-1')?.provider).toBe('pi-site-b')
    expect(routes.get('shared')?.provider).toBe('pi-site-a')
  })

  it('registers all of them under custom-endpoint and routes each request to its provider', async () => {
    const calls: Array<{ provider: string; model: { id: string; provider?: string; api?: string } }> = []
    const routes = await loadWebModelRoutes('C:/fake/project', fakeProject(calls))
    let registered: { name: string; config: { api?: string; models?: Array<{ id: string; api?: string }>; streamSimple?: (...args: unknown[]) => unknown } } | undefined
    registerWebModels({ registerProvider: (name: string, config: never) => { registered = { name, config } } } as never, routes)

    expect(registered?.name).toBe('custom-endpoint')
    expect(registered?.config.api).toBe(WEB_MODELS_API)
    expect(registered?.config.models?.map(m => m.id)).toEqual(['a-1', 'shared', 'b-1'])

    registered?.config.streamSimple?.({ id: 'b-1', provider: 'custom-endpoint', api: WEB_MODELS_API }, { messages: [] }, {})
    expect(calls).toEqual([{ provider: 'pi-site-b', model: { id: 'b-1', provider: 'pi-site-b', api: 'pi-site-b' } }])
    expect(() => registered?.config.streamSimple?.({ id: 'nope' }, { messages: [] }, {})).toThrow('Unknown web model')
  })

  it('retries loading after a failure instead of caching it', async () => {
    let attempts = 0
    const flaky = async () => {
      attempts++
      if (attempts === 1) throw new Error('not yet')
      return fakeProject([])()
    }
    await expect(loadWebModelRoutes('C:/fake/project', flaky)).rejects.toThrow('not yet')
    const routes = await loadWebModelRoutes('C:/fake/project', flaky)
    expect(routes.size).toBe(3)
  })
})
