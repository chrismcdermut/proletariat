import { expect } from 'chai'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildAgentSwitchboardConfig,
  initAgentSwitchboard,
  teardownAgentSwitchboard,
} from '../../../src/lib/switchboard/agent/hooks.js'
import {
  buildHostMcpConfig,
  buildContainerMcpConfig,
  getSwitchboardVolumeMounts,
  getSwitchboardEnvVars,
} from '../../../src/lib/switchboard/agent/startup.js'
import * as fs from 'node:fs'

describe('Switchboard Agent Integration', () => {
  // ===========================================================================
  // buildAgentSwitchboardConfig()
  // ===========================================================================

  describe('buildAgentSwitchboardConfig()', () => {
    it('builds config for a host agent', () => {
      const config = buildAgentSwitchboardConfig({
        executionId: 'MRUN-12345678',
        agentName: 'bold-fox',
      })

      expect(config.address.kind).to.equal('agent')
      expect(config.address.id).to.equal('MRUN-12345678')
      expect(config.address.containerId).to.be.undefined
      expect(config.autoSubscribe).to.be.an('array')
      expect(config.autoSubscribe).to.include('agent:spawned')
    })

    it('builds config for a container agent', () => {
      const config = buildAgentSwitchboardConfig({
        executionId: 'MRUN-ABCD1234',
        agentName: 'calm-ray',
        containerId: 'container-abc123',
        dbPath: '/root/.proletariat/switchboard.db',
        socketPath: '/root/.proletariat/switchboard.sock',
      })

      expect(config.address.containerId).to.equal('container-abc123')
      expect(config.dbPath).to.equal('/root/.proletariat/switchboard.db')
      expect(config.socketPath).to.equal('/root/.proletariat/switchboard.sock')
    })
  })

  // ===========================================================================
  // initAgentSwitchboard() / teardownAgentSwitchboard()
  // ===========================================================================

  describe('initAgentSwitchboard() and teardownAgentSwitchboard()', () => {
    it('initializes and tears down a switchboard client', () => {
      const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prlt-agent-sb-test-')))
      const dbPath = path.join(tmpDir, 'switchboard.db')
      const socketPath = path.join(tmpDir, 'switchboard.sock')

      const config = buildAgentSwitchboardConfig({
        executionId: 'MRUN-TEST',
        agentName: 'test-agent',
      })
      config.dbPath = dbPath
      config.socketPath = socketPath

      const client = initAgentSwitchboard(config)
      expect(client.address.kind).to.equal('agent')
      expect(client.address.id).to.equal('MRUN-TEST')

      // Verify auto-subscriptions were created
      const subs = client.listSubscriptions()
      expect(subs.length).to.be.greaterThan(0)

      teardownAgentSwitchboard(client)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
  })

  // ===========================================================================
  // buildHostMcpConfig()
  // ===========================================================================

  describe('buildHostMcpConfig()', () => {
    it('builds config with host paths', () => {
      const config = buildHostMcpConfig('MRUN-12345678')

      expect(config.dbPath).to.include('.proletariat')
      expect(config.dbPath).to.include('switchboard.db')
      expect(config.socketPath).to.include('switchboard.sock')
      expect(config.addressKind).to.equal('agent')
      expect(config.addressId).to.equal('MRUN-12345678')
      expect(config.containerId).to.be.undefined
    })
  })

  // ===========================================================================
  // buildContainerMcpConfig()
  // ===========================================================================

  describe('buildContainerMcpConfig()', () => {
    it('builds config with container-internal paths', () => {
      const config = buildContainerMcpConfig('MRUN-ABCD', 'container-xyz')

      expect(config.dbPath).to.equal('/root/.proletariat/switchboard.db')
      expect(config.socketPath).to.equal('/root/.proletariat/switchboard.sock')
      expect(config.addressKind).to.equal('agent')
      expect(config.addressId).to.equal('MRUN-ABCD')
      expect(config.containerId).to.equal('container-xyz')
    })
  })

  // ===========================================================================
  // getSwitchboardVolumeMounts()
  // ===========================================================================

  describe('getSwitchboardVolumeMounts()', () => {
    it('returns volume mount strings for Docker', () => {
      const mounts = getSwitchboardVolumeMounts()

      expect(mounts).to.be.an('array')
      expect(mounts).to.have.lengthOf(4) // db, wal, shm, sock
      expect(mounts[0]).to.include('switchboard.db')
      expect(mounts[1]).to.include('switchboard.db-wal')
      expect(mounts[2]).to.include('switchboard.db-shm')
      expect(mounts[3]).to.include('switchboard.sock')

      // Each mount should have host:container format
      for (const mount of mounts) {
        expect(mount).to.include(':')
        expect(mount).to.include('/root/.proletariat/')
      }
    })
  })

  // ===========================================================================
  // getSwitchboardEnvVars()
  // ===========================================================================

  describe('getSwitchboardEnvVars()', () => {
    it('returns env vars without containerId', () => {
      const config = buildHostMcpConfig('MRUN-TEST')
      const vars = getSwitchboardEnvVars(config)

      expect(vars.SWITCHBOARD_DB_PATH).to.exist
      expect(vars.SWITCHBOARD_SOCKET_PATH).to.exist
      expect(vars.SWITCHBOARD_ADDRESS_KIND).to.equal('agent')
      expect(vars.SWITCHBOARD_ADDRESS_ID).to.equal('MRUN-TEST')
      expect(vars.SWITCHBOARD_CONTAINER_ID).to.be.undefined
    })

    it('includes containerId when present', () => {
      const config = buildContainerMcpConfig('MRUN-TEST', 'ctr-123')
      const vars = getSwitchboardEnvVars(config)

      expect(vars.SWITCHBOARD_CONTAINER_ID).to.equal('ctr-123')
    })
  })
})
