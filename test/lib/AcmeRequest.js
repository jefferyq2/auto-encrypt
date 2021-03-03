import os from 'os'
import fs from 'fs-extra'
import path from 'path'
import test from 'tape'
import jose from 'jose'
import AcmeRequest from '../../lib/AcmeRequest.js'
import Configuration from '../../lib/Configuration.js'
import Directory from '../../lib/Directory.js'
import Account from '../../lib/Account.js'
import AccountIdentity from '../../lib/identities/AccountIdentity.js'
import LetsEncryptServer from '../../lib/LetsEncryptServer.js'
import { httpServerWithResponse, throwsErrorOfType, throwsErrorOfTypeAsync } from '../../lib/test-helpers/index.js'
import Pebble from '@small-tech/node-pebble'

async function setup() {

  // Run the tests using either a local Pebble server (default) or the Let’s Encrypt Staging server
  // (which is subject to rate limits) if the STAGING environment variable is set.
  // Use npm test task for the former and npm run test-staging task for the latter.
  const letsEncryptServerType = process.env.STAGING ? LetsEncryptServer.type.STAGING : LetsEncryptServer.type.PEBBLE

  if (letsEncryptServerType === LetsEncryptServer.type.PEBBLE) {
    await Pebble.ready()
  }

  const customSettingsPath = path.join(os.homedir(), '.small-tech.org', 'auto-encrypt', 'test')
  fs.removeSync(customSettingsPath)

  const configuration = new Configuration({
    domains: ['dev.ar.al'],
    server: new LetsEncryptServer(letsEncryptServerType),
    settingsPath: customSettingsPath
  })
  const accountIdentity = new AccountIdentity(configuration)
  const directory = await Directory.getInstanceAsync(configuration)

  AcmeRequest.uninitialise()

  test.onFinish(async () => {
    await Pebble.shutdown()
  })

  return { configuration, accountIdentity, directory }
}

test('AcmeRequest', async t => {
  t.plan(13)

  const { configuration, accountIdentity, directory } = await setup()

  //
  // Test instantiation attempt on uninitialised Acme Request class.
  //

  t.ok(throwsErrorOfType(
    () => new AcmeRequest(),
    Symbol.for('AcmeRequest.classNotInitialisedError')
  ), 'instantiation attempt on uninitialised class should fail')

  //
  // Test static initialisation of Acme Request class.
  //

  AcmeRequest.initialise(directory, accountIdentity)

  t.doesNotThrow(() => new AcmeRequest(), 'instantiation attempt on initialised class should succeed')

  //
  // Test request preparation.
  //

  // Request preparation with useKid = true should fail if account has not been set.

  t.ok(await throwsErrorOfTypeAsync(
    async () => {
      const { protectedHeader, signedRequest, httpsRequest, httpsHeaders } = await (new AcmeRequest()).prepare('newOrder', {aPayload: true}, /* useKid = */ true)
    },
    Symbol.for('AcmeRequest.accountNotSetError')
  ), 'ACME requests that require a Key ID will throw if static account property is not set')

  //
  // Set the account and try again. It should work this time.
  //

  const account = await Account.getInstanceAsync(configuration)
  AcmeRequest.account = account

  const { protectedHeader, signedRequest, httpsRequest, httpsHeaders } = await (new AcmeRequest()).prepare('newOrder', {aPayload: true}, /* useKid = */ true)

  const expectedHttpsHeaders = {
    'Content-Type': 'application/jose+json',
    'User-Agent': 'small-tech.org-acme/1.0.0 node/12.16.0',
    'Accept-Language': 'en-US'
  }

  t.strictEquals(JSON.stringify(httpsHeaders), JSON.stringify(expectedHttpsHeaders), 'https headers should be as expected')

  t.strictEquals(protectedHeader.kid, account.kid, 'account kid should be in protected header by default')

  //
  // Test JSON Web Signature.
  //
  const { aPayload } = jose.JWS.verify(signedRequest, accountIdentity.key)
  t.strictEquals(aPayload, true, 'Payload verifies from the JSON Web Signature')

  //
  // Test prepare method argument checking.
  //

  t.ok(await throwsErrorOfTypeAsync(
    async () => await (new AcmeRequest()).prepare(),
    Symbol.for('UndefinedOrNullError')
  ), 'prepare method called without command throws')

  t.ok(await throwsErrorOfTypeAsync(
    async () => await (new AcmeRequest()).prepare('dummyCommand'),
    Symbol.for('UndefinedOrNullError')
  ), 'prepare method called without payload throws')

  t.ok(await throwsErrorOfTypeAsync(
    async () => await (new AcmeRequest()).prepare('dummyCommand', 'dummyPayload'),
    Symbol.for('UndefinedOrNullError')
  ), 'prepare method called without useKid throws')

  //
  // Test execute method argument checking.
  //

  t.ok(await throwsErrorOfTypeAsync(
    async () => await (new AcmeRequest()).execute(),
    Symbol.for('UndefinedOrNullError')
  ), 'execute method called without command throws')

  t.ok(await throwsErrorOfTypeAsync(
    async () => await (new AcmeRequest()).execute('dummyCommand'),
    Symbol.for('UndefinedOrNullError')
  ), 'execute method called without payload throws')

  //
  // Test call failure.
  //
  const preparedRequest = await (new AcmeRequest()).prepare(
    /* command =      */ 'custom-command',
    /* payload =      */ {aPayload: true},
    /* useKid =       */ true,
    /* successCodes = */ [200],
    /* url =          */ 'http://localhost:1234'
  )

  let server
  server = await httpServerWithResponse({statusCode: 500, body: ''})

  try {
    await (new AcmeRequest())._execute(preparedRequest, /* parseResponseBodyAsJSON */ true)
    t.fail()
  } catch (error) {
    t.strictEquals(error.symbol, Symbol.for('AcmeRequest.requestError'), 'unexpected server response code should throw')
  }

  server.close()

  //
  // Test: parseBodyAsJSON = false
  //
  server = await httpServerWithResponse({statusCode: 200, body: 'not json'})

  let response
  response = await (new AcmeRequest()).execute('custom-command', {aPayload: true}, true, [200], 'http://localhost:1234', false)
  t.strictEquals(response.body, 'not json', 'body is not JSON as expected')

  server.close()

  t.end()
})
