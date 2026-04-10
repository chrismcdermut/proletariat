import { expect } from 'chai'
import { buildChannelFromRecord } from '../../src/lib/gateway/channel-factory.js'
import { parseAllowlist } from '../../src/commands/gateway/connect.js'
import type { MessagingChannelRecord } from '../../src/lib/machine-db.js'

/**
 * PRLT-1255 — Factory + helpers. The factory is the only place that
 * knows how to turn a DB row into a live adapter, so it's worth
 * pinning down its error messages precisely.
 */

function record(partial: Partial<MessagingChannelRecord>): MessagingChannelRecord {
  return {
    name: 'telegram',
    type: 'telegram',
    configJson: JSON.stringify({ token: 'T', allowlist: ['1'] }),
    active: true,
    lastMessageAt: undefined,
    ...partial,
  }
}

describe('gateway channel factory (PRLT-1255)', () => {
  it('builds a TelegramChannel for a valid telegram record', () => {
    const ch = buildChannelFromRecord(record({}))
    expect(ch.name).to.equal('telegram')
  })

  it('rejects telegram records with no token', () => {
    expect(() =>
      buildChannelFromRecord(record({ configJson: JSON.stringify({ token: '', allowlist: ['1'] }) })),
    ).to.throw(/token/i)
  })

  it('rejects telegram records with a malformed allowlist', () => {
    expect(() =>
      buildChannelFromRecord(record({ configJson: JSON.stringify({ token: 'T', allowlist: 'nope' }) })),
    ).to.throw(/allowlist/i)
  })

  it('rejects telegram records with invalid JSON', () => {
    expect(() =>
      buildChannelFromRecord(record({ configJson: '{not-json' })),
    ).to.throw(/invalid config json/i)
  })

  it('rejects unknown channel types with a helpful message', () => {
    expect(() =>
      buildChannelFromRecord(record({ type: 'imagined' })),
    ).to.throw(/unknown channel type/i)
  })
})

describe('parseAllowlist (PRLT-1255)', () => {
  it('returns an empty array when no flags were passed', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined -- explicit undefined documents the no-flag case
    expect(parseAllowlist(undefined)).to.deep.equal([])
  })

  it('accepts repeated --allow flags', () => {
    expect(parseAllowlist(['111', '222', '333'])).to.deep.equal(['111', '222', '333'])
  })

  it('splits comma-separated entries', () => {
    expect(parseAllowlist(['111,222,333'])).to.deep.equal(['111', '222', '333'])
  })

  it('trims whitespace and drops empty entries', () => {
    expect(parseAllowlist(['111 ,, 222 , '])).to.deep.equal(['111', '222'])
  })

  it('handles a mix of repeated and comma-separated entries', () => {
    expect(parseAllowlist(['111,222', '333'])).to.deep.equal(['111', '222', '333'])
  })
})
