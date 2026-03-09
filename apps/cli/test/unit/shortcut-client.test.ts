import { expect } from 'chai'
import { ShortcutClient, ShortcutNotFoundError } from '../../src/lib/shortcut/client.js'

// Simple mock HTTP server approach: override global fetch
function createMockFetch(handlers: Record<string, { status: number; body: unknown }>) {
  return async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    for (const [pattern, response] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    return new Response('{}', { status: 404 })
  }
}

describe('ShortcutClient', () => {
  let originalFetch: typeof globalThis.fetch

  before(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('getStory', () => {
    it('returns story when found', async () => {
      const mockStory = { id: 123, name: 'Test Story', app_url: 'https://app.shortcut.com/test/story/123' }
      globalThis.fetch = createMockFetch({
        '/stories/123': { status: 200, body: mockStory },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      const story = await client.getStory(123)
      expect(story).to.not.equal(null)
      expect(story!.id).to.equal(123)
      expect(story!.name).to.equal('Test Story')
    })

    it('returns null when story not found', async () => {
      globalThis.fetch = createMockFetch({
        '/stories/999': { status: 404, body: {} },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      const story = await client.getStory(999)
      expect(story).to.equal(null)
    })

    it('throws on auth failure', async () => {
      globalThis.fetch = createMockFetch({
        '/stories/123': { status: 401, body: {} },
      }) as typeof fetch

      const client = new ShortcutClient('bad-token')
      try {
        await client.getStory(123)
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as Error).message).to.include('authentication failed')
      }
    })

    it('throws on rate limit', async () => {
      globalThis.fetch = createMockFetch({
        '/stories/123': { status: 429, body: {} },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      try {
        await client.getStory(123)
        expect.fail('expected to throw')
      } catch (error) {
        expect((error as Error).message).to.include('rate limit')
      }
    })
  })

  describe('updateStory', () => {
    it('updates a story', async () => {
      const updatedStory = { id: 123, name: 'Updated Story', app_url: 'https://app.shortcut.com/test/story/123' }
      globalThis.fetch = createMockFetch({
        '/stories/123': { status: 200, body: updatedStory },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      const story = await client.updateStory(123, { name: 'Updated Story' })
      expect(story.name).to.equal('Updated Story')
    })
  })

  describe('listWorkflowStates', () => {
    it('returns flattened workflow states', async () => {
      const workflows = [
        {
          states: [
            { id: 1, name: 'Backlog', type: 'unstarted' },
            { id: 2, name: 'In Progress', type: 'started' },
          ],
        },
        {
          states: [
            { id: 3, name: 'Done', type: 'done' },
          ],
        },
      ]
      globalThis.fetch = createMockFetch({
        '/workflows': { status: 200, body: workflows },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      const states = await client.listWorkflowStates()
      expect(states).to.have.length(3)
      expect(states[0].name).to.equal('Backlog')
      expect(states[2].name).to.equal('Done')
    })
  })

  describe('searchStories', () => {
    it('returns search results', async () => {
      const searchResponse = {
        data: [
          { id: 1, name: 'Story 1', app_url: 'https://app.shortcut.com/test/story/1' },
          { id: 2, name: 'Story 2', app_url: 'https://app.shortcut.com/test/story/2' },
        ],
      }
      globalThis.fetch = createMockFetch({
        '/search/stories': { status: 200, body: searchResponse },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      const stories = await client.searchStories('is:story')
      expect(stories).to.have.length(2)
    })

    it('returns empty array when no data', async () => {
      globalThis.fetch = createMockFetch({
        '/search/stories': { status: 200, body: {} },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      const stories = await client.searchStories('is:story')
      expect(stories).to.have.length(0)
    })
  })

  describe('verify', () => {
    it('returns member info', async () => {
      const memberInfo = {
        profile: {
          name: 'Test User',
          email_address: 'test@example.com',
          mention_name: 'testuser',
        },
      }
      globalThis.fetch = createMockFetch({
        '/member': { status: 200, body: memberInfo },
      }) as typeof fetch

      const client = new ShortcutClient('test-token')
      const info = await client.verify()
      expect(info.name).to.equal('Test User')
      expect(info.email).to.equal('test@example.com')
      expect(info.mentionName).to.equal('testuser')
    })
  })
})
