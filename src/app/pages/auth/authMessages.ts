import { LoginError } from './login/loginUtil';

// What the sign-in and sign-up pages say when something goes wrong. Each message says what happened
// in plain words and what the person can do next; none is a status code or a Matrix term.

export const loginErrorMessage = (error: LoginError): string => {
  switch (error) {
    case LoginError.ServerNotAllowed:
      return 'This app only signs in to the servers in its Homeserver list. Pick one from the list above.';
    case LoginError.InvalidServer:
      return 'We could not find the server in that username. A full username looks like @name:server; the part after the colon is the server.';
    case LoginError.Forbidden:
      return 'That username and password did not match. Check both and try again, or use "Forget Password?" beside the password.';
    case LoginError.UserDeactivated:
      return 'This account has been turned off. Ask whoever runs this server to turn it back on.';
    case LoginError.InvalidRequest:
      return 'The server could not read that sign-in. Check the username and password for stray spaces and try again.';
    case LoginError.RateLimited:
      return 'Too many tries in a short time. Wait a minute, then try again.';
    case LoginError.Unknown:
    default:
      return 'Sign-in did not work and the server gave no reason. Wait a minute and try again; if it keeps failing, tell whoever invited you.';
  }
};

export type ServerTrouble =
  | 'not-found'
  | 'unusable-setup'
  | 'bad-address'
  | 'unreachable'
  | 'no-sign-in-info';

/** `server` is the name shown in the Homeserver box; `host` is the name the server's own setup gave. */
export const serverTroubleMessage = (
  trouble: ServerTrouble,
  server: string,
  host?: string
): string => {
  switch (trouble) {
    case 'not-found':
      return `We could not find a chat server called ${server}. Check the name for typos, or try again in a minute.`;
    case 'unusable-setup':
      return `We found ${server}, but the setup it points to (${
        host ?? 'unknown'
      }) is not usable. You cannot fix this from here: tell whoever runs the server.`;
    case 'bad-address':
      return `We found ${server}, but the address it gives for chat is not valid. You cannot fix this from here: tell whoever runs the server.`;
    case 'unreachable':
      return `We found ${server} but could not connect to it. It may be down for a moment: wait a minute and reload this page. If it stays down, tell whoever invited you.`;
    case 'no-sign-in-info':
      return `Connected to ${server}, but it did not say how to sign in. Reload the page; if it happens again, tell whoever runs the server.`;
    default:
      return `We could not reach ${server}. Reload the page and try again.`;
  }
};

export const noSignInMethodMessage = (server: string): string =>
  `${server} does not offer a way to sign in that this app can use. Pick another server from the Homeserver list, or tell whoever runs ${server}.`;

export type RegisterTrouble = 'closed' | 'rate-limited' | 'invalid' | 'unsupported';

export const registerTroubleMessage = (trouble: RegisterTrouble, server: string): string => {
  switch (trouble) {
    case 'closed':
      return `New accounts cannot be made on ${server} from this page yet. If you were given an account, sign in with it. If you were not, ask whoever invited you how to get one.`;
    case 'rate-limited':
      return 'Too many tries in a short time. Wait a minute, then try again.';
    case 'invalid':
      return `${server} did not accept the request to make an account. Reload the page and try again; if it keeps failing, tell whoever invited you.`;
    case 'unsupported':
    default:
      return `${server} asks for something this app cannot do when making an account. Tell whoever invited you.`;
  }
};
