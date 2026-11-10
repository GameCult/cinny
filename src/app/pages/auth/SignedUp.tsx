import { Box, Header, Scroll, Text } from 'folds';
import classNames from 'classnames';
import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useClientConfig } from '../../hooks/useClientConfig';
import { getLoginPath } from '../pathUtils';
import { registrationEntry } from './registrationEntry';
import { AuthFooter } from './AuthFooter';
import * as css from './styles.css';
import * as PatternsCss from '../../styles/Patterns.css';
import RatatoskrSVG from '../../../../public/res/svg/ratatoskr.svg';
import { LogoMark } from '../../components/logo/logoMark.css';

// Where the account service sends a newcomer back. It promises nothing about mail or timing:
// the sign-up page said what happens next, and this page points back to it. It has its own card
// because AuthLayout looks up a homeserver first and sends paths it does not know to sign in.
export function SignedUp() {
  const config = useClientConfig();
  if (!registrationEntry(config)) return <Navigate to={getLoginPath()} replace />;
  return (
    <Scroll variant="Background" visibility="Hover" size="300" hideTrack>
      <Box
        className={classNames(css.AuthLayout, PatternsCss.BackgroundDotPattern)}
        direction="Column"
        alignItems="Center"
        justifyContent="SpaceBetween"
        gap="400"
      >
        <Box direction="Column" className={css.AuthCard}>
          <Header className={css.AuthHeader} size="600" variant="Surface">
            <Box grow="Yes" direction="Row" gap="300" alignItems="Center">
              <img
                className={`${css.AuthLogo} ${LogoMark}`}
                src={RatatoskrSVG}
                alt="Ratatoskr logo"
              />
              <Text size="H3">Ratatoskr</Text>
            </Box>
          </Header>
          <Box className={css.AuthCardContent} direction="Column" gap="500">
            <Text size="H2" priority="400">
              You signed up
            </Text>
            <Text>Follow the steps from the sign-up page to finish. Then sign in here.</Text>
            <Text>
              <Link to={getLoginPath()}>Sign in</Link>
            </Text>
          </Box>
        </Box>
        <AuthFooter />
      </Box>
    </Scroll>
  );
}
