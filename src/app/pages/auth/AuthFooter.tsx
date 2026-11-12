import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';

export function AuthFooter() {
  return (
    <Box className={`${css.AuthFooter} ${css.AuthFooterLinks}`} justifyContent="Center" wrap="Wrap">
      <Text as="a" size="T300" href="https://gamecult.org" target="_blank" rel="noreferrer">
        About
      </Text>
      <Text
        as="a"
        size="T300"
        href="https://eureka.gamecult.org/forge/GameCult/Ratatoskr"
        target="_blank"
        rel="noreferrer"
      >
        Source
      </Text>
      <Text
        as="a"
        size="T300"
        href="https://github.com/cinnyapp/cinny"
        target="_blank"
        rel="noreferrer"
      >
        Based on Cinny
      </Text>
      <Text as="a" size="T300" href="https://matrix.org" target="_blank" rel="noreferrer">
        Powered by Matrix
      </Text>
    </Box>
  );
}
