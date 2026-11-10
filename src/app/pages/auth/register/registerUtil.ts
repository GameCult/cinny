import to from 'await-to-js';
import {
  IAuthData,
  MatrixClient,
  MatrixError,
  RegisterRequest,
  RegisterResponse,
} from 'matrix-js-sdk';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginPathSearchParams } from '../../paths';
import { ErrorCode } from '../../../cs-errorcode';
import {
  deleteAfterLoginRedirectPath,
  getAfterLoginRedirectPath,
} from '../../afterLoginRedirectPath';
import { getHomePath, getLoginPath, withSearchParam } from '../../pathUtils';
import { getMxIdLocalPart, getMxIdServer } from '../../../utils/matrix';
import { setFallbackSession } from '../../../state/sessions';
import type { RegisterTrouble } from '../authMessages';

export enum RegisterError {
  UserTaken = 'UserTaken',
  UserInvalid = 'UserInvalid',
  UserExclusive = 'UserExclusive',
  PasswordWeak = 'PasswordWeak',
  PasswordShort = 'PasswordShort',
  InvalidRequest = 'InvalidRequest',
  Forbidden = 'Forbidden',
  RateLimited = 'RateLimited',
  Unknown = 'Unknown',
}

// The form-level words for a failed registration, never the server's own text. The username
// errors are the form's own field messages and have no trouble here.
export const registerErrorTrouble = (errcode: string): RegisterTrouble | undefined => {
  switch (errcode) {
    case RegisterError.PasswordWeak:
      return 'password-weak';
    case RegisterError.PasswordShort:
      return 'password-short';
    case RegisterError.RateLimited:
      return 'rate-limited';
    case RegisterError.Forbidden:
      return 'closed';
    case RegisterError.InvalidRequest:
      return 'invalid';
    case RegisterError.Unknown:
      return 'unknown';
    default:
      return undefined;
  }
};

export type CustomRegisterResponse = {
  baseUrl: string;
  response: RegisterResponse;
};
export type RegisterResult = [IAuthData, undefined] | [undefined, CustomRegisterResponse];
export const register = async (
  mx: MatrixClient,
  requestData: RegisterRequest
): Promise<RegisterResult> => {
  const [err, res] = await to<RegisterResponse, MatrixError>(mx.registerRequest(requestData));

  if (err) {
    if (err.httpStatus === 401) {
      const authData = err.data as IAuthData;
      return [authData, undefined];
    }

    if (err.errcode === ErrorCode.M_USER_IN_USE) {
      throw new MatrixError({
        errcode: RegisterError.UserTaken,
      });
    }
    if (err.errcode === ErrorCode.M_INVALID_USERNAME) {
      throw new MatrixError({
        errcode: RegisterError.UserInvalid,
      });
    }
    if (err.errcode === ErrorCode.M_EXCLUSIVE) {
      throw new MatrixError({
        errcode: RegisterError.UserExclusive,
      });
    }
    if (err.errcode === ErrorCode.M_WEAK_PASSWORD) {
      throw new MatrixError({
        errcode: RegisterError.PasswordWeak,
        error: err.data.error,
      });
    }
    if (err.errcode === ErrorCode.M_PASSWORD_TOO_SHORT) {
      throw new MatrixError({
        errcode: RegisterError.PasswordShort,
        error: err.data.error,
      });
    }

    if (err.httpStatus === 429) {
      throw new MatrixError({
        errcode: RegisterError.RateLimited,
      });
    }

    if (err.httpStatus === 400) {
      throw new MatrixError({
        errcode: RegisterError.InvalidRequest,
      });
    }

    if (err.httpStatus === 403) {
      throw new MatrixError({
        errcode: RegisterError.Forbidden,
      });
    }

    throw new MatrixError({
      errcode: RegisterError.Unknown,
      error: err.data.error,
    });
  }
  return [
    undefined,
    {
      baseUrl: mx.baseUrl,
      response: res,
    },
  ];
};

export const useRegisterComplete = (data?: CustomRegisterResponse) => {
  const navigate = useNavigate();

  useEffect(() => {
    if (data) {
      const { response, baseUrl } = data;

      const userId = response.user_id;
      const accessToken = response.access_token;
      const deviceId = response.device_id;

      if (accessToken && deviceId) {
        setFallbackSession(accessToken, deviceId, userId, baseUrl);
        const afterLoginRedirectPath = getAfterLoginRedirectPath();
        deleteAfterLoginRedirectPath();
        navigate(afterLoginRedirectPath ?? getHomePath(), { replace: true });
      } else {
        const username = getMxIdLocalPart(userId);
        const userServer = getMxIdServer(userId);
        navigate(
          withSearchParam<LoginPathSearchParams>(getLoginPath(userServer), {
            username,
          }),
          { replace: true }
        );
      }
    }
  }, [data, navigate]);
};
