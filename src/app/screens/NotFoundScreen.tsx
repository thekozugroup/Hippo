import { House } from 'lucide-react'
import { EmptyState, LinkButton, TwoTone } from '../../ui/index.ts'
import { AppScreen } from '../layout/AppScreen.tsx'

export function NotFoundScreen() {
  return (
    <AppScreen title="Page not found" back="#/" backLabel="Back to home">
      <EmptyState
        title={<TwoTone muted="Hmm." bright="There is nothing at this address." />}
        description="The link may be incomplete. If someone sent it to you, ask them to send it again."
        action={
          <LinkButton href="#/" variant="primary" icon={<House />}>
            Go home
          </LinkButton>
        }
      />
    </AppScreen>
  )
}
