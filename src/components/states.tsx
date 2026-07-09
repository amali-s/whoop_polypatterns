import './components.css';

/**
 * Small presentational data-state trio (task 3.3). ChartContainer renders
 * these from its `status` prop; they are also usable standalone (the auth
 * card uses LoadingState/ErrorState directly).
 */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  // role="status" already implies polite live-region semantics; the explicit
  // aria-live is belt-and-braces per the 3.3 accessibility requirement.
  return (
    <div className="ui-state" role="status" aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ message = 'No data to show yet.' }: { message?: string }) {
  return <p className="ui-state ui-state-empty">{message}</p>;
}

export function ErrorState({
  message = 'Something went wrong loading this data.',
}: {
  message?: string;
}) {
  return (
    <div className="ui-state ui-state-error" role="alert">
      {message}
    </div>
  );
}
