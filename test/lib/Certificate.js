const os                         = require('os')
const fs                         = require('fs-extra')
const path                       = require('path')
const util                       = require('util')
const tls                        = require('tls')
const moment                     = require('moment')
const test                       = require('tape')
const Certificate                = require('../../lib/Certificate')
const Configuration              = require('../../lib/Configuration')
const LetsEncryptServer          = require('../../lib/LetsEncryptServer')
const { dehydrate, timeItAsync } = require('../../lib/test-helpers')

function setup() {
  // Run the tests using either a local Pebble server (default) or the Let’s Encrypt Staging server
  // (which is subject to rate limits) if the STAGING environment variable is set.
  // Use npm test task for the former and npm run test-staging task for the latter.
  const letsEncryptServerType = process.env.STAGING ? LetsEncryptServer.type.STAGING : LetsEncryptServer.type.PEBBLE

  const domains = {
    [LetsEncryptServer.type.PEBBLE]: ['localhost', 'pebble'],
    [LetsEncryptServer.type.STAGING]: [os.hostname(), `www.${os.hostname()}`]
  }

  const customSettingsPath = path.join(os.homedir(), '.small-tech.org', 'auto-encrypt', 'test')
  fs.removeSync(customSettingsPath)
  return new Configuration({
    domains: domains[letsEncryptServerType],
    server: new LetsEncryptServer(letsEncryptServerType),
    settingsPath: customSettingsPath
  })
}

