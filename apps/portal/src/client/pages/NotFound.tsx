import { Link } from 'react-router';
import { Button, EmptyState } from '../components/ui';

export function NotFound() {
  return (
    <EmptyState
      title="This page does not exist"
      action={
        <Link to="/">
          <Button>Back to the dashboard</Button>
        </Link>
      }
    >
      The link may be old, or the item was deleted.
    </EmptyState>
  );
}
