////////////////////////////////////////////////////////////////////////////////
//
// Identity (abstract base class; do not use directly).
//
// Generates, stores, loads, and saves an identity from/to the file
// storage settings path. Meant to be subclassed and instantiated by different
// singletons for different types of Identity (e.g., AccountIdentity and
// DomainIdentity).
//
// The private key uses the RS256 algorithm with a 2048-bit key.
//
// Copyright © 2020 Aral Balkan, Small Technology Foundation.
// License: AGPLv3 or later.
//
////////////////////////////////////////////////////////////////////////////////

import util from 'util'
import fs from 'fs-extra'
import jose from 'jose'
import Throws from './util/Throws.js'
import log from './util/log.js'

const throws = new Throws({
  [Symbol.for('UnsupportedIdentityType')]: identityFilePath => `The identity file path passed (${identityFilePath}) is for an unsupported identity type.`
})

export default class Identity {

  constructor (configuration = throws.ifMissing(), identityFilePathKey = throws.ifMissing()) {
    const identityFilePath = configuration[identityFilePathKey]

    if (identityFilePath === undefined) {
      throws.error(Symbol.for('UnsupportedIdentityType'))
    }

    log(`   👤    ❨auto-encrypt❩ Creating identity (${identityFilePath})`)

    this.#identityFilePath = identityFilePath

    if (!fs.existsSync(this.#identityFilePath)) {
      // The identity file does not already exist, generate and save it.
      this._key = jose.JWK.generateSync('RSA')
      fs.writeFileSync(this.#identityFilePath, this.privatePEM, 'utf-8')
    } else {
      // Load the key from storage.
      const _privatePEM = fs.readFileSync(this.#identityFilePath, 'utf-8')
      this._key = jose.JWK.asKey(_privatePEM)
    }
  }

  //
  // Accessors.
  //

  // The JSON Web Key (JWK) instance.
  // https://github.com/panva/jose/blob/master/docs/README.md#jwk-json-web-key.
  get key        () { return this._key                                         }

  // Returns the private key in PEM format.s
  get privatePEM () { return this._key.toPEM(/* private = */ true)             }

  // The JWK thumbprint as calculated according to
  // RFC 7638 (https://tools.ietf.org/html/rfc7638).
  get thumbprint () { return this._key.thumbprint                              }

  // Returns JWK-formatted objects.
  // https://github.com/panva/jose/blob/master/docs/README.md#keytojwkprivate.
  get privateJWK () { return this._key.toJWK(/* private = */ true)             }
  get publicJWK  () { return this._key.toJWK()                                 }

  // The file path of the private key (saved in PEM format).
  get filePath   () { return this.#identityFilePath                             }

  //
  // Control access to read-only properties.
  //
  set key        (value) { throws.error(Symbol.for('ReadOnlyAccessorError'), 'key')        }
  set privatePEM (value) { throws.error(Symbol.for('ReadOnlyAccessorError'), 'privatePEM') }
  set thumbprint (value) { throws.error(Symbol.for('ReadOnlyAccessorError'), 'thumbprint') }
  set privateJWK (value) { throws.error(Symbol.for('ReadOnlyAccessorError'), 'privateJWK') }
  set publicJWK  (value) { throws.error(Symbol.for('ReadOnlyAccessorError'), 'publicJWK')  }
  set filePath   (value) { throws.error(Symbol.for('ReadOnlyAccessorError'), 'filePath')   }

  // Custom object description for console output (for debugging).
  [util.inspect.custom] () {
    return `
      # Identity

      Generates, stores, loads, and saves an identity (JWT OKP key using
      Ed25519 curve) from/to file storage.

      - Identity file path: ${this.filePath}

      ## Properties

      - .key        : the jose.JWK.RSAKey instance
      - .privatePEM : PEM representation of the private key
      - .thumbprint : JWK thumbprint calculated according to RFC 7638
      - .privateJWK : JavaScript object representation of JWK (private key)
      - .publicJWK  : JavaScript object representation of JWK (public key)
      - .filePath   : The file path of the private key (saved in PEM format)

      To see key details, please log() the .key property.
    `
  }

  //
  // Private
  //
  #identityFilePath = null
}
