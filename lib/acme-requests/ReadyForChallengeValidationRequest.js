////////////////////////////////////////////////////////////////////////////////
//
// ReadyForChallengeValidationRequest
//
// The client indicates to the server that it is ready for the challenge
// validation by sending an empty JSON body ("{}") carried in a POST
// request to the challenge URL (not the authorization URL).
//
//                           – RFC 8555 § 7.5.1 (Responding to Challenges)
//
// Copyright © 2020 Aral Balkan, Small Technology Foundation.
// License: AGPLv3 or later.
//
////////////////////////////////////////////////////////////////////////////////

import AcmeRequest from '../AcmeRequest.js'
import Throws from '../util/Throws.js'

const throws = new Throws()

export default class ReadyForChallengeValidationRequest extends AcmeRequest {
  async execute (challengeUrl = throws.ifMissing()) {
    const emptyPayload = {}

    const response = await super.execute(
      /* command =      */ '', // see URL, below.
      /* payload =      */ emptyPayload,
      /* useKid =       */ true,
      /* successCodes = */ [200],
      /* url =          */ challengeUrl
    )

    return response
  }
}
