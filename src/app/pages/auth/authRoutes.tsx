import React from 'react';
import { Route, redirect } from 'react-router-dom';
import { getFallbackSession } from '../../state/sessions';
import { UnAuthRouteThemeManager } from '../ThemeManager';
import { LOGIN_PATH, REGISTER_PATH, RESET_PASSWORD_PATH, SIGNED_UP_PATH } from '../paths';
import { getHomePath } from '../pathUtils';
import { AuthLayout } from './AuthLayout';
import { Login } from './login';
import { RegisterRoute } from './register/RegisterRoute';
import { ResetPassword } from './reset-password';
import { SignedUp } from './SignedUp';

// The routes a signed-out visitor sees. The sign-up return page sits beside the layout, not in
// it: the layout looks up a homeserver and sends any path it does not know to sign in.
export const authRoutes = () => (
  <>
    <Route
      loader={() => (getFallbackSession() ? redirect(getHomePath()) : null)}
      element={
        <>
          <AuthLayout />
          <UnAuthRouteThemeManager />
        </>
      }
    >
      <Route path={LOGIN_PATH} element={<Login />} />
      <Route path={REGISTER_PATH} element={<RegisterRoute />} />
      <Route path={RESET_PASSWORD_PATH} element={<ResetPassword />} />
    </Route>
    <Route
      path={SIGNED_UP_PATH}
      element={
        <>
          <SignedUp />
          <UnAuthRouteThemeManager />
        </>
      }
    />
  </>
);