test('Certificate', async t => {
  const configuration = setup()
  //
  // Test initial certificate creation.
  //

  const certificate = new Certificate(configuration)
  t.pass('initial certificate instantiation succeeds')

  const actualInitialCertificateState = dehydrate(util.inspect(certificate))
  const expectedInitialCertificateState = dehydrate(`#Certificate Certificate not provisioned.`)
  t.strictEquals(actualInitialCertificateState, expectedInitialCertificateState, 'initial certificate state is as expected')

  //
  // Test initial call to getSecureContext(). This should provision the certificate and return the secure context.
  //

  const { returnValue: secureContext, duration: duration1 } = await timeItAsync(() => certificate.getSecureContext())

  t.ok(secureContext instanceof tls.SecureContext, 'secure context is returned as expected')

  const { duration: duration2 } = await timeItAsync(() => certificate.getSecureContext())

  // The second call should return immediately (~0ms) but, to be safe, we are allowing it to take up to 10s of ms.
  t.ok(duration2 < 100, `second call returns in < 100ms (actual = ${duration2}ms)`)
  t.ok(duration1 > (duration2 * 100), 'second call returns orders of magnitude faster than the first as expected')

  const actualCertificateState = dehydrate(util.inspect(certificate))
  t.notStrictEquals(actualCertificateState, expectedInitialCertificateState, 'certificate state changes after secure context is created as expected')

  certificate.stopCheckingForRenewal()

  const certificate2 = new Certificate(configuration)
  const actualCertificate2State = dehydrate(util.inspect(certificate2))

  t.pass('subsequent certificate instantiation succeeds')
  t.notStrictEquals(actualCertificate2State, expectedInitialCertificateState, 'certificate loaded from cache as expected on subsequent access')
  t.strictEquals(certificate.serialNumber, certificate2.serialNumber, 'same certificate is returned during initial and subsequent access')

  // Stop automatic checks.
  certificate2.stopCheckingForRenewal()

  // Check manually for renewal (should not be renewed).
  await certificate2.checkForRenewal()

  t.strictEquals(certificate.serialNumber, certificate2.serialNumber, 'certificate renewal check returns as expected when certicicate does not need renewal')

  // Change the renewal date on the certificate manually to yesterday.
  certificate2.__changeRenewalDate(moment(new Date()).subtract(1, 'day'))

  // Check manually for renewal again (should be renewed).
  await certificate2.checkForRenewal()
  t.notStrictEquals(certificate.serialNumber, certificate2.serialNumber, 'certificate is renewed correctly when necessary')

  //
  // Test failed certificate update recovery.
  //

  const oldCertificateIdentityPath = `${configuration.certificateIdentityPath}.old`
  const oldCertificatePath = `${configuration.certificatePath}.old`
  const certificateIdentityPath = configuration.certificateIdentityPath
  const certificatePath = configuration.certificatePath

  const originalCertificate = fs.readFileSync(certificatePath, 'utf-8')
  const originalCertificateIdentity = fs.readFileSync(certificateIdentityPath, 'utf-8')

  //
  // Ensure we have the environment we expect from previous runs.
  //
  t.ok(fs.existsSync(certificatePath), 'certificate exists where we expect it')
  t.ok(fs.existsSync(certificateIdentityPath), 'certificate identity exists where we expect it')
  t.notOk(fs.existsSync(oldCertificatePath), 'old certificate does not exist as expected')
  t.notOk(fs.existsSync(oldCertificateIdentityPath), 'old certificate identity does not exist as expected')

  //
  // Case 1 (edge case): Both old and new certificate files are present. We expect the old ones
  // =================== to be removed and only the new ones to remain.
  //

  fs.writeFileSync(oldCertificatePath, 'dummy old certificate', 'utf-8')
  fs.writeFileSync(oldCertificateIdentityPath, 'dummy old certificate identity', 'utf-8')

  certificate2.attemptToRecoverFromFailedRenewalAttemptIfNecessary()

  t.ok(fs.existsSync(certificateIdentityPath), 'active certificate identity found after failed renewal recovery')
  t.ok(fs.existsSync(certificatePath), 'active certificate identity found after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificateIdentityPath), 'old certificate identity removed after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificatePath), 'old certificate removed after failed renewal attempt recovery')

  //
  // Case 2-a: Neither certificate nor certificate exist. Old certificates exist. We expect the old ones to be
  // restored and used instead.
  //

  fs.moveSync(certificateIdentityPath, oldCertificateIdentityPath)
  fs.moveSync(certificatePath, oldCertificatePath)
  fs.removeSync(certificatePath)
  fs.removeSync(certificateIdentityPath)

  certificate2.attemptToRecoverFromFailedRenewalAttemptIfNecessary()

  t.ok(fs.existsSync(certificateIdentityPath), 'active certificate identity found after failed renewal recovery')
  t.ok(fs.existsSync(certificatePath), 'active certificate identity found after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificateIdentityPath), 'old certificate identity removed after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificatePath), 'old certificate removed after failed renewal attempt recovery')

  //
  // Case 2-b: Certificate exists but certificate identity doesn’t. Old certificates exist. We expect the old ones
  // to be restored and used.
  //

  fs.copySync(certificatePath, oldCertificatePath)
  fs.moveSync(certificateIdentityPath, oldCertificateIdentityPath)

  certificate2.attemptToRecoverFromFailedRenewalAttemptIfNecessary()

  t.ok(fs.existsSync(certificateIdentityPath), 'active certificate identity found after failed renewal recovery')
  t.ok(fs.existsSync(certificatePath), 'active certificate identity found after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificateIdentityPath), 'old certificate identity removed after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificatePath), 'old certificate removed after failed renewal attempt recovery')

  //
  // Case 2-c: Certificate identity exists but certificate doesn’t. Old certificates exist. We expect the old ones
  // to be restored and used.
  //

  fs.copySync(certificateIdentityPath, oldCertificateIdentityPath)
  fs.moveSync(certificatePath, oldCertificatePath)

  certificate2.attemptToRecoverFromFailedRenewalAttemptIfNecessary()

  t.ok(fs.existsSync(certificateIdentityPath), 'active certificate identity found after failed renewal recovery')
  t.ok(fs.existsSync(certificatePath), 'active certificate identity found after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificateIdentityPath), 'old certificate identity removed after failed renewal recovery')
  t.notOk(fs.existsSync(oldCertificatePath), 'old certificate removed after failed renewal attempt recovery')

  //
  // Make sure that the certificates we have after the recovery tests are the same ones that we started out with.
  //

  t.strictEquals(originalCertificate, fs.readFileSync(certificatePath, 'utf-8'), 'certificate from after recovery matches certificate from before')
  t.strictEquals(originalCertificateIdentity, fs.readFileSync(certificateIdentityPath, 'utf-8'), 'certificate identity from after recovery matches certificate identity from before')

  // Stop automatic renewal checks.
  certificate2.stopCheckingForRenewal()

  t.end()
})