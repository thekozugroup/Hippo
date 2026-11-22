import { House } from 'lucide-react'
import { LinkButton } from '../../ui/index.ts'
import { AppScreen } from '../layout/AppScreen.tsx'
import { ScreenMessage } from '../layout/ScreenMessage.tsx'

export function NotFoundScreen() {
  return (
    <AppScreen title="Page not found" back="#/" backLabel="Back to home">
      <ScreenMessage
        actions={
          <LinkButton href="#/" variant="primary" icon={<House />}>
            Go to home
          </LinkButton>
        }
      >
        <p>The link may be incomplete. If someone sent it to you, ask them to send it again.</p>
      </ScreenMessage>
    </AppScreen>
  )
}
