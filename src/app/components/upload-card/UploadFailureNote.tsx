import React from 'react';
import { Text } from 'folds';
import { uploadFailureText } from '../../utils/uploadReason';

/** A failed upload as the card shows it: the reason and what to do, the diagnostic text one tap away. */
export function UploadFailureNote({ error }: { error: Error }) {
  return (
    <>
      <Text size="T200">{uploadFailureText(error)}</Text>
      <details>
        <summary>
          <Text as="span" size="T200">
            Details
          </Text>
        </summary>
        <Text size="T200" style={{ wordBreak: 'break-word' }}>
          {error.message}
        </Text>
      </details>
    </>
  );
}
