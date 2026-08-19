import { getApiBase } from './apiBase';
import { TAKEOVER_PASSCODE_HEADER } from './edit_session';
import { shouldClearPasscodeWaiver } from './passcode_waiver_logic';
import {
  clearPasscodeWaiver,
  getValidPasscodeWaiver,
  mintPasscodeWaiver,
  PASSCODE_WAIVER_HEADER,
} from './passcode_waiver';
import { isEngineOriginRequest } from './privileged_request_scope';

export interface OperatorAuthInput {
  passcode?: string;
  remember30?: boolean;
  waiverToken?: string;
}

/**
 * Headers for one operator-passcode-gated request.
 *
 * Precedence: explicit waiverToken → fresh passcode → stored valid waiver.
 * A supplied passcode skips stored-waiver validation entirely.
 * When remember30 is true and a passcode is supplied, mints a waiver first.
 * Never stores the raw passcode.
 */
export async function operatorAuthHeaders(
  input: OperatorAuthInput = {},
): Promise<Record<string, string>> {
  if (input.waiverToken) {
    return { [PASSCODE_WAIVER_HEADER]: input.waiverToken };
  }

  if (input.passcode) {
    if (input.remember30) {
      const waiver = await mintPasscodeWaiver(input.passcode);
      return { [PASSCODE_WAIVER_HEADER]: waiver.token };
    }
    return { [TAKEOVER_PASSCODE_HEADER]: input.passcode };
  }

  const stored = await getValidPasscodeWaiver();
  if (stored) {
    return { [PASSCODE_WAIVER_HEADER]: stored.token };
  }

  return {};
}

/** Clear waiver after an origin-scoped auth refusal that used a waiver header. */
export async function clearOperatorAuthOnRefusal(
  headers: Record<string, string>,
  status: number | undefined,
  requestUrl: string,
): Promise<void> {
  const waiverToken = headers[PASSCODE_WAIVER_HEADER];
  const waiverTokenSent = typeof waiverToken === 'string' && waiverToken.length > 0;
  if (shouldClearPasscodeWaiver(
    status ?? 0,
    isEngineOriginRequest(requestUrl, getApiBase()),
    waiverTokenSent,
  )) {
    await clearPasscodeWaiver();
  }
}
