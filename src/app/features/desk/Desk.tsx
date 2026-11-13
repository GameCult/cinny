import React, { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Icon, IconButton, Icons, Scroll, Text } from 'folds';
import { PhoneHit } from '../../styles/PhoneHit.css';
import { Page, PageContent, PageContentCenter, PageHeader } from '../../components/page';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { getHomePath } from '../../pages/pathUtils';
import { DeskView } from './DeskView';
import { useUnverified } from './useUnverified';
import { deskFor } from './source';

const labelOf = (mind: string) => mind.charAt(0).toUpperCase() + mind.slice(1);

/** The route's page: one Mind's desk under the navigator. */
export function Desk() {
  const { mind = '' } = useParams();
  const navigate = useNavigate();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const label = labelOf(mind);
  const list = useMemo(() => deskFor(mind), [mind]);
  // Until the recompute finishes nothing is flagged; a card that fails is withdrawn when it lands.
  const unverified = useUnverified(list);

  return (
    <Page>
      <PageHeader balance>
        <Box grow="Yes" alignItems="Center" gap="200">
          <Box grow="Yes" basis="No">
            {phone && (
              <IconButton
                className={PhoneHit}
                aria-label="Back to rooms"
                onClick={() => navigate(getHomePath())}
              >
                <Icon src={Icons.ArrowLeft} />
              </IconButton>
            )}
          </Box>
          <Text size="H3" truncate>{`${label}'s desk`}</Text>
          <Box grow="Yes" basis="No" />
        </Box>
      </PageHeader>
      <Box style={{ position: 'relative' }} grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <PageContentCenter>
              <DeskView mind={mind} label={label} list={list} unverified={unverified} />
            </PageContentCenter>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
